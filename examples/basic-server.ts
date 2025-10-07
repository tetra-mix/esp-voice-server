/**
 * Basic esp-voice-server example
 *
 * This example shows how to create a simple voice server with custom plugins.
 * In a real application, you would implement proper transcription, conversation,
 * and synthesis plugins based on your requirements.
 */

import { VoiceServer } from '../src/index.js'
import type { TranscriptionPlugin, ConversationPlugin, SynthesisPlugin } from '../src/index.js'

// Example transcription plugin (stub implementation)
const transcriptionPlugin: TranscriptionPlugin = {
  name: 'example-transcription',
  async transcribe(audioBuffer, header) {
    console.log(`Transcribing ${audioBuffer.length} bytes @ ${header.sample_rate}Hz`)
    // TODO: Implement actual transcription logic (Whisper, Google Speech, etc.)
    return 'Example transcription text'
  }
}

// Example conversation plugin (stub implementation)
const conversationPlugin: ConversationPlugin = {
  name: 'example-conversation',
  async generate(userInput, context) {
    console.log(`Generating response for: "${userInput}"`)
    console.log(`Context: sessionId=${context.sessionId}, userId=${context.userId}`)
    // TODO: Implement actual conversation logic (GPT, Mastra, etc.)
    return `Echo: ${userInput}`
  }
}

// Example synthesis plugin (stub implementation)
const synthesisPlugin: SynthesisPlugin = {
  name: 'example-synthesis',
  async synthesize(text) {
    console.log(`Synthesizing: "${text}"`)
    // TODO: Implement actual TTS logic (OpenAI TTS, AivisSpeech, etc.)
    // For now, return empty audio buffer
    return Buffer.alloc(1024)
  }
}

// Create and start the voice server
const server = new VoiceServer({
  websocket: {
    port: 3000,
    path: '/pcm/stream',
    host: '0.0.0.0'
  },
  session: {
    maxBytes: 5 * 1024 * 1024,  // 5MB
    maxDurationMs: 60_000,       // 60 seconds
    maxChunks: 200,
    idleTimeoutMs: 5_000         // 5 seconds
  },
  pipeline: {
    transcription: transcriptionPlugin,
    conversation: conversationPlugin,
    synthesis: synthesisPlugin,
    verbose: true
  }
})

// Start the server
server.start()

console.log('Voice server is running...')
console.log('- WebSocket: ws://0.0.0.0:3000/pcm/stream')
console.log('- Press Ctrl+C to stop')

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await server.stop()
  process.exit(0)
})
