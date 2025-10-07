/**
 * Test WebSocket client for esp-voice-server
 */

import WebSocket from 'ws'
import { createPcmHeader } from '../src/index.js'

const WS_URL = 'ws://localhost:3000/pcm/stream'

console.log('Starting WebSocket client test...\n')
console.log(`Connecting to: ${WS_URL}`)

const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  console.log('✓ Connected to server\n')

  // Wait for connection confirmation
  setTimeout(() => {
    console.log('Sending test data...\n')

    // Test 1: Send PCM header
    console.log('1. Sending PCM header (16kHz, mono, 16-bit)')
    const header = createPcmHeader(16000, 1, 16, 320)
    ws.send(header)

    // Test 2: Send some audio chunks
    setTimeout(() => {
      console.log('2. Sending audio chunks (simulated)')
      for (let i = 0; i < 5; i++) {
        const audioChunk = Buffer.alloc(640) // 20ms of audio @ 16kHz 16-bit mono
        // Fill with some dummy data
        for (let j = 0; j < audioChunk.length; j += 2) {
          const sample = Math.sin(i * 100 + j) * 5000
          audioChunk.writeInt16LE(sample, j)
        }
        ws.send(audioChunk)
      }
    }, 500)

    // Test 3: Send END signal
    setTimeout(() => {
      console.log('3. Sending END signal')
      const endMarker = Buffer.from('END\0', 'utf-8')
      ws.send(endMarker)
    }, 1500)

    // Test 4: Send authentication
    setTimeout(() => {
      console.log('4. Sending authentication')
      ws.send('AUTH:test-user-123')
    }, 2000)

    // Close connection after tests
    setTimeout(() => {
      console.log('\n✓ All tests completed')
      console.log('Closing connection...')
      ws.close()
    }, 3000)
  }, 500)
})

ws.on('message', (data: Buffer) => {
  try {
    const message = JSON.parse(data.toString())
    console.log(`← Server message:`, message)
  } catch (e) {
    console.log(`← Server binary data: ${data.length} bytes`)
  }
})

ws.on('error', (error) => {
  console.error('✗ WebSocket error:', error.message)
})

ws.on('close', () => {
  console.log('✗ Connection closed')
  process.exit(0)
})
