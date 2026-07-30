// Core data model. Authoritative reference: docs/01-data-model.md.
// Changes here must be reflected there and vice versa.

export type TabFormat = 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'gp' | 'musicxml'
export type SourceId = 'songsterr' | 'gprotab' | 'gtptabs' | 'file' | 'musescore'
export type PlayMode = 'synth' | 'real-backing' | 'real-full' | 'guitar-only'

export interface Song {
  id: string
  title: string
  artist: string
  album?: string
  source: { sourceId: SourceId; externalId?: string; url?: string }
  tabBlobHash: string
  tabFormat: TabFormat
  correctedTabBlobHash?: string
  correctionsBaseHash?: string
  defaultTrackIndex: number
  targetTempoBpm: number
  audioBundleId?: string
  favourite: boolean
  tags: string[]
  addedAt: number
  lastPlayedAt?: number
}

export interface SyncAnchor {
  masterBarIndex: number
  barOccurence: number // alphaTab spelling
  ratioPosition: number // 0 = bar start; v1 uses bar-start anchors only
  audioMs: number
  source: 'auto' | 'user'
}

export interface SyncMap {
  version: 1
  points: SyncAnchor[]
  beatGrid?: { timesMs: number[]; downbeatIdx: number[] }
  confidence: number
  status: 'auto' | 'user-verified' | 'needs-review'
}

export interface AudioBundle {
  id: string
  songId: string
  /**
   * Everything but the guitar once separation has run; the full mix before it.
   * Always present - a bundle without audio is not a bundle.
   */
  backingBlobHash: string
  /**
   * The isolated guitar. Absent until stem separation has run: a full-mix bundle
   * is playable and useful on its own, so this is optional rather than the data
   * model's original required field.
   */
  guitarBlobHash?: string
  durationMs: number
  encodeBitrateKbps: number
  sourceAudioFingerprint: string
  /** Absent when the audio is the untouched mix. */
  demucsModel?: 'htdemucs_6s'
  syncMap: SyncMap
  createdAt: number
}

export interface Passage {
  id: string
  songId: string
  trackIndex: number
  startBar: number
  endBar: number
  label?: string
  origin: 'user' | 'suggested'
  status: 'candidate' | 'active' | 'retired'
  createdAt: number
}

export type PracticePhase = 'acquisition' | 'consolidation' | 'maintenance'
export type ReviewGrade = 'fail' | 'hard' | 'good' | 'easy'

export interface PassageReviewState {
  passageId: string
  phase: PracticePhase
  /** Highest tempo (percent) at which a clean block has been played. */
  masteredTempoPct: number
  /** Tempo the next review block runs at. */
  reviewTempoPct: number
  ease: number
  intervalDays: number
  dueAt: number
  reps: number
  lapses: number
  /** Consecutive 'easy' grades; two in maintenance unlock overspeed review. */
  consecutiveEasy: number
  /** Consecutive lapses; two drops the passage back to acquisition. */
  consecutiveLapses: number
  lastReviewedAt?: number
  rebuiltFromEventId: string
}

interface EventBase {
  id: string
  ts: number
}
export type PracticeEvent =
  | (EventBase & { type: 'session_start' | 'session_end' })
  | (EventBase & {
      type: 'playthrough'
      songId: string
      trackIndex: number
      tempoPct: number
      mode: PlayMode
      durationMs: number
    })
  | (EventBase & {
      type: 'loop_block'
      songId: string
      passageId?: string
      startBar: number
      endBar: number
      tempoPct: number
      reps: number
      cleanReps: number
      durationMs: number
    })
  | (EventBase & {
      type: 'review_result'
      passageId: string
      tempoPct: number
      grade: ReviewGrade
    })
  | (EventBase & { type: 'passage_marked' | 'passage_retired'; passageId: string })

export interface Setlist {
  id: string
  name: string
  songIds: string[]
  kind: 'setlist' | 'practice-group'
  createdAt: number
}

export type BlobKind = 'tab' | 'audio' | 'soundfont'

export interface BlobRecord {
  hash: string
  bytes: Blob
  size: number
  kind: BlobKind
  refAddedAt: number
}

export type AssetStateValue = 'absent' | 'queued' | 'downloading' | 'cached' | 'evicted'

export interface AssetState {
  key: string // `${kind}:${hash}`
  state: AssetStateValue
  lastVerifiedAt?: number
  failCount: number
}
