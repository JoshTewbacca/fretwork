// Filename-based tab format detection and title/artist guessing for imported files.
// See docs/01-data-model.md for the TabFormat union this maps into.

import type { TabFormat } from '../core/types.ts'

const EXTENSION_TO_FORMAT: Record<string, TabFormat> = {
  gp3: 'gp3',
  gp4: 'gp4',
  gp5: 'gp5',
  gpx: 'gpx',
  gp: 'gp',
  musicxml: 'musicxml',
  mxl: 'musicxml',
  xml: 'musicxml',
}

/** Suitable for an `<input type="file" accept=...>`. */
export const ACCEPT_ATTRIBUTE = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml'

function extensionOf(filename: string): string | null {
  const match = /\.([^.]+)$/.exec(filename)
  return match ? match[1].toLowerCase() : null
}

/** Maps a filename's extension to a TabFormat, case-insensitively. Unknown extensions return null. */
export function detectTabFormat(filename: string): TabFormat | null {
  const ext = extensionOf(filename)
  if (!ext) return null
  return EXTENSION_TO_FORMAT[ext] ?? null
}

/**
 * Best-effort title/artist split from a filename: strips the extension, then
 * splits on the first " - " into artist and title (e.g. "Metallica - One.gp5").
 * Without a separator, the whole (extensionless) filename becomes the title and
 * the artist falls back to "Unknown artist".
 */
export function guessTitleArtist(filename: string): { title: string; artist: string } {
  const withoutExtension = filename.replace(/\.[^.]+$/, '').trim()
  const separatorIndex = withoutExtension.indexOf(' - ')
  if (separatorIndex === -1) {
    return { title: withoutExtension, artist: 'Unknown artist' }
  }
  const artist = withoutExtension.slice(0, separatorIndex).trim()
  const title = withoutExtension.slice(separatorIndex + ' - '.length).trim()
  return { title, artist }
}
