import { describe, expect, it } from 'vitest'
import { asPlayableAudio, sniffAudioType } from '../mediaType.ts'

function header(...parts: (string | number)[]): Uint8Array<ArrayBuffer> {
  const bytes: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') bytes.push(part)
    else for (const char of part) bytes.push(char.charCodeAt(0))
  }
  return new Uint8Array(bytes)
}

describe('sniffAudioType', () => {
  it('recognises Ogg, which is what the default Opus encode produces', () => {
    expect(sniffAudioType(header('OggS', 0, 2, 0, 0, 0, 0, 0, 0))).toBe('audio/ogg')
  })

  it('recognises the .m4a the AAC fallback produces', () => {
    expect(sniffAudioType(header(0, 0, 0, 0x20, 'ftypM4A '))).toBe('audio/mp4')
  })

  it('recognises MP3 with a tag and without one', () => {
    expect(sniffAudioType(header('ID3', 3, 0, 0, 0, 0, 0, 0))).toBe('audio/mpeg')
    expect(sniffAudioType(header(0xff, 0xfb, 0x90, 0x44))).toBe('audio/mpeg')
  })

  it('recognises wav and flac', () => {
    expect(sniffAudioType(header('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe('audio/wav')
    expect(sniffAudioType(header('fLaC', 0, 0, 0, 0x22))).toBe('audio/flac')
  })

  it('returns null rather than guessing at bytes it does not know', () => {
    expect(sniffAudioType(header('NOPE', 1, 2, 3, 4))).toBeNull()
    expect(sniffAudioType(new Uint8Array())).toBeNull()
  })
})

describe('asPlayableAudio', () => {
  it('re-types the octet-stream the desktop serves, keeping the bytes', async () => {
    const bytes = header('OggS', 0, 2, 0, 0, 0, 0, 0, 0)
    const blob = new Blob([bytes], { type: 'application/octet-stream' })

    const typed = await asPlayableAudio(blob)

    expect(typed.type).toBe('audio/ogg')
    expect(new Uint8Array(await typed.arrayBuffer())).toEqual(bytes)
  })

  it('leaves a blob that already names an audio type alone', async () => {
    const blob = new Blob([header('OggS', 0, 2, 0, 0, 0, 0, 0, 0)], { type: 'audio/mp4' })

    expect((await asPlayableAudio(blob)).type).toBe('audio/mp4')
  })

  it('leaves bytes it cannot identify to the browser to sniff', async () => {
    const blob = new Blob([header('NOPE', 1, 2, 3, 4)], { type: 'application/octet-stream' })

    expect((await asPlayableAudio(blob)).type).toBe('application/octet-stream')
  })
})
