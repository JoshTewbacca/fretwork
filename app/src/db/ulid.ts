// Dependency-free ULID generator (https://github.com/ulid/spec).
// 26 chars: 48-bit ms timestamp (10 chars) + 80 bits of randomness (16 chars),
// Crockford base32 encoded. Not monotonic within the same millisecond; the spec's
// monotonic-increment mode isn't needed for this project's usage (event ids, mostly
// generated one at a time).

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32, no I L O U
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number): string {
  let mut = now
  let str = ''
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = mut % ENCODING_LEN
    str = ENCODING.charAt(mod) + str
    mut = (mut - mod) / ENCODING_LEN
  }
  return str
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(bytes)
  let str = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Each output char only needs 5 bits of entropy; a byte per char wastes range but
    // keeps this simple and dependency-free.
    str += ENCODING.charAt(bytes[i] % ENCODING_LEN)
  }
  return str
}

/** Generates a new ULID using the current time. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}
