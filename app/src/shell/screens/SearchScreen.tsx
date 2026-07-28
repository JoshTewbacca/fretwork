import * as searchStore from '../../search/searchStore.ts'
import { addSearchResultToLibrary } from '../../search/addFromSource.ts'
import { gprotabSource } from '../../sources/gprotabSource.ts'
import type { TabSearchResult } from '../../sources/types.ts'
import { openSong } from '../../library/openSong.ts'
import '../screens/screens.css'
import '../../search/search.css'

async function onAdd(result: TabSearchResult): Promise<void> {
  searchStore.addingId.value = result.externalId
  searchStore.addErrorMessage.value = ''
  try {
    const song = await addSearchResultToLibrary(gprotabSource, result)
    openSong(song.id)
  } catch (err) {
    searchStore.addErrorMessage.value =
      err instanceof Error ? err.message : 'Could not add this tab. Try again.'
  } finally {
    searchStore.addingId.value = null
  }
}

export function SearchScreen() {
  const state = searchStore.state.value
  const results = searchStore.results.value

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

      {state === 'done' && results.length === 0 && (
        <div class="screen-placeholder">
          <p>No tabs found for that search.</p>
        </div>
      )}

      {state === 'done' && results.length > 0 && (
        <>
          <ul class="search-results">
            {results.map((result) => {
              const isAdding = searchStore.addingId.value === result.externalId
              return (
                <li key={result.externalId} class="card">
                  <div class="card__top">
                    <div class="card__text">
                      <div class="card__title">{result.title}</div>
                      <div class="card__sub">{result.artist}</div>
                    </div>
                    <button
                      type="button"
                      class="btn btn--small search-row__add"
                      disabled={isAdding}
                      onClick={() => void onAdd(result)}
                    >
                      {isAdding ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {searchStore.addErrorMessage.value && (
            <p class="search-add-error">{searchStore.addErrorMessage.value}</p>
          )}
          <p class="search-attribution">Results from gprotab.net</p>
        </>
      )}
    </div>
  )
}
