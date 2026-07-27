import { describe, expect, it } from 'vitest'
import {
  GPROTAB_ORIGIN,
  filenameFromContentDisposition,
  parseSearchHtml,
} from '../gprotabParse.ts'

function anchorPair(artistHref: string, artistName: string, songHref: string, songName: string): string {
  return `<a href="${artistHref}" class="tab-band">${artistName}</a>\n<a href="${songHref}" class="tab-name">${songName}</a>`
}

describe('parseSearchHtml', () => {
  it('parses a normal multi-result page in document order', () => {
    const html = `
      <div class="results">
        ${anchorPair('/en/tabs/metallica', 'Metallica', '/en/tabs/metallica/one', 'One')}
        ${anchorPair('/en/tabs/tool', 'Tool', '/en/tabs/tool/lateralus', 'Lateralus')}
      </div>
    `

    const results = parseSearchHtml(html)

    expect(results).toEqual([
      {
        sourceId: 'gprotab',
        externalId: '/en/tabs/metallica/one',
        title: 'One',
        artist: 'Metallica',
        url: `${GPROTAB_ORIGIN}/en/tabs/metallica/one`,
      },
      {
        sourceId: 'gprotab',
        externalId: '/en/tabs/tool/lateralus',
        title: 'Lateralus',
        artist: 'Tool',
        url: `${GPROTAB_ORIGIN}/en/tabs/tool/lateralus`,
      },
    ])
  })

  it('decodes HTML entities in artist and title text', () => {
    const html = anchorPair(
      '/en/tabs/guns-n-roses',
      'Guns &amp; Roses',
      '/en/tabs/guns-n-roses/dont-cry',
      'Don&#39;t Cry &quot;Live&quot; &lt;Remastered&gt;',
    )

    const [result] = parseSearchHtml(html)

    expect(result.artist).toBe('Guns & Roses')
    expect(result.title).toBe('Don\'t Cry "Live" <Remastered>')
  })

  it('collapses doubled internal whitespace in names', () => {
    const html = anchorPair(
      '/en/tabs/pink-floyd',
      'Pink  Floyd',
      '/en/tabs/pink-floyd/time',
      'Time  (Live  In  Pompeii)',
    )

    const [result] = parseSearchHtml(html)

    expect(result.artist).toBe('Pink Floyd')
    expect(result.title).toBe('Time (Live In Pompeii)')
  })

  it('skips an artist anchor with no following song anchor', () => {
    const html = `
      <a href="/en/tabs/orphan-artist" class="tab-band">Orphan Artist</a>
      <div>no song anchor follows</div>
      ${anchorPair('/en/tabs/rush', 'Rush', '/en/tabs/rush/tom-sawyer', 'Tom Sawyer')}
    `

    const results = parseSearchHtml(html)

    expect(results).toHaveLength(1)
    expect(results[0].externalId).toBe('/en/tabs/rush/tom-sawyer')
  })

  it('deduplicates by externalId, keeping the first occurrence', () => {
    const html = `
      ${anchorPair('/en/tabs/rush', 'Rush', '/en/tabs/rush/tom-sawyer', 'Tom Sawyer')}
      ${anchorPair('/en/tabs/rush', 'Rush (dup)', '/en/tabs/rush/tom-sawyer', 'Tom Sawyer (dup)')}
    `

    const results = parseSearchHtml(html)

    expect(results).toHaveLength(1)
    expect(results[0].artist).toBe('Rush')
    expect(results[0].title).toBe('Tom Sawyer')
  })

  it('returns an empty array for a page with no results', () => {
    const html = '<html><body><p>No tabs found.</p></body></html>'

    expect(parseSearchHtml(html)).toEqual([])
  })
})

describe('filenameFromContentDisposition', () => {
  it('parses the quoted form', () => {
    expect(filenameFromContentDisposition('attachment; filename="one.gp3"')).toBe('one.gp3')
  })

  it('parses the unquoted form', () => {
    expect(filenameFromContentDisposition('attachment; filename=one.gp3')).toBe('one.gp3')
  })

  it('returns null when the header is absent', () => {
    expect(filenameFromContentDisposition(null)).toBeNull()
  })

  it('returns null when there is no filename in the header', () => {
    expect(filenameFromContentDisposition('attachment')).toBeNull()
  })
})
