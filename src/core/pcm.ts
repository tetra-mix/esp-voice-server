import type { PcmHeader, AudioFormat } from '../types/index.js'

/**
 * Parse PCM1 custom header from buffer
 * @param buffer ArrayBuffer containing header data (minimum 16 bytes)
 * @returns Parsed header object or null if invalid
 */
export function parsePcmHeader(buffer: ArrayBufferLike): PcmHeader | null {
  const view = new DataView(buffer as ArrayBuffer)

  if (buffer.byteLength < 16) {
    return null
  }

  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  )

  if (magic !== 'PCM1') {
    return null
  }

  return {
    magic,
    sample_rate: view.getUint32(4, true),  // little endian
    channels: view.getUint8(8),
    bits: view.getUint8(9),
    frame_samps: view.getUint16(10, true),
    reserved: view.getUint16(12, true)
  }
}

/**
 * Create PCM1 custom header buffer
 * @param sampleRate Sample rate in Hz
 * @param channels Number of channels (1 for mono, 2 for stereo)
 * @param bits Bits per sample (typically 16)
 * @param frameSamps Samples per frame (typically 320 for 20ms@16kHz)
 * @returns 16-byte header buffer
 */
export function createPcmHeader(
  sampleRate: number = 16000,
  channels: number = 1,
  bits: number = 16,
  frameSamps: number = 320
): Buffer {
  const headerBuffer = Buffer.alloc(16)

  // Magic "PCM1" (4 bytes)
  headerBuffer.write('PCM1', 0, 4)

  // Sample rate (4 bytes, little endian)
  headerBuffer.writeUInt32LE(sampleRate, 4)

  // Channels (1 byte)
  headerBuffer.writeUInt8(channels, 8)

  // Bits (1 byte)
  headerBuffer.writeUInt8(bits, 9)

  // Frame samples (2 bytes, little endian)
  headerBuffer.writeUInt16LE(frameSamps, 10)

  // Reserved (2 bytes)
  headerBuffer.writeUInt16LE(0, 12)

  // Padding (2 bytes)
  headerBuffer.writeUInt16LE(0, 14)

  return headerBuffer
}

/**
 * Add PCM1 header to raw PCM data
 * @param pcmData Raw PCM audio data
 * @param sampleRate Sample rate in Hz
 * @param channels Number of channels
 * @param bits Bits per sample
 * @returns PCM data with header prepended
 */
export function createPcmWithHeader(
  pcmData: Buffer,
  sampleRate: number = 16000,
  channels: number = 1,
  bits: number = 16
): Buffer {
  const header = createPcmHeader(sampleRate, channels, bits, 320)
  return Buffer.concat([header, pcmData])
}

/**
 * Create WAV file header
 * @param dataSize Size of PCM data in bytes
 * @param sampleRate Sample rate in Hz
 * @param channels Number of channels
 * @param bitsPerSample Bits per sample
 * @returns 44-byte WAV header
 */
export function createWavHeader(
  dataSize: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = sampleRate * channels * bitsPerSample / 8
  const blockAlign = channels * bitsPerSample / 8

  const header = Buffer.alloc(44)
  let offset = 0

  // RIFF header
  header.write('RIFF', offset); offset += 4
  header.writeUInt32LE(36 + dataSize, offset); offset += 4
  header.write('WAVE', offset); offset += 4

  // fmt chunk
  header.write('fmt ', offset); offset += 4
  header.writeUInt32LE(16, offset); offset += 4
  header.writeUInt16LE(1, offset); offset += 2  // PCM format
  header.writeUInt16LE(channels, offset); offset += 2
  header.writeUInt32LE(sampleRate, offset); offset += 4
  header.writeUInt32LE(byteRate, offset); offset += 4
  header.writeUInt16LE(blockAlign, offset); offset += 2
  header.writeUInt16LE(bitsPerSample, offset); offset += 2

  // data chunk
  header.write('data', offset); offset += 4
  header.writeUInt32LE(dataSize, offset)

  return header
}

/**
 * Wrap PCM data in WAV container
 * @param pcmData Raw PCM audio data
 * @param sampleRate Sample rate in Hz
 * @param channels Number of channels
 * @param bitsPerSample Bits per sample
 * @returns Complete WAV file buffer
 */
export function wrapPcmToWav(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const header = createWavHeader(pcmData.length, sampleRate, channels, bitsPerSample)
  return Buffer.concat([header, pcmData])
}

/**
 * Extract PCM data and format info from PCM1 file buffer
 * @param pcmBuffer Buffer containing PCM1 header + data
 * @returns Audio data and format, or null if invalid
 */
export function extractPcmData(pcmBuffer: Buffer): { data: Buffer; format: AudioFormat } | null {
  if (pcmBuffer.length < 16) {
    return null
  }

  const header = parsePcmHeader(pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + 16))
  if (!header) {
    return null
  }

  const audioData = pcmBuffer.subarray(16)

  return {
    data: audioData,
    format: {
      sampleRate: header.sample_rate,
      channels: header.channels,
      bitsPerSample: header.bits
    }
  }
}

/**
 * Convert PCM1 format to WAV format
 * @param pcmBuffer Buffer containing PCM1 header + data
 * @returns WAV file buffer, or null if invalid input
 */
export function convertPcmToWav(pcmBuffer: Buffer): Buffer | null {
  const extracted = extractPcmData(pcmBuffer)
  if (!extracted) {
    return null
  }

  const { data, format } = extracted
  return wrapPcmToWav(data, format.sampleRate, format.channels, format.bitsPerSample)
}

/**
 * Calculate audio duration from PCM data
 * @param dataSize Size of PCM data in bytes
 * @param sampleRate Sample rate in Hz
 * @param channels Number of channels
 * @param bitsPerSample Bits per sample
 * @returns Duration in seconds
 */
export function calculateDuration(
  dataSize: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): number {
  const bytesPerSample = (bitsPerSample / 8) * channels
  const totalSamples = dataSize / bytesPerSample
  return totalSamples / sampleRate
}
