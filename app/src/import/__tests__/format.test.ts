import { describe, expect, it } from 'vitest'
import { ACCEPT_ATTRIBUTE, detectTabFormat, guessTitleArtist } from '../format.ts'

describe('detectTabFormat', () => {
  it.each([
    ['song.gp3', 'gp3'],
    ['song.GP4', 'gp4'],
    ['song.gp5', 'gp5'],
    ['song.gpx', 'gpx'],
    ['song.gp', 'gp'],
    ['song.musicxml', 'musicxml'],
    ['song.MXL', 'musicxml'],
    ['song.xml', 'musicxml'],
  ])('maps %s to %s', (filename, expected) => {
    expect(detectTabFormat(filename)).toBe(expected)
  })

  it('returns null for unknown or missing extensions', () => {
    expect(detectTabFormat('song.txt')).toBeNull()
    expect(detectTabFormat('song.pdf')).toBeNull()
    expect(detectTabFormat('song')).toBeNull()
  })

  it('exposes an accept attribute covering all supported extensions', () => {
    for (const ext of ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.mxl', '.xml']) {
      expect(ACCEPT_ATTRIBUTE).toContain(ext)
    }
  })
})

describe('guessTitleArtist', () => {
  it('splits artist and title on the first " - "', () => {
    expect(guessTitleArtist('Metallica - One.gp5')).toEqual({
      title: 'One',
      artist: 'Metallica',
    })
  })

  it('only splits on the first separator when the title itself contains " - "', () => {
    expect(guessTitleArtist('Guns N Roses - Knockin - On Heavens Door.gp4')).toEqual({
      title: 'Knockin - On Heavens Door',
      artist: 'Guns N Roses',
    })
  })

  it('falls back to "Unknown artist" when there is no separator', () => {
    expect(guessTitleArtist('OneMoreLight.gpx')).toEqual({
      title: 'OneMoreLight',
      artist: 'Unknown artist',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(guessTitleArtist('  Metallica - One  .gp5')).toEqual({
      title: 'One',
      artist: 'Metallica',
    })
  })
})
