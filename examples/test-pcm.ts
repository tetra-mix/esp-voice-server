/**
 * Test PCM processing functions
 */

import {
  parsePcmHeader,
  createPcmHeader,
  createPcmWithHeader,
  createWavHeader,
  wrapPcmToWav,
  calculateDuration
} from '../src/index.js'

console.log('Testing PCM processing functions...\n')

// Test 1: Create PCM header
console.log('━━━ Test 1: Create PCM header ━━━')
const header = createPcmHeader(16000, 1, 16, 320)
console.log('Created header:', header.length, 'bytes')
console.log('Content:', header.toString('hex'))

// Test 2: Parse PCM header
console.log('\n━━━ Test 2: Parse PCM header ━━━')
const parsed = parsePcmHeader(header.buffer)
if (parsed) {
  console.log('✓ Parsed successfully:')
  console.log('  Magic:', parsed.magic)
  console.log('  Sample rate:', parsed.sample_rate, 'Hz')
  console.log('  Channels:', parsed.channels)
  console.log('  Bits:', parsed.bits)
  console.log('  Frame samples:', parsed.frame_samps)
} else {
  console.log('✗ Failed to parse header')
}

// Test 3: Create PCM with header
console.log('\n━━━ Test 3: Create PCM with header ━━━')
const dummyPcmData = Buffer.alloc(16000 * 2) // 1 second of 16kHz 16-bit mono audio
const pcmWithHeader = createPcmWithHeader(dummyPcmData, 16000, 1, 16)
console.log('✓ Created PCM with header:', pcmWithHeader.length, 'bytes')
console.log('  Header: 16 bytes')
console.log('  Audio data:', dummyPcmData.length, 'bytes')

// Test 4: Calculate duration
console.log('\n━━━ Test 4: Calculate duration ━━━')
const duration = calculateDuration(dummyPcmData.length, 16000, 1, 16)
console.log('✓ Audio duration:', duration.toFixed(2), 'seconds')

// Test 5: Create WAV header
console.log('\n━━━ Test 5: Create WAV header ━━━')
const wavHeader = createWavHeader(dummyPcmData.length, 16000, 1, 16)
console.log('✓ Created WAV header:', wavHeader.length, 'bytes')
console.log('  RIFF:', wavHeader.slice(0, 4).toString('ascii'))
console.log('  WAVE:', wavHeader.slice(8, 12).toString('ascii'))

// Test 6: Wrap PCM to WAV
console.log('\n━━━ Test 6: Wrap PCM to WAV ━━━')
const wavData = wrapPcmToWav(dummyPcmData, 16000, 1, 16)
console.log('✓ Created WAV file:', wavData.length, 'bytes')
console.log('  Header:', 44, 'bytes')
console.log('  Audio:', dummyPcmData.length, 'bytes')

// Test 7: Invalid header
console.log('\n━━━ Test 7: Invalid header ━━━')
const invalidHeader = Buffer.from('XXXX')
const invalidParsed = parsePcmHeader(invalidHeader.buffer)
if (invalidParsed === null) {
  console.log('✓ Correctly rejected invalid header')
} else {
  console.log('✗ Should have rejected invalid header')
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('✓ All PCM tests completed')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
