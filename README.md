# esp-voice-server

High-performance WebSocket-based voice processing backend for ESP32/M5Stack devices with real-time audio streaming, transcription, and synthesis.

## Features

- **WebSocket PCM Streaming**: Custom PCM1 protocol for efficient audio streaming
- **Plugin Architecture**: Flexible plugin system for transcription, synthesis, and conversation
- **Session Management**: Automatic session lifecycle and buffer management
- **M5Stack Compatible**: Optimized for M5Stack ESP32 devices with RSV bit handling
- **TypeScript**: Full type safety and IDE support
- **Modular Design**: Use only what you need - high-level server or low-level components
- **Zero Environment Variables**: All configuration via code

## What This Library Provides

`esp-voice-server` is a framework that **abstracts the low-level complexity** of WebSocket-based voice streaming for ESP32/M5Stack devices. Think of it as "Express for voice streaming."

### What's Included
- ✅ WebSocket server with PCM1 protocol support
- ✅ Session management and audio buffering
- ✅ Audio format conversion utilities (MP3/WAV ↔ PCM)
- ✅ M5Stack-specific compatibility handling
- ✅ Plugin interfaces for extensibility

### What's NOT Included (You Implement)
- ❌ Speech recognition (Whisper, Google Speech, etc.)
- ❌ LLM integration (GPT, Claude, Mastra, etc.)
- ❌ Text-to-speech engines (OpenAI TTS, AivisSpeech, etc.)
- ❌ Database operations

**Focus on your business logic, not protocol details.**

## Installation

```bash
npm install esp-voice-server
# or
pnpm add esp-voice-server
# or
yarn add esp-voice-server
```

### Peer Dependencies

Install based on which services you want to use:

```bash
# For OpenAI Whisper transcription and TTS
npm install openai

# For Google Cloud Speech
npm install @google-cloud/speech
```

## Quick Start

```typescript
import { VoiceServer } from 'esp-voice-server'
import type { TranscriptionPlugin, ConversationPlugin, SynthesisPlugin } from 'esp-voice-server'

// 1. Implement transcription plugin
const transcriptionPlugin: TranscriptionPlugin = {
  name: 'whisper',
  async transcribe(audioBuffer, header) {
    // Your transcription logic here
    return 'transcribed text'
  }
}

// 2. Implement conversation plugin
const conversationPlugin: ConversationPlugin = {
  name: 'gpt',
  async generate(userInput, context) {
    // Your conversation logic here
    return 'generated response'
  }
}

// 3. Implement synthesis plugin
const synthesisPlugin: SynthesisPlugin = {
  name: 'tts',
  async synthesize(text) {
    // Your TTS logic here
    return Buffer.from([/* audio data */])
  }
}

// 4. Create and start server
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

server.start()

// Graceful shutdown
process.on('SIGINT', async () => {
  await server.stop()
  process.exit(0)
})
```

## Complete Plugin Examples

### OpenAI Whisper Transcription

```typescript
import OpenAI from 'openai'
import { wrapPcmToWav } from 'esp-voice-server'
import type { TranscriptionPlugin, PcmHeader } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const whisperPlugin: TranscriptionPlugin = {
  name: 'openai-whisper',
  async transcribe(audioBuffer: Buffer, header: PcmHeader): Promise<string | null> {
    try {
      // Convert PCM to WAV format
      const wavBuffer = wrapPcmToWav(
        audioBuffer,
        header.sample_rate,
        header.channels,
        header.bits
      )

      // Create File object for OpenAI API
      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      // Transcribe with Whisper
      const response = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'ja' // or 'en'
      })

      return response.text
    } catch (error) {
      console.error('Whisper transcription error:', error)
      return null
    }
  }
}
```

### GPT Conversation

```typescript
import OpenAI from 'openai'
import type { ConversationPlugin, ConversationContext } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const gptPlugin: ConversationPlugin = {
  name: 'gpt-4o-mini',
  async generate(userInput: string, context: ConversationContext): Promise<string | null> {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'あなたは優しく会話する音声アシスタントです。'
          },
          {
            role: 'user',
            content: userInput
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })

      return response.choices[0]?.message?.content || null
    } catch (error) {
      console.error('GPT generation error:', error)
      return null
    }
  }
}
```

### OpenAI TTS Synthesis

```typescript
import OpenAI from 'openai'
import { convertMp3ToPcmWithHeader } from 'esp-voice-server'
import type { SynthesisPlugin } from 'esp-voice-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const ttsPlugin: SynthesisPlugin = {
  name: 'openai-tts',
  async synthesize(text: string): Promise<Buffer | null> {
    try {
      // Generate speech with OpenAI TTS
      const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'mp3'
      })

      const mp3Buffer = Buffer.from(await mp3Response.arrayBuffer())

      // Convert MP3 to PCM with header for M5Stack
      const pcmWithHeader = await convertMp3ToPcmWithHeader(mp3Buffer, {
        targetSampleRate: 16000,
        verbose: false
      })

      return pcmWithHeader
    } catch (error) {
      console.error('TTS synthesis error:', error)
      return null
    }
  }
}
```

### Complete Server Example

```typescript
import { VoiceServer } from 'esp-voice-server'

const server = new VoiceServer({
  websocket: {
    port: 3000,
    path: '/pcm/stream',
    host: '0.0.0.0',
    pingInterval: 15000,           // Heartbeat interval
    maxPayload: 10 * 1024 * 1024,  // 10MB max message size
    perMessageDeflate: false,      // Disable for M5Stack compatibility
    skipUTF8Validation: true       // M5Stack RSV bit compatibility
  },
  session: {
    maxBytes: 5 * 1024 * 1024,  // 5MB max audio per session
    maxDurationMs: 60_000,       // 60 second timeout
    maxChunks: 200,              // Max 200 audio chunks
    idleTimeoutMs: 5_000         // 5 second idle timeout
  },
  pipeline: {
    transcription: whisperPlugin,
    conversation: gptPlugin,
    synthesis: ttsPlugin,
    verbose: true  // Enable debug logging
  }
})

server.start()
console.log('✓ Voice server running on ws://0.0.0.0:3000/pcm/stream')
```

## Architecture

### Core Modules

- **PCM Processing** (`core/pcm.ts`): PCM1 header parsing, WAV conversion, audio utilities
- **Audio Conversion** (`core/audio-conversion.ts`): MP3/WAV conversion, resampling, decoding
- **WebSocket Server** (`core/websocket.ts`): WebSocket server with PCM1 protocol support
- **Session Management** (`core/session.ts`): Streaming session lifecycle and buffering

### Plugin System

The library uses a plugin architecture for maximum flexibility:

#### TranscriptionPlugin
Convert audio to text:
```typescript
interface TranscriptionPlugin {
  name: string
  transcribe(audioBuffer: Buffer, header: PcmHeader): Promise<string | null>
}
```

Supported implementations:
- OpenAI Whisper
- Google Cloud Speech-to-Text
- Azure Speech Services
- Custom model integrations

#### ConversationPlugin
Generate conversational responses:
```typescript
interface ConversationPlugin {
  name: string
  generate(userInput: string, context: ConversationContext): Promise<string | null>
  storeHistory?(context: ConversationContext, userMessage: string, assistantMessage: string): Promise<void>
}
```

Supported implementations:
- OpenAI GPT-4/GPT-3.5
- Anthropic Claude
- Google Gemini
- Mastra workflows
- Custom LLM integrations

#### SynthesisPlugin
Convert text to audio:
```typescript
interface SynthesisPlugin {
  name: string
  synthesize(text: string): Promise<Buffer | null>
}
```

Supported implementations:
- OpenAI TTS
- AivisSpeech (Japanese)
- Google Cloud Text-to-Speech
- Azure Speech Services
- Custom TTS engines

## PCM1 Protocol

The library uses a custom PCM1 header format for efficient audio streaming:

```
Bytes 0-3:   Magic "PCM1"
Bytes 4-7:   Sample rate (uint32, little endian)
Byte 8:      Channels (uint8)
Byte 9:      Bits per sample (uint8)
Bytes 10-11: Frame samples (uint16, little endian)
Bytes 12-13: Reserved (uint16)
Bytes 14-15: Padding (uint16)
```

**Typical configuration**: 16kHz, 16-bit, mono, 320 samples/frame (20ms)

### Protocol Flow

1. **Client → Server**: PCM1 header (16 bytes)
2. **Server → Client**: JSON acknowledgment
3. **Client → Server**: Audio chunks (PCM data)
4. **Client → Server**: END signal (text "END" + null byte)
5. **Server**: Process audio through pipeline
6. **Server → Client**: Transcription (JSON)
7. **Server → Client**: Response text (JSON)
8. **Server → Client**: Synthesized audio (PCM1 format)
9. **Server → Client**: New session ready (JSON)

### WebSocket Messages

#### Client to Server
```typescript
// Binary: PCM1 header + audio data
Buffer: [PCM1 magic][sample_rate][channels][bits][frame_samps][reserved][audio data...]

// Text: Control messages
"END\0"           // End current stream
"AUTH:user_id"    // Authenticate session
```

#### Server to Client
```typescript
// JSON: Status messages
{ type: 'header_received', sessionId: '...', format: {...} }
{ type: 'transcription', text: '...' }
{ type: 'response', text: '...' }
{ type: 'session_ready', sessionId: '...' }
{ type: 'auth_success', userId: '...' }
{ type: 'error', message: '...' }

// Binary: Audio response (PCM1 format + "END\0" marker)
```

## Advanced Usage

### Using Core Modules Only

If you don't need the full pipeline and want to handle processing manually:

```typescript
import { VoiceWebSocketServer, SessionManager } from 'esp-voice-server'

// Create session manager
const sessionManager = new SessionManager({
  maxBytes: 5 * 1024 * 1024,
  maxDurationMs: 60_000,
  maxChunks: 200,
  idleTimeoutMs: 5_000
}, {
  onCreate: (session) => console.log(`Session ${session.sessionId} created`),
  onEnd: (session) => console.log(`Session ${session.sessionId} ended`),
  onLimitExceeded: (session, reason) => console.warn(`Limit exceeded: ${reason}`)
})

// Create WebSocket server
const wsServer = new VoiceWebSocketServer({
  port: 3000,
  path: '/pcm/stream'
}, {
  onConnection: (ws, sessionId) => {
    sessionManager.createSession(sessionId)
  },
  onMessage: async (ws, sessionId, message) => {
    if (message.type === 'header') {
      // Store PCM header
      sessionManager.setHeader(sessionId, message.header)
      console.log('Header:', message.header)
    } else if (message.type === 'audio') {
      // Buffer audio chunks
      sessionManager.addChunk(sessionId, message.data)
    } else if (message.type === 'end') {
      // Get all buffered audio
      const audioData = sessionManager.getAudioData(sessionId)

      // Process audio manually here
      // ...

      await sessionManager.endSession(sessionId)
    }
  },
  onClose: (ws, sessionId) => {
    sessionManager.endSession(sessionId)
  }
})

wsServer.start()
```

### Audio Format Conversion Utilities

The library provides utilities for converting between audio formats:

```typescript
import {
  convertMp3ToPcmWithHeader,
  convertWavToPcmWithHeader,
  wrapPcmToWav,
  parsePcmHeader
} from 'esp-voice-server'

// Convert MP3 to PCM with PCM1 header
const pcmWithHeader = await convertMp3ToPcmWithHeader(mp3Buffer, {
  targetSampleRate: 16000,
  verbose: true
})

// Convert WAV to PCM with PCM1 header
const pcmWithHeader2 = convertWavToPcmWithHeader(wavBuffer, 16000)

// Wrap raw PCM data in WAV container
const wavBuffer = wrapPcmToWav(
  pcmData,      // Raw PCM data
  16000,        // Sample rate
  1,            // Channels (mono)
  16            // Bits per sample
)

// Parse PCM1 header from buffer
const { header, pcmData } = parsePcmHeader(buffer)
console.log('Sample rate:', header.sample_rate)
console.log('Channels:', header.channels)
console.log('Bits:', header.bits)
```

### Session Management API

The `SessionManager` provides detailed session control:

```typescript
// Create session
const session = sessionManager.createSession('session-123')

// Set PCM header
sessionManager.setHeader('session-123', pcmHeader)

// Add audio chunks
sessionManager.addChunk('session-123', audioBuffer)

// Get session info
const session = sessionManager.getSession('session-123')
console.log('Total bytes:', session?.totalBytes)

// Get all buffered audio
const audioData = sessionManager.getAudioData('session-123')

// Get session statistics
const stats = sessionManager.getStats('session-123')
console.log('Duration:', stats?.duration)
console.log('Chunk count:', stats?.chunkCount)

// Store custom data in session
sessionManager.setSessionData('session-123', 'userId', 'user-456')
const userId = sessionManager.getSessionData('session-123', 'userId')

// End session and clean up
await sessionManager.endSession('session-123')

// Clear all sessions
await sessionManager.clearAll()
```

### Custom Authentication

Implement user authentication in your server:

```typescript
const server = new VoiceServer({
  // ... config ...
})

// Handle authentication at WebSocket level
const wsServer = server.getSessionManager()

// Client sends: "AUTH:user_id_here"
// Server receives it as text message and stores userId in session
```

Client-side (M5Stack):
```cpp
// Send authentication after connection
webSocket.sendTXT("AUTH:user_12345");
```

### M5Stack Client Example

Basic M5Stack WebSocket client for PCM streaming:

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>

WebSocketsClient webSocket;

// PCM1 header structure
struct PcmHeader {
    char magic[4];        // "PCM1"
    uint32_t sample_rate; // 16000
    uint8_t channels;     // 1
    uint8_t bits;         // 16
    uint16_t frame_samps; // 320
    uint16_t reserved;    // 0
};

void setup() {
    // Connect to WiFi
    WiFi.begin("SSID", "password");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
    }

    // Connect to voice server
    webSocket.begin("192.168.1.100", 3000, "/pcm/stream");
    webSocket.onEvent(webSocketEvent);
}

void loop() {
    webSocket.loop();

    // Send PCM header (once at start of stream)
    PcmHeader header = {
        .magic = {'P', 'C', 'M', '1'},
        .sample_rate = 16000,
        .channels = 1,
        .bits = 16,
        .frame_samps = 320,
        .reserved = 0
    };
    webSocket.sendBIN((uint8_t*)&header, sizeof(header));

    // Send audio chunks
    int16_t audioBuffer[320]; // 20ms at 16kHz
    // ... fill audioBuffer with microphone data ...
    webSocket.sendBIN((uint8_t*)audioBuffer, sizeof(audioBuffer));

    // Send END signal when done
    webSocket.sendTXT("END\0");
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch(type) {
        case WStype_TEXT:
            Serial.printf("Text: %s\n", payload);
            break;
        case WStype_BIN:
            // Received audio response
            playAudio(payload, length);
            break;
    }
}
```

## Configuration Reference

### WebSocketConfig

```typescript
interface WebSocketConfig {
  port: number                    // Port to listen on (required)
  host?: string                   // Host to bind to (default: '0.0.0.0')
  path?: string                   // WebSocket path (default: '/pcm/stream')
  pingInterval?: number           // Heartbeat interval in ms (default: 15000)
  maxPayload?: number             // Max message size in bytes (default: 10MB)
  perMessageDeflate?: boolean     // Enable compression (default: false for M5Stack)
  skipUTF8Validation?: boolean    // Skip UTF-8 validation (default: true for M5Stack)
}
```

### SessionConfig

```typescript
interface SessionConfig {
  maxBytes?: number         // Max session size in bytes (default: 5MB)
  maxDurationMs?: number    // Max session duration in ms (default: 60s)
  maxChunks?: number        // Max audio chunks (default: 200)
  idleTimeoutMs?: number    // Idle timeout in ms (default: 5s)
}
```

### PipelineConfig

```typescript
interface PipelineConfig {
  transcription: TranscriptionPlugin    // Speech-to-text plugin
  conversation: ConversationPlugin      // LLM conversation plugin
  synthesis: SynthesisPlugin            // Text-to-speech plugin
  verbose?: boolean                     // Enable debug logging (default: false)
}
```

## Troubleshooting

### M5Stack Connection Issues

**Problem**: WebSocket connection fails or disconnects immediately

**Solutions**:
- Ensure `perMessageDeflate: false` in server config
- Ensure `skipUTF8Validation: true` in server config
- Check network connectivity between M5Stack and server
- Verify server IP and port in M5Stack code
- Check firewall rules on server

### Audio Quality Issues

**Problem**: Audio is distorted or has gaps

**Solutions**:
- Verify sample rate matches on both client and server (16kHz recommended)
- Check network stability - WiFi signal strength
- Reduce `frame_samps` for lower latency (e.g., 160 samples = 10ms)
- Monitor session statistics for dropped chunks
- Ensure sufficient buffer size on M5Stack

### Transcription Failures

**Problem**: Transcription returns null or empty

**Solutions**:
- Check API keys are set correctly
- Verify audio format is correct (16kHz, 16-bit, mono)
- Ensure sufficient audio duration (minimum ~0.5 seconds)
- Check API rate limits and quotas
- Enable `verbose: true` for debug logs

### Memory Issues

**Problem**: Server crashes or runs out of memory

**Solutions**:
- Reduce `maxBytes` in session config
- Reduce `maxChunks` in session config
- Ensure sessions are properly ended
- Monitor session cleanup with callbacks
- Use `idleTimeoutMs` to clean up stale sessions

## API Reference

See the [TypeScript definitions](./src/types/index.ts) and [source code](./src/) for complete API documentation.

## License

MIT

## Repository

https://github.com/tetra-mix/esp-voice-server

## Author

tetra-mix
