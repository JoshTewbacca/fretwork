// TabSource for gprotab.net. Shape and transport live in archiveSource.ts;
// the scraping lives in the Edge functions under app/api/tabs/.

import type { TabSource } from './types.ts'
import { createArchiveSource } from './archiveSource.ts'

export const gprotabSource: TabSource = createArchiveSource('gprotab', 'GProTab')
