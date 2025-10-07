/**
 * esp-voice-server: High-performance WebSocket-based voice processing backend for ESP32/M5Stack
 *
 * @packageDocumentation
 */

// Core exports
export * from './core/index.js'
export * from './types/index.js'
export * from './plugins/index.js'

// Re-export WebSocket type from ws
export { WebSocket } from 'ws'

import type { WebSocket } from 'ws'
import { VoiceWebSocketServer, type WebSocketConfig, type MessageType } from './core/websocket.js'
import { SessionManager, type SessionConfig } from './core/session.js'
import type { PipelineConfig, ConversationContext } from './plugins/index.js'
import type { StreamingSession, PcmHeader } from './types/index.js'

/**
 * Voice Server configuration
 */
export interface VoiceServerConfig {
  /** WebSocket server configuration */
  websocket: WebSocketConfig
  /** Session management configuration */
  session?: SessionConfig
  /** Voice processing pipeline configuration */
  pipeline?: PipelineConfig
}

/**
 * High-level Voice Server
 * Orchestrates WebSocket, session management, and voice processing pipeline
 */
export class VoiceServer {
  private wsServer: VoiceWebSocketServer
  private sessionManager: SessionManager
  private pipeline?: PipelineConfig
  private config: VoiceServerConfig

  // Track WebSocket to sessionId mapping
  private wsToSessionId: WeakMap<WebSocket, string> = new WeakMap()

  constructor(config: VoiceServerConfig) {
    this.config = config
    this.pipeline = config.pipeline

    // Create session manager
    this.sessionManager = new SessionManager(config.session || {}, {
      onCreate: (session) => this.onSessionCreate(session),
      onEnd: (session) => this.onSessionEnd(session),
      onLimitExceeded: (session, reason) => {
        console.warn(`Session ${session.sessionId} limit exceeded: ${reason}`)
      }
    })

    // Create WebSocket server with handlers
    this.wsServer = new VoiceWebSocketServer(config.websocket, {
      onConnection: (ws, sessionId) => this.onConnection(ws, sessionId),
      onMessage: (ws, sessionId, message) => this.onMessage(ws, sessionId, message),
      onClose: (ws, sessionId) => this.onClose(ws, sessionId),
      onError: (ws, sessionId, error) => this.onError(ws, sessionId, error)
    })
  }

  /**
   * Start the voice server
   */
  start(): void {
    this.wsServer.start()
    console.log('Voice server started')
  }

  /**
   * Stop the voice server
   */
  async stop(): Promise<void> {
    await this.wsServer.stop()
    await this.sessionManager.clearAll()
    console.log('Voice server stopped')
  }

  /**
   * Get session manager
   */
  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  /**
   * Handle new WebSocket connection
   */
  private async onConnection(ws: WebSocket, sessionId: string): Promise<void> {
    this.wsToSessionId.set(ws, sessionId)

    // Create session
    this.sessionManager.createSession(sessionId)

    if (this.config.pipeline?.verbose) {
      console.log(`Session created for connection: ${sessionId}`)
    }
  }

  /**
   * Handle WebSocket message
   */
  private async onMessage(ws: WebSocket, sessionId: string, message: MessageType): Promise<void> {
    if (message.type === 'header') {
      await this.handleHeader(ws, sessionId, message.data, message.header)
    } else if (message.type === 'audio') {
      await this.handleAudio(ws, sessionId, message.data)
    } else if (message.type === 'end') {
      await this.handleEnd(ws, sessionId)
    } else if (message.type === 'text') {
      await this.handleText(ws, sessionId, message.message)
    }
  }

  /**
   * Handle WebSocket close
   */
  private async onClose(_ws: WebSocket, sessionId: string): Promise<void> {
    await this.sessionManager.endSession(sessionId)
  }

  /**
   * Handle WebSocket error
   */
  private onError(_ws: WebSocket, sessionId: string, error: Error): void {
    console.error(`WebSocket error for ${sessionId}:`, error)
  }

  /**
   * Handle PCM header
   */
  private async handleHeader(ws: WebSocket, sessionId: string, _data: Buffer, header: PcmHeader): Promise<void> {
    this.sessionManager.setHeader(sessionId, header)

    if (this.config.pipeline?.verbose) {
      console.log(`PCM header received for ${sessionId}:`, header)
    }

    // Send acknowledgment
    this.wsServer.sendJson(ws, {
      type: 'header_received',
      sessionId,
      format: {
        sampleRate: header.sample_rate,
        channels: header.channels,
        bits: header.bits
      }
    })
  }

  /**
   * Handle audio chunk
   */
  private async handleAudio(ws: WebSocket, sessionId: string, data: Buffer): Promise<void> {
    const success = this.sessionManager.addChunk(sessionId, data)

    if (!success) {
      this.wsServer.sendJson(ws, {
        type: 'error',
        message: 'Failed to add audio chunk (session limit exceeded)'
      })
    }
  }

  /**
   * Handle END signal
   */
  private async handleEnd(ws: WebSocket, sessionId: string): Promise<void> {
    const session = await this.sessionManager.endSession(sessionId)

    if (!session) {
      console.warn(`Session not found for END signal: ${sessionId}`)
      return
    }

    // Process audio if pipeline is configured
    if (this.pipeline) {
      await this.processAudio(ws, session)
    }

    // Create new session for continued streaming
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
    this.wsToSessionId.set(ws, newSessionId)
    this.sessionManager.createSession(newSessionId)

    // Copy conversation context to new session
    const conversationId = this.sessionManager.getSessionData<string>(sessionId, 'conversationId')
    if (conversationId) {
      this.sessionManager.setSessionData(newSessionId, 'conversationId', conversationId)
    }

    this.wsServer.sendJson(ws, {
      type: 'session_ready',
      sessionId: newSessionId
    })
  }

  /**
   * Handle text message
   */
  private async handleText(ws: WebSocket, sessionId: string, message: string): Promise<void> {
    // Handle authentication
    if (message.startsWith('AUTH:')) {
      const userId = message.substring(5).trim()
      if (userId) {
        this.sessionManager.setSessionData(sessionId, 'userId', userId)
        this.wsServer.sendJson(ws, {
          type: 'auth_success',
          userId
        })
      } else {
        this.wsServer.sendJson(ws, {
          type: 'auth_error',
          message: 'Invalid user_id'
        })
      }
    }
  }

  /**
   * Process audio through pipeline
   */
  private async processAudio(ws: WebSocket, session: StreamingSession): Promise<void> {
    if (!this.pipeline || !session.header) {
      return
    }

    const audioData = this.sessionManager.getAudioData(session.sessionId)
    if (!audioData || audioData.length === 0) {
      return
    }

    try {
      // Transcription
      const transcription = await this.pipeline.transcription.transcribe(audioData, session.header)
      if (!transcription) {
        console.warn('Transcription failed')
        return
      }

      if (this.config.pipeline?.verbose) {
        console.log(`Transcription: "${transcription}"`)
      }

      this.wsServer.sendJson(ws, {
        type: 'transcription',
        text: transcription
      })

      // Generate response
      const context: ConversationContext = {
        sessionId: session.sessionId,
        conversationId: this.sessionManager.getSessionData(session.sessionId, 'conversationId'),
        userId: this.sessionManager.getSessionData(session.sessionId, 'userId')
      }

      const response = await this.pipeline.conversation.generate(transcription, context)
      if (!response) {
        console.warn('Response generation failed')
        return
      }

      if (this.config.pipeline?.verbose) {
        console.log(`Response: "${response}"`)
      }

      this.wsServer.sendJson(ws, {
        type: 'response',
        text: response
      })

      // Synthesize speech
      const audioBuffer = await this.pipeline.synthesis.synthesize(response)
      if (!audioBuffer) {
        console.warn('Speech synthesis failed')
        return
      }

      // Send audio response
      this.wsServer.send(ws, audioBuffer)
    } catch (error) {
      console.error('Error processing audio:', error)
      this.wsServer.sendJson(ws, {
        type: 'error',
        message: 'Failed to process audio'
      })
    }
  }

  /**
   * Session lifecycle hooks
   */
  private onSessionCreate(session: StreamingSession): void {
    if (this.config.pipeline?.verbose) {
      console.log(`Session created: ${session.sessionId}`)
    }
  }

  private onSessionEnd(session: StreamingSession): void {
    if (this.config.pipeline?.verbose) {
      console.log(`Session ended: ${session.sessionId}`)
    }
  }
}

/**
 * Default export
 */
export default VoiceServer
