import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, readFileSync, promises as fsPromises } from 'fs'
import { join } from 'path'
import type { DecodedAudio } from '../types/index.js'
import { createPcmWithHeader } from './pcm.js'

const execAsync = promisify(exec)

/**
 * Configuration for audio conversion
 */
export interface ConversionConfig {
  /** Path to ffmpeg binary (defaults to 'ffmpeg' in PATH) */
  ffmpegPath?: string
  /** Target sample rate for conversion */
  targetSampleRate?: number
  /** Enable verbose logging */
  verbose?: boolean
  /** Working directory for temporary files */
  tempDir?: string
}

/**
 * Convert MP3 buffer to raw PCM data using FFmpeg
 * @param mp3Buffer MP3 audio buffer
 * @param config Conversion configuration
 * @returns Raw PCM buffer or null on error
 */
export async function convertMp3ToPcm(
  mp3Buffer: Buffer,
  config: ConversionConfig = {}
): Promise<Buffer | null> {
  const {
    ffmpegPath = 'ffmpeg',
    targetSampleRate = 16000,
    verbose = false,
    tempDir = process.cwd()
  } = config

  try {
    const timestamp = Date.now()
    const tempMp3Path = join(tempDir, `temp_${timestamp}.mp3`)
    const tempPcmPath = join(tempDir, `temp_${timestamp}.pcm`)

    // Write MP3 buffer to temporary file
    writeFileSync(tempMp3Path, mp3Buffer)

    // Convert MP3 to PCM using FFmpeg with high-quality resampling
    const ffmpegCommand = `"${ffmpegPath}" -i "${tempMp3Path}" -ar ${targetSampleRate} -ac 1 -f s16le -acodec pcm_s16le -af "aresample=resampler=soxr:precision=28:dither_method=triangular" -q:a 0 "${tempPcmPath}"`

    if (verbose) {
      console.log(`Executing: ${ffmpegCommand}`)
    }

    const { stdout, stderr } = await execAsync(ffmpegCommand)

    if (verbose) {
      console.log(`FFmpeg stdout: ${stdout}`)
      console.log(`FFmpeg stderr: ${stderr}`)
    }

    // Read converted PCM file
    const pcmData = readFileSync(tempPcmPath)

    if (verbose) {
      const durationMs = (pcmData.length / 2) / targetSampleRate * 1000
      console.log(`Converted: ${pcmData.length} bytes, ${pcmData.length / 2} samples, ~${durationMs.toFixed(1)}ms @ ${targetSampleRate}Hz`)
    }

    // Cleanup temporary files
    try {
      await fsPromises.unlink(tempMp3Path)
      await fsPromises.unlink(tempPcmPath)
    } catch (cleanupError) {
      if (verbose) {
        console.warn('Failed to cleanup temp files:', cleanupError)
      }
    }

    return pcmData
  } catch (error) {
    console.error('MP3 to PCM conversion error:', error)
    return null
  }
}

/**
 * Convert MP3 buffer to PCM with PCM1 header
 * @param mp3Buffer MP3 audio buffer
 * @param config Conversion configuration
 * @returns PCM buffer with header or null on error
 */
export async function convertMp3ToPcmWithHeader(
  mp3Buffer: Buffer,
  config: ConversionConfig = {}
): Promise<Buffer | null> {
  const targetSampleRate = config.targetSampleRate ?? 16000
  const pcmData = await convertMp3ToPcm(mp3Buffer, config)

  if (!pcmData) {
    return null
  }

  return createPcmWithHeader(pcmData, targetSampleRate, 1, 16)
}

/**
 * Decode WAV buffer to Int16 mono PCM array
 * Supports multiple formats: PCM (8/16/24/32-bit) and IEEE float32
 * @param wavBuffer WAV file buffer
 * @param verbose Enable verbose logging
 * @returns Decoded audio data or null on error
 */
export function decodeWavToInt16Mono(wavBuffer: Buffer, verbose: boolean = false): DecodedAudio | null {
  if (verbose) {
    console.log(`decodeWavToInt16Mono: input length=${wavBuffer.length}`)
  }

  if (wavBuffer.length < 44) {
    console.error(`WAV buffer too small: ${wavBuffer.length} < 44`)
    return null
  }

  const riff = wavBuffer.toString('ascii', 0, 4)
  const wave = wavBuffer.toString('ascii', 8, 12)

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    console.error(`Invalid WAV headers: RIFF='${riff}', WAVE='${wave}'`)
    return null
  }

  let offset = 12
  let fmtFound = false
  let dataFound = false
  let audioFormat = 1 // 1=PCM, 3=IEEE float
  let channels = 1
  let sampleRate = 16000
  let bitsPerSample = 16
  let dataOffset = -1
  let dataSize = 0

  // Parse WAV chunks
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4)
    const chunkSize = wavBuffer.readUInt32LE(offset + 4)
    const chunkDataStart = offset + 8

    if (chunkId === 'fmt ') {
      fmtFound = true
      if (chunkSize >= 16) {
        audioFormat = wavBuffer.readUInt16LE(chunkDataStart)
        channels = wavBuffer.readUInt16LE(chunkDataStart + 2)
        sampleRate = wavBuffer.readUInt32LE(chunkDataStart + 4)
        bitsPerSample = wavBuffer.readUInt16LE(chunkDataStart + 14)
      }
    } else if (chunkId === 'data') {
      dataFound = true
      dataOffset = chunkDataStart
      dataSize = chunkSize
      break
    }

    offset = chunkDataStart + chunkSize
  }

  if (!fmtFound || !dataFound) {
    console.error('WAV missing fmt or data chunk')
    return null
  }

  if (dataOffset < 0 || dataOffset + dataSize > wavBuffer.length) {
    console.error('WAV data chunk out of bounds')
    return null
  }

  const data = wavBuffer.subarray(dataOffset, dataOffset + dataSize)

  // Decode to Int16 mono
  let out: Int16Array

  if (audioFormat === 1) {
    // PCM integer format
    const bytesPerSample = Math.ceil(bitsPerSample / 8)
    const totalFrames = Math.floor(data.length / (bytesPerSample * channels))
    out = new Int16Array(totalFrames)

    for (let i = 0; i < totalFrames; i++) {
      let acc = 0

      for (let ch = 0; ch < channels; ch++) {
        const base = (i * channels + ch) * bytesPerSample
        let sample = 0

        if (bitsPerSample === 16) {
          sample = data.readInt16LE(base)
        } else if (bitsPerSample === 24) {
          // 24-bit -> sign-extended 32-bit
          const b0 = data[base]!
          const b1 = data[base + 1]!
          const b2 = data[base + 2]!
          let v = (b2 << 16) | (b1 << 8) | b0
          if (v & 0x800000) v |= 0xff000000
          sample = (v >> 8)
        } else if (bitsPerSample === 32) {
          sample = data.readInt32LE(base) >> 16
        } else if (bitsPerSample === 8) {
          // Unsigned 8-bit PCM -> signed 16-bit
          sample = (data[base]! - 128) << 8
        } else {
          console.error(`Unsupported bit depth: ${bitsPerSample}`)
          return null
        }

        acc += sample
      }

      out[i] = Math.max(-32768, Math.min(32767, Math.round(acc / channels)))
    }
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    // IEEE float32 -> int16 mono
    const totalFrames = Math.floor(data.length / (4 * channels))
    out = new Int16Array(totalFrames)

    for (let i = 0; i < totalFrames; i++) {
      let acc = 0

      for (let ch = 0; ch < channels; ch++) {
        const base = (i * channels + ch) * 4
        const f = data.readFloatLE(base)
        const s = Math.max(-1, Math.min(1, f))
        acc += Math.round(s * 32767)
      }

      out[i] = Math.max(-32768, Math.min(32767, Math.round(acc / channels)))
    }
  } else {
    console.error(`Unsupported audio format: ${audioFormat}`)
    return null
  }

  return { pcm: out, sampleRate }
}

/**
 * Resample Int16 mono PCM array
 * Uses linear interpolation for resampling
 * @param pcm Input PCM array
 * @param srcRate Source sample rate
 * @param dstRate Destination sample rate
 * @returns Resampled PCM array
 */
export function resampleInt16Mono(pcm: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) {
    return pcm
  }

  const ratio = dstRate / srcRate
  const outLen = Math.max(1, Math.floor(pcm.length * ratio))
  const out = new Int16Array(outLen)

  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(pcm.length - 1, i0 + 1)
    const t = srcPos - i0
    const s = (1 - t) * pcm[i0]! + t * pcm[i1]!
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s)))
  }

  return out
}

/**
 * Convert WAV buffer to PCM with PCM1 header
 * @param wavBuffer WAV file buffer
 * @param targetRate Target sample rate (default: 16000)
 * @param verbose Enable verbose logging
 * @returns PCM buffer with header or null on error
 */
export function convertWavToPcmWithHeader(
  wavBuffer: Buffer,
  targetRate: number = 16000,
  verbose: boolean = false
): Buffer | null {
  if (verbose) {
    console.log(`convertWavToPcmWithHeader: input=${wavBuffer.length} bytes, target=${targetRate}Hz`)
  }

  const decoded = decodeWavToInt16Mono(wavBuffer, verbose)
  if (!decoded) {
    console.error('Failed to decode WAV')
    return null
  }

  const { pcm, sampleRate } = decoded

  if (verbose) {
    console.log(`Decoded: ${pcm.length} samples @ ${sampleRate}Hz`)
  }

  const resampled = resampleInt16Mono(pcm, sampleRate, targetRate)

  if (verbose) {
    console.log(`Resampled: ${resampled.length} samples @ ${targetRate}Hz`)
  }

  const pcmBuffer = Buffer.from(resampled.buffer, resampled.byteOffset, resampled.byteLength)
  const result = createPcmWithHeader(pcmBuffer, targetRate, 1, 16)

  if (verbose) {
    console.log(`Final: ${result.length} bytes (header + data)`)
  }

  return result
}
