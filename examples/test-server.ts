/**
 * Test server for esp-voice-server library
 * Tests core functionality without requiring external services
 */

import { VoiceWebSocketServer, SessionManager } from '../src/index.js'

console.log('Starting esp-voice-server test...\n')

// Create session manager
const sessionManager = new SessionManager({
  maxBytes: 5 * 1024 * 1024,
  maxDurationMs: 60_000,
  maxChunks: 200,
  idleTimeoutMs: 5_000
}, {
  onCreate: (session) => {
    console.log(`✓ Session created: ${session.sessionId}`)
  },
  onEnd: (session) => {
    const stats = sessionManager.getStats(session.sessionId)
    if (stats) {
      console.log(`✓ Session ended: ${session.sessionId}`)
      console.log(`  - Duration: ${(stats.duration / 1000).toFixed(2)}s`)
      console.log(`  - Total bytes: ${stats.totalBytes}`)
      console.log(`  - Chunks: ${stats.chunkCount}`)
    }
  }
})

// Create WebSocket server
const wsServer = new VoiceWebSocketServer({
  port: 3000,
  path: '/pcm/stream',
  host: '0.0.0.0'
}, {
  onConnection: (ws, sessionId) => {
    console.log(`\n✓ WebSocket connected: ${sessionId}`)
    sessionManager.createSession(sessionId)
  },
  onMessage: async (ws, sessionId, message) => {
    if (message.type === 'header') {
      console.log(`✓ PCM header received for ${sessionId}:`)
      console.log(`  - Sample rate: ${message.header.sample_rate}Hz`)
      console.log(`  - Channels: ${message.header.channels}`)
      console.log(`  - Bits: ${message.header.bits}`)
      console.log(`  - Frame samples: ${message.header.frame_samps}`)

      sessionManager.setHeader(sessionId, message.header)

      wsServer.sendJson(ws, {
        type: 'header_ack',
        message: 'Header received successfully'
      })
    } else if (message.type === 'audio') {
      const added = sessionManager.addChunk(sessionId, message.data)
      if (added) {
        const stats = sessionManager.getStats(sessionId)
        if (stats && stats.chunkCount % 10 === 0) {
          console.log(`  Audio chunk ${stats.chunkCount}: ${stats.totalBytes} bytes total`)
        }
      }
    } else if (message.type === 'end') {
      console.log(`✓ END signal received for ${sessionId}`)

      const audioData = sessionManager.getAudioData(sessionId)
      if (audioData) {
        console.log(`  Total audio data: ${audioData.length} bytes`)
      }

      await sessionManager.endSession(sessionId)

      // Send acknowledgment
      wsServer.sendJson(ws, {
        type: 'end_ack',
        message: 'Stream ended successfully'
      })

      // Create new session for continued streaming
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
      sessionManager.createSession(newSessionId)

      wsServer.sendJson(ws, {
        type: 'session_ready',
        sessionId: newSessionId
      })
    } else if (message.type === 'text') {
      console.log(`✓ Text message: "${message.message}"`)

      if (message.message.startsWith('AUTH:')) {
        const userId = message.message.substring(5).trim()
        sessionManager.setSessionData(sessionId, 'userId', userId)
        console.log(`  Authenticated user: ${userId}`)

        wsServer.sendJson(ws, {
          type: 'auth_success',
          userId
        })
      }
    }
  },
  onClose: async (ws, sessionId) => {
    console.log(`\n✗ WebSocket disconnected: ${sessionId}`)
    await sessionManager.endSession(sessionId)
  },
  onError: (ws, sessionId, error) => {
    console.error(`\n✗ WebSocket error for ${sessionId}:`, error.message)
  }
})

// Start server
wsServer.start()

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('✓ Voice server test running')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`WebSocket URL: ws://0.0.0.0:3000/pcm/stream`)
console.log(`\nTest with:`)
console.log(`  - M5Stack device`)
console.log(`  - wscat: wscat -c ws://localhost:3000/pcm/stream`)
console.log(`  - Browser WebSocket`)
console.log('\nPress Ctrl+C to stop\n')

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down...')
  await wsServer.stop()
  await sessionManager.clearAll()
  console.log('✓ Server stopped')
  process.exit(0)
})
