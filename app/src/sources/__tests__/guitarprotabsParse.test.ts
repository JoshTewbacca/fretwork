import { describe, expect, it } from 'vitest'
import { GUITARPROTABS_ORIGIN, parseSearchHtml } from '../guitarprotabsParse.ts'

/**
 * Builds a row in the shape guitarprotabs.org actually serves: the song cell
 * wraps a link whose title attribute carries the properly-cased name with the
 * artist appended and no space after "by", while the visible text has its
 * first word lowercased by the search highlighter.
 */
function row(options: {
  href: string
  titleAttribute: string
  visible: string
  artist: string
  format: string
  downloads: string
}): string {
  return `
    <tr>
      <td class="ucwords"><a href="${options.href}" title="${options.titleAttribute}"><span Class='highlight'>${options.visible}</span></a></td>
      <td><a href="${GUITARPROTABS_ORIGIN}/m/artist/1/" title="artist">${options.artist}</a></td>
      <td>${options.format}</td>
      <td><span class="badge">${options.downloads}</span></td>
    </tr>
  `
}

const MASTER_OF_PUPPETS = row({
  href: `${GUITARPROTABS_ORIGIN}/m/metallica/master_of_puppets_11686/`,
  titleAttribute: 'Master Of Puppets byMetallica',
  visible: 'master Of Puppets',
  artist: 'Metallica',
  format: '.gp4',
  downloads: '103,009',
})

describe('parseSearchHtml', () => {
  it('parses a row into a result carrying its download count and format', () => {
    const [result] = parseSearchHtml(`<table><tbody>${MASTER_OF_PUPPETS}</tbody></table>`)

    expect(result).toEqual({
      sourceId: 'guitarprotabs',
      externalId: '/m/metallica/master_of_puppets_11686/',
      title: 'Master Of Puppets',
      artist: 'Metallica',
      url: `${GUITARPROTABS_ORIGIN}/m/metallica/master_of_puppets_11686/`,
      signals: { downloads: 103009, format: 'gp4' },
    })
  })

  it('takes the title from the link title attribute, not the mangled visible text', () => {
    const [result] = parseSearchHtml(MASTER_OF_PUPPETS)

    expect(result.title).toBe('Master Of Puppets')
  })

  it('splits the parenthesised version marker out of the title', () => {
    const html = row({
      href: `${GUITARPROTABS_ORIGIN}/m/metallica/master_of_puppets_(2)_11680/`,
      titleAttribute: 'Master Of Puppets (2) byMetallica',
      visible: 'master Of Puppets',
      artist: 'Metallica',
      format: '.gp3',
      downloads: '14,028',
    })

    const [result] = parseSearchHtml(html)

    expect(result.title).toBe('Master Of Puppets')
    expect(result.version).toBe('2')
  })

  it('decodes entities in the href so the download proxy asks for the real path', () => {
    const html = row({
      href: `${GUITARPROTABS_ORIGIN}/m/metallica/master_of_puppets_(s&amp;m)_11684/`,
      titleAttribute: 'Master Of Puppets (s&amp;m) byMetallica',
      visible: 'master Of Puppets',
      artist: 'Metallica',
      format: '.gp3',
      downloads: '3,366',
    })

    const [result] = parseSearchHtml(html)

    expect(result.externalId).toBe('/m/metallica/master_of_puppets_(s&m)_11684/')
    expect(result.version).toBe('s&m')
  })

  it('keeps an artist name containing "by" intact', () => {
    const html = row({
      href: `${GUITARPROTABS_ORIGIN}/s/standby/goodbye_1/`,
      titleAttribute: 'Goodbye byStandby',
      visible: 'goodbye',
      artist: 'Standby',
      format: '.gp5',
      downloads: '12',
    })

    const [result] = parseSearchHtml(html)

    expect(result.title).toBe('Goodbye')
    expect(result.artist).toBe('Standby')
  })

  it('skips ad rows that reuse the results table markup', () => {
    const adRow = `
      <tr>
        <td><a href="${GUITARPROTABS_ORIGIN}/ad/x/y/" title="ad"><span>ad</span></a></td>
        <td><a href="#">sponsor</a></td>
        <td></td>
        <td><ins class="adsbygoogle"></ins></td>
      </tr>
    `

    const results = parseSearchHtml(`<table>${adRow}${MASTER_OF_PUPPETS}</table>`)

    expect(results).toHaveLength(1)
    expect(results[0].artist).toBe('Metallica')
  })

  it('deduplicates by externalId, keeping the first occurrence', () => {
    const results = parseSearchHtml(MASTER_OF_PUPPETS + MASTER_OF_PUPPETS)

    expect(results).toHaveLength(1)
  })

  it('returns an empty array for a page with no results', () => {
    expect(parseSearchHtml('<html><body><p>No tabs found.</p></body></html>')).toEqual([])
  })
})
