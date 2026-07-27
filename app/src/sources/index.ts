// Registry of available TabSource implementations. File import (SourceId
// 'file') has no TabSource entry - it is handled directly by
// import/importFile.ts and never goes through search/add-from-source.

import type { TabSource, TabSourceId } from './types.ts'
import { gprotabSource } from './gprotabSource.ts'

export const tabSources: TabSource[] = [gprotabSource]

export function getTabSource(id: TabSourceId): TabSource | undefined {
  return tabSources.find((source) => source.id === id)
}
