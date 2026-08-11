// Telling the browser what a downloaded recording actually is.
//
// The desktop serves every blob as application/octet-stream - the blob store is
// content-addressed, so the files are named by hash and carry no extension to
// infer a type from - and the phone stores exactly what it was handed. That
// type then rides on the object URL into the audio element.
//
// Chrome sniffs the bytes and plays it anyway. Safari does not: it treats the
// Blob's type as the resource's media type, and an <audio> pointed at
// application/octet-stream fails to load with MEDIA_ERR_SRC_NOT_SUPPORTED
// before it ever looks at the contents. So sniff the container here and re-type
// the blob on the way to the element.

/** Bytes needed to identify every container below. */
export const AUDIO_SNIFF_BYTES = 12

/**
 * The media type of the container `header` begins, or null when it is not one
 * we recognise. Covers what the ingest side encodes (Opus in Ogg, AAC in MP4)
 * plus the formats a source file is likely to already be in.
 */
export function sniffAudioType(header: Uint8Array): string | null {
  const at = (offset: number, ascii: string) =>
    [...ascii].every((char, i) => header[offset + i] === char.charCodeAt(0))

  // Opus and Vorbis both ride in Ogg. Which one is inside the first page, and
  // the element does not need us to say.
  if (at(0, 'OggS')) return 'audio/ogg'
  // ISO base media, which is the .m4a the AAC encoder writes.
  if (at(4, 'ftyp')) return 'audio/mp4'
  if (at(0, 'fLaC')) return 'audio/flac'
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav'
  // MP3: an ID3 tag, or a bare first frame (sync is 0xFF then three set bits).
  if (at(0, 'ID3')) return 'audio/mpeg'
  if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  return null
}

/**
 * The same bytes, typed so a media element will accept them. Returns the blob
 * untouched when it already carries a media type or the container is unknown -
 * guessing wrong would be worse than leaving the browser to sniff. `slice`
 * re-types without copying the data.
 */
export async function asPlayableAudio(blob: Blob): Promise<Blob> {
  if (blob.type.startsWith('audio/') || blob.type.startsWith('video/')) return blob
  const header = new Uint8Array(await blob.slice(0, AUDIO_SNIFF_BYTES).arrayBuffer())
  const type = sniffAudioType(header)
  return type ? blob.slice(0, blob.size, type) : blob
}
