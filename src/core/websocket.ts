import { WebSocketServer, WebSocket } from 'ws'
import type { PcmHeader } from '../types/index.js'

/**
 * WebSocket server configuration
 */
export interface WebSocketConfig {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** WebSocket path (default: '/pcm/stream') */
  path?: string
  /** Heartbeat ping interval in ms (default: 15000) */
  pingInterval?: number
  /** Maximum payload size in bytes (default: 10MB) */
  maxPayload?: number
  /** Enable per-message deflate compression (default: false for M5Stack compatibility) */
  perMessageDeflate?: boolean
  /** Skip UTF-8 validation (default: true for M5Stack compatibility) */
  skipUTF8Validation?: boolean
}

/**
 * Message types that can be received
 */
export type MessageType =
  | { type: 'header'; data: Buffer; header: PcmHeader }
  | { type: 'audio'; data: Buffer }
  | { type: 'end' }
  | { type: 'text'; message: string }

/**
 * Event handlers for WebSocket connections
 */
export interface WebSocketHandlers {
  /** Called when a new connection is established */
  onConnection?: (ws: WebSocket, sessionId: string) => void | Promise<void>
  /** Called when a message is received */
  onMessage?: (ws: WebSocket, sessionId: string, message: MessageType) => void | Promise<void>
  /** Called when connection closes */
  onClose?: (ws: WebSocket, sessionId: string) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (ws: WebSocket, sessionId: string, error: Error) => void
}

/**
 * WebSocket session tracking
 */
interface SessionInfo {
  sessionId: string
  ws: WebSocket
  header: PcmHeader | null
  isAlive: boolean
}

/**
 * Voice WebSocket Server
 * Handles PCM audio streaming over WebSocket with custom protocol
 */
export class VoiceWebSocketServer {
  private wss: WebSocketServer | null = null
  private sessions: Map<WebSocket, SessionInfo> = new Map()
  private heartbeatTimer: NodeJS.Timeout | null = null
  private config: Required<WebSocketConfig>
  private handlers: WebSocketHandlers

  constructor(config: WebSocketConfig, handlers: WebSocketHandlers = {}) {
    this.config = {
      host: '0.0.0.0',
      path: '/pcm/stream',
      pingInterval: 15000,
      maxPayload: 10 * 1024 * 1024,
      perMessageDeflate: false,
      skipUTF8Validation: true,
      ...config
    }
    this.handlers = handlers
  }

  /**
   * Start the WebSocket server
   */
  start(): void {
    if (this.wss) {
      console.warn('WebSocket server already running')
      return
    }

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
      path: this.config.path,
      perMessageDeflate: this.config.perMessageDeflate,
      maxPayload: this.config.maxPayload,
      skipUTF8Validation: this.config.skipUTF8Validation
    })

    console.log(`WebSocket server listening on ws://${this.config.host}:${this.config.port}${this.config.path}`)

    // Set up heartbeat to detect dead connections
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat()
    }, this.config.pingInterval)

    // Handle new connections
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws)
    })

    // Handle server errors
    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error)
    })
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // Close all active connections
    for (const [ws] of this.sessions) {
      try {
        ws.close()
      } catch (error) {
        console.error('Error closing WebSocket:', error)
      }
    }
    this.sessions.clear()

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => {
          console.log('WebSocket server closed')
          resolve()
        })
      })
      this.wss = null
    }
  }

  /**
   * Send data to a specific WebSocket
   */
  send(ws: WebSocket, data: Buffer | string): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false
    }

    try {
      if (typeof data === 'string') {
        ws.send(data)
      } else {
        ws.send(data, { binary: true })
      }
      return true
    } catch (error) {
      console.error('Error sending data:', error)
      return false
    }
  }

  /**
   * Send JSON message
   */
  sendJson(ws: WebSocket, obj: Record<string, unknown>): boolean {
    return this.send(ws, JSON.stringify(obj))
  }

  /**
   * Get session info for a WebSocket
   */
  getSession(ws: WebSocket): SessionInfo | undefined {
    return this.sessions.get(ws)
  }

  /**
   * Heartbeat to detect dead connections
   */
  private heartbeat(): void {
    for (const [ws, session] of this.sessions) {
      if (!session.isAlive) {
        console.log(`Terminating dead connection: ${session.sessionId}`)
        try {
          ws.terminate()
        } catch (error) {
          console.error('Error terminating connection:', error)
        }
        this.sessions.delete(ws)
        continue
      }

      session.isAlive = false
      try {
        ws.ping()
      } catch (error) {
        console.error('Error sending ping:', error)
      }
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`

    console.log(`WebSocket connection established: ${sessionId}`)

    // Create session
    const session: SessionInfo = {
      sessionId,
      ws,
      header: null,
      isAlive: true
    }
    this.sessions.set(ws, session)

    // Set up pong handler
    ws.on('pong', () => {
      session.isAlive = true
    })

    // Send connection confirmation
    this.sendJson(ws, {
      type: 'connection_established',
      message: 'WebSocket connection established',
      sessionId
    })

    // Call connection handler
    if (this.handlers.onConnection) {
      Promise.resolve(this.handlers.onConnection(ws, sessionId)).catch(error => {
        console.error('Error in onConnection handler:', error)
      })
    }

    // Set up message handler
    ws.on('message', (data: Buffer) => {
      this.handleMessage(ws, session, data)
    })

    // Set up error handler
    ws.on('error', (error) => {
      console.error(`WebSocket error for ${sessionId}:`, error)
      if (this.handlers.onError) {
        this.handlers.onError(ws, sessionId, error)
      }
    })

    // Set up close handler
    ws.on('close', () => {
      console.log(`WebSocket connection closed: ${sessionId}`)
      this.sessions.delete(ws)

      if (this.handlers.onClose) {
        Promise.resolve(this.handlers.onClose(ws, sessionId)).catch(error => {
          console.error('Error in onClose handler:', error)
        })
      }
    })
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(ws: WebSocket, session: SessionInfo, data: Buffer): Promise<void> {
    try {
      // Check if it's a text message (command)
      if (!Buffer.isBuffer(data)) {
        const message = String(data)
        const messageType: MessageType = { type: 'text', message }

        if (this.handlers.onMessage) {
          await this.handlers.onMessage(ws, session.sessionId, messageType)
        }
        return
      }

      // Check for PCM header (first 16 bytes)
      if (!session.header && data.length >= 16) {
        const magic = data.slice(0, 4).toString('utf8')

        if (magic === 'PCM1') {
          // Parse PCM header
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
          const header: PcmHeader = {
            magic,
            sample_rate: view.getUint32(4, true),
            channels: view.getUint8(8),
            bits: view.getUint8(9),
            frame_samps: view.getUint16(10, true),
            reserved: view.getUint16(12, true)
          }

          session.header = header
          const messageType: MessageType = { type: 'header', data, header }

          if (this.handlers.onMessage) {
            await this.handlers.onMessage(ws, session.sessionId, messageType)
          }
          return
        }
      }

      // Check for END signal
      if (data.length === 4 && data.toString('utf8') === 'END\0') {
        const messageType: MessageType = { type: 'end' }

        if (this.handlers.onMessage) {
          await this.handlers.onMessage(ws, session.sessionId, messageType)
        }

        // Reset session header for next stream
        session.header = null
        return
      }

      // Handle audio data
      if (session.header) {
        const messageType: MessageType = { type: 'audio', data }

        if (this.handlers.onMessage) {
          await this.handlers.onMessage(ws, session.sessionId, messageType)
        }
      } else {
        console.warn(`Received data before PCM header for ${session.sessionId}`)
      }
    } catch (error) {
      console.error('Error processing message:', error)
      this.sendJson(ws, {
        type: 'error',
        message: 'Failed to process message'
      })
    }
  }
}
