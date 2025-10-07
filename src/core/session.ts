import type { StreamingSession, PcmHeader } from '../types/index.js'
import { calculateDuration } from './pcm.js'

/**
 * Session constraints configuration
 */
export interface SessionConfig {
  /** Maximum session size in bytes (default: 5MB) */
  maxBytes?: number
  /** Maximum session duration in milliseconds (default: 60s) */
  maxDurationMs?: number
  /** Maximum number of audio chunks (default: 200) */
  maxChunks?: number
  /** Idle timeout in milliseconds (default: 5s) */
  idleTimeoutMs?: number
}

/**
 * Session event callbacks
 */
export interface SessionCallbacks {
  /** Called when a session is created */
  onCreate?: (session: StreamingSession) => void | Promise<void>
  /** Called when a session is ended */
  onEnd?: (session: StreamingSession) => void | Promise<void>
  /** Called when a session exceeds limits */
  onLimitExceeded?: (session: StreamingSession, reason: string) => void
  /** Called when a session becomes idle */
  onIdle?: (session: StreamingSession) => void | Promise<void>
}

/**
 * Session Manager
 * Manages streaming audio session lifecycle and buffering
 */
export class SessionManager {
  private sessions: Map<string, StreamingSession> = new Map()
  private lastActivity: Map<string, number> = new Map()
  private config: Required<SessionConfig>
  private callbacks: SessionCallbacks

  constructor(config: SessionConfig = {}, callbacks: SessionCallbacks = {}) {
    this.config = {
      maxBytes: 5 * 1024 * 1024,  // 5MB
      maxDurationMs: 60_000,      // 60 seconds
      maxChunks: 200,
      idleTimeoutMs: 5_000,       // 5 seconds
      ...config
    }
    this.callbacks = callbacks
  }

  /**
   * Create a new streaming session
   */
  createSession(sessionId: string, header: PcmHeader | null = null): StreamingSession {
    const session: StreamingSession = {
      sessionId,
      dataChunks: [],
      startTime: Date.now(),
      totalBytes: 0,
      header
    }

    this.sessions.set(sessionId, session)
    this.lastActivity.set(sessionId, Date.now())

    if (this.callbacks.onCreate) {
      Promise.resolve(this.callbacks.onCreate(session)).catch(error => {
        console.error('Error in onCreate callback:', error)
      })
    }

    console.log(`Session created: ${sessionId}`)
    return session
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): StreamingSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Set session header
   */
  setHeader(sessionId: string, header: PcmHeader): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    session.header = header
    this.lastActivity.set(sessionId, Date.now())
    return true
  }

  /**
   * Add audio chunk to session
   * Returns false if session limits exceeded
   */
  addChunk(sessionId: string, chunk: Buffer): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.warn(`Session not found: ${sessionId}`)
      return false
    }

    // Check limits
    const newTotalBytes = session.totalBytes + chunk.length
    if (newTotalBytes > this.config.maxBytes) {
      console.warn(`Session ${sessionId} exceeded max bytes: ${newTotalBytes} > ${this.config.maxBytes}`)
      if (this.callbacks.onLimitExceeded) {
        this.callbacks.onLimitExceeded(session, 'max_bytes')
      }
      return false
    }

    const duration = Date.now() - session.startTime
    if (duration > this.config.maxDurationMs) {
      console.warn(`Session ${sessionId} exceeded max duration: ${duration}ms > ${this.config.maxDurationMs}ms`)
      if (this.callbacks.onLimitExceeded) {
        this.callbacks.onLimitExceeded(session, 'max_duration')
      }
      return false
    }

    if (session.dataChunks.length >= this.config.maxChunks) {
      console.warn(`Session ${sessionId} exceeded max chunks: ${session.dataChunks.length} >= ${this.config.maxChunks}`)
      if (this.callbacks.onLimitExceeded) {
        this.callbacks.onLimitExceeded(session, 'max_chunks')
      }
      return false
    }

    // Add chunk
    session.dataChunks.push(chunk)
    session.totalBytes = newTotalBytes
    this.lastActivity.set(sessionId, Date.now())

    return true
  }

  /**
   * Get concatenated audio data for session
   */
  getAudioData(sessionId: string): Buffer | null {
    const session = this.sessions.get(sessionId)
    if (!session || session.dataChunks.length === 0) {
      return null
    }

    return Buffer.concat(session.dataChunks)
  }

  /**
   * Get session statistics
   */
  getStats(sessionId: string): {
    duration: number
    totalBytes: number
    chunkCount: number
    audioDuration: number
  } | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    const duration = Date.now() - session.startTime
    let audioDuration = 0

    if (session.header && session.totalBytes > 0) {
      audioDuration = calculateDuration(
        session.totalBytes,
        session.header.sample_rate,
        session.header.channels,
        session.header.bits
      )
    }

    return {
      duration,
      totalBytes: session.totalBytes,
      chunkCount: session.dataChunks.length,
      audioDuration
    }
  }

  /**
   * End a session and remove it
   */
  async endSession(sessionId: string): Promise<StreamingSession | null> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    this.sessions.delete(sessionId)
    this.lastActivity.delete(sessionId)

    if (this.callbacks.onEnd) {
      await Promise.resolve(this.callbacks.onEnd(session))
    }

    console.log(`Session ended: ${sessionId}`)
    return session
  }

  /**
   * Check for idle sessions and call callback
   */
  checkIdleSessions(): void {
    const now = Date.now()

    for (const [sessionId, lastActivityTime] of this.lastActivity) {
      const idleTime = now - lastActivityTime

      if (idleTime > this.config.idleTimeoutMs) {
        const session = this.sessions.get(sessionId)
        if (session && this.callbacks.onIdle) {
          Promise.resolve(this.callbacks.onIdle(session)).catch(error => {
            console.error('Error in onIdle callback:', error)
          })
        }
      }
    }
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * Get number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Clear all sessions
   */
  async clearAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())

    for (const sessionId of sessionIds) {
      await this.endSession(sessionId)
    }

    this.sessions.clear()
    this.lastActivity.clear()
  }

  /**
   * Set additional data on session (generic key-value store)
   */
  setSessionData<T>(sessionId: string, key: string, value: T): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    ;(session as any)[key] = value
    return true
  }

  /**
   * Get additional data from session
   */
  getSessionData<T>(sessionId: string, key: string): T | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }

    return (session as any)[key]
  }
}
