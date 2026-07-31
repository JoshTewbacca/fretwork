import * as searchStore from '../../search/searchStore.ts'
import type { SongGroup } from '../../search/grouping.ts'
import { addSearchResultToLibrary } from '../../search/addFromSource.ts'
import { getTabSource } from '../../sources/index.ts'
import type { TabSearchResult } from '../../sources/types.ts'
import { openSong } from '../../library/openSong.ts'
import '../screens/screens.css'
import '../../search/search.css'

async function onAdd(result: TabSearchResult): Promise<void> {
  searchStore.addingId.value = result.externalId
  searchStore.addErrorMessage.value = ''
  try {
    const source = getTabSource(result.sourceId)
    if (!source) {
      throw new Error('That tab came from a source this build no longer supports.')
    }
    const song = await addSearchResultToLibrary(source, result)
    openSong(song.id)
  } catch (err) {
    searchStore.addErrorMessage.value =
      err instanceof Error ? err.message : 'Could not add this tab. Try again.'
  } finally {
    searchStore.addingId.value = null
  }
}

/**
 * The line under a version: what we know about it, worst case just the source.
 * Download counts are the reason the second source was added, so they lead.
 */
function versionFacts(result: TabSearchResult): string {
  const source = getTabSource(result.sourceId)
  const facts: string[] = []

  const downloads = result.signals?.downloads
  if (downloads !== undefined) {
    facts.push(`${downloads.toLocaleString()} downloads`)
  }

  const votes = result.signals?.ratingVotes
  const rating = result.signals?.ratingValue
  if (rating !== undefined && votes !== undefined) {
    facts.push(`${rating}/5 from ${votes} ${votes === 1 ? 'vote' : 'votes'}`)
  }

  if (result.signals?.format !== undefined) {
    facts.push(result.signals.format)
  }

  if (source) facts.push(source.label)
  return facts.join(' · ')
}

function versionLabel(result: TabSearchResult): string {
  if (result.version === undefined) return 'Version 1'
  return /^\d+$/.test(result.version) ? `Version ${result.version}` : result.version
}

function VersionRow({ result }: { result: TabSearchResult }) {
  const isAdding = searchStore.addingId.value === result.externalId
  return (
    <li class="search-version">
      <div class="search-version__text">
        <div class="search-version__label">{versionLabel(result)}</div>
        <div class="search-version__facts">{versionFacts(result)}</div>
      </div>
      <button
        type="button"
        class="btn btn--small search-row__add"
        disabled={isAdding}
        onClick={() => void onAdd(result)}
      >
        {isAdding ? 'Adding…' : 'Add'}
      </button>
    </li>
  )
}

function GroupCard({ group }: { group: SongGroup }) {
  const [best, ...rest] = group.versions
  const isAdding = searchStore.addingId.value === best.externalId
  const isExpanded = searchStore.expandedGroups.value.has(group.key)

  return (
    <li class="card">
      <div class="card__top">
        <div class="card__text">
          <div class="card__title">{group.title}</div>
          <div class="card__sub">{group.artist}</div>
          <div class="card__sub search-best__facts">{versionFacts(best)}</div>
        </div>
        <button
          type="button"
          class="btn btn--small search-row__add"
          disabled={isAdding}
          onClick={() => void onAdd(best)}
        >
          {isAdding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            class="search-versions__toggle"
            aria-expanded={isExpanded}
            onClick={() => searchStore.toggleGroup(group.key)}
          >
            {isExpanded
              ? 'Hide other versions'
              : `${rest.length} other ${rest.length === 1 ? 'version' : 'versions'}`}
          </button>
          {isExpanded && (
            <ul class="search-versions">
              {rest.map((result) => (
                <VersionRow key={`${result.sourceId}:${result.externalId}`} result={result} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}

export function SearchScreen() {
  const state = searchStore.state.value
  const groups = searchStore.groups.value

  function onSubmit(e: Event) {
    e.preventDefault()
    void searchStore.runSearch()
  }

  return (
    <div class="search-screen">
      <h1 class="screen-title">Search</h1>
      <form class="search-form" onSubmit={onSubmit}>
        <input
          type="search"
          class="input search-input"
          placeholder="Song title"
          aria-label="Song title"
          value={searchStore.query.value}
          onInput={(e) => {
            searchStore.query.value = (e.currentTarget as HTMLInputElement).value
          }}
          // Implicit form submission is not reliable for type="search" across
          // browsers, and the iOS keyboard's Go key is the natural way to run
          // a search on a phone. Handle Enter explicitly so it always works.
          onKeyDown={(e) => {
            if ((e as KeyboardEvent).key === 'Enter') {
              e.preventDefault()
              void searchStore.runSearch()
            }
          }}
        />
        <button type="submit" class="button button--primary search-submit">
          Search
        </button>
      </form>
      <p class="search-helper">Search by song title. Artist names alone return weaker results.</p>

      {state === 'idle' && (
        <div class="screen-placeholder">
          <p>Type a song title above to find a tab.</p>
        </div>
      )}

      {state === 'searching' && (
        <div class="screen-placeholder">
          <p>Searching...</p>
        </div>
      )}

      {state === 'error' && (
        <div class="screen-placeholder">
          <p>{searchStore.errorMessage.value}</p>
          {searchStore.errorRetryable.value && (
            <button type="button" class="button" onClick={() => void searchStore.runSearch()}>
              Retry
            </button>
          )}
        </div>
      )}

      {state === 'done' && groups.length === 0 && (
        <div class="screen-placeholder">
          <p>No tabs found for that search.</p>
        </div>
      )}

      {state === 'done' && groups.length > 0 && (
        <>
          {searchStore.partialWarning.value && (
            <p class="search-partial">{searchStore.partialWarning.value}</p>
          )}
          <ul class="search-results">
            {groups.map((group) => (
              <GroupCard key={group.key} group={group} />
            ))}
          </ul>
          {searchStore.addErrorMessage.value && (
            <p class="search-add-error">{searchStore.addErrorMessage.value}</p>
          )}
          <p class="search-attribution">Results from gprotab.net and guitarprotabs.org</p>
        </>
      )}
    </div>
  )
}
