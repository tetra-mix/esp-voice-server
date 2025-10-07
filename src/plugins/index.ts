import type { PcmHeader } from '../types/index.js'

/**
 * Transcription plugin interface
 * Converts audio to text
 */
export interface TranscriptionPlugin {
  /**
   * Plugin name for identification
   */
  name: string

  /**
   * Transcribe audio buffer to text
   * @param audioBuffer PCM audio data
   * @param header PCM audio format information
   * @returns Transcribed text or null on failure
   */
  transcribe(audioBuffer: Buffer, header: PcmHeader): Promise<string | null>
}

/**
 * Text-to-Speech synthesis plugin interface
 * Converts text to audio
 */
export interface SynthesisPlugin {
  /**
   * Plugin name for identification
   */
  name: string

  /**
   * Synthesize text to audio
   * @param text Text to synthesize
   * @returns Audio buffer (format varies by provider) or null on failure
   */
  synthesize(text: string): Promise<Buffer | null>
}

/**
 * Conversation context for generation
 */
export interface ConversationContext {
  /** Conversation ID */
  conversationId?: string
  /** User ID */
  userId?: string
  /** Session ID */
  sessionId: string
  /** Previous messages in conversation */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Conversation/Generation plugin interface
 * Generates responses based on input and context
 */
export interface ConversationPlugin {
  /**
   * Plugin name for identification
   */
  name: string

  /**
   * Generate response based on user input and conversation context
   * @param userInput User's input text
   * @param context Conversation context
   * @returns Generated response text or null on failure
   */
  generate(userInput: string, context: ConversationContext): Promise<string | null>

  /**
   * Optional: Store conversation history
   * @param context Conversation context
   * @param userMessage User's message
   * @param assistantMessage Assistant's response
   */
  storeHistory?(
    context: ConversationContext,
    userMessage: string,
    assistantMessage: string
  ): Promise<void>
}

/**
 * Voice processing pipeline configuration
 */
export interface PipelineConfig {
  /** Transcription plugin */
  transcription: TranscriptionPlugin
  /** Text generation/conversation plugin */
  conversation: ConversationPlugin
  /** Text-to-speech synthesis plugin */
  synthesis: SynthesisPlugin
  /** Enable verbose logging */
  verbose?: boolean
}
