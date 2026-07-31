// Registry of available TabSource implementations. File import (SourceId
// 'file') has no TabSource entry - it is handled directly by
// import/importFile.ts and never goes through search/add-from-source.
//
// Search fans out to every source listed here; see search/searchStore.ts.

import type { TabSource, TabSourceId } from './types.ts'
import { gprotabSource } from './gprotabSource.ts'
import { guitarprotabsSource } from './guitarprotabsSource.ts'

export const tabSources: TabSource[] = [gprotabSource, guitarprotabsSource]

export function getTabSource(id: TabSourceId): TabSource | undefined {
  return tabSources.find((source) => source.id === id)
}
