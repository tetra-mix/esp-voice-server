/**
 * Custom PCM1 header format used for audio streaming
 * 16 bytes total header size
 */
export interface PcmHeader {
  /** Magic identifier - must be "PCM1" */
  magic: string
  /** Sample rate in Hz (typically 16000) */
  sample_rate: number
  /** Number of audio channels (typically 1 for mono) */
  channels: number
  /** Bits per sample (typically 16) */
  bits: number
  /** Number of samples per frame chunk (typically 320 for 20ms@16kHz) */
  frame_samps: number
  /** Reserved bytes (typically 0) */
  reserved: number
}

/**
 * Streaming session state
 */
export interface StreamingSession {
  /** Unique session identifier */
  sessionId: string
  /** Accumulated audio data chunks */
  dataChunks: Buffer[]
  /** Session start timestamp */
  startTime: number
  /** Total bytes received */
  totalBytes: number
  /** Parsed PCM header */
  header: PcmHeader | null
  /** Optional conversation ID for database linking */
  conversationId?: string
}

/**
 * Audio format information
 */
export interface AudioFormat {
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of channels */
  channels: number
  /** Bits per sample */
  bitsPerSample: number
}

/**
 * Decoded audio data with format info
 */
export interface DecodedAudio {
  /** PCM data as 16-bit signed integer array */
  pcm: Int16Array
  /** Sample rate in Hz */
  sampleRate: number
}
