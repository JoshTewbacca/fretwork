// Shared by both archive parsers: pulling the version marker out of a song
// title so that transcriptions of one song can be grouped together.
//
// Both sites distinguish versions inside the title text rather than in a
// dedicated field - gprotab with a bare trailing number ("Master of puppets
// 10"), guitarprotabs with a parenthesised one ("Master Of Puppets (2)") -
// and both use parenthesised words for arrangement variants ("(Live)",
// "(Solo)", "(s&m)").

export interface SplitTitle {
  base: string
  version?: string
}

/**
 * Splits a song title into its base title and version marker.
 *
 * A title that is *only* a version marker keeps its title and gets no version
 * ("38", "(Reprise)"), since stripping would leave nothing to group on.
 */
export function splitVersion(title: string): SplitTitle {
  const trimmed = title.trim()

  const parenthesised = /^(.*?)\s*\(([^()]+)\)$/.exec(trimmed)
  if (parenthesised && parenthesised[1].trim()) {
    return { base: parenthesised[1].trim(), version: parenthesised[2].trim() }
  }

  const numbered = /^(.*?)\s+(\d{1,2})$/.exec(trimmed)
  if (numbered && numbered[1].trim()) {
    return { base: numbered[1].trim(), version: numbered[2] }
  }

  return { base: trimmed }
}
