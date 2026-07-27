// Module-level setlist store: mirrors the shape of library/libraryStore.ts —
// a signal holding the loaded list, plus imperative actions that persist via
// the setlists repository and then refresh().

import { signal } from '@preact/signals'
import type { Setlist } from '../core/types.ts'
import { getDb } from '../db/open.ts'
import { listSetlists, putSetlist, deleteSetlist as deleteSetlistRow } from '../db/setlists.ts'
import { ulid } from '../db/ulid.ts'

/** All setlists, newest first. Populated by refresh(). */
export const setlists = signal<Setlist[]>([])

function byCreatedAtDesc(a: Setlist, b: Setlist): number {
  return b.createdAt - a.createdAt
}

export async function refresh(): Promise<void> {
  const db = await getDb()
  const all = await listSetlists(db)
  setlists.value = [...all].sort(byCreatedAtDesc)
}

export async function createSetlist(
  name: string,
  kind: Setlist['kind'],
): Promise<string> {
  const db = await getDb()
  const setlist: Setlist = {
    id: ulid(),
    name,
    songIds: [],
    kind,
    createdAt: Date.now(),
  }
  await putSetlist(db, setlist)
  await refresh()
  return setlist.id
}

export async function renameSetlist(id: string, name: string): Promise<void> {
  const db = await getDb()
  const existing = setlists.value.find((s) => s.id === id)
  if (!existing) return
  await putSetlist(db, { ...existing, name })
  await refresh()
}

export async function deleteSetlist(id: string): Promise<void> {
  const db = await getDb()
  await deleteSetlistRow(db, id)
  await refresh()
}

export async function addSongToSetlist(setlistId: string, songId: string): Promise<void> {
  const db = await getDb()
  const existing = setlists.value.find((s) => s.id === setlistId)
  if (!existing) return
  if (existing.songIds.includes(songId)) return
  await putSetlist(db, { ...existing, songIds: [...existing.songIds, songId] })
  await refresh()
}

export async function removeSongFromSetlist(setlistId: string, songId: string): Promise<void> {
  const db = await getDb()
  const existing = setlists.value.find((s) => s.id === setlistId)
  if (!existing) return
  await putSetlist(db, {
    ...existing,
    songIds: existing.songIds.filter((id) => id !== songId),
  })
  await refresh()
}

/** Replaces the setlist's song order wholesale with the given song id order. */
export async function reorderSetlist(setlistId: string, songIds: string[]): Promise<void> {
  const db = await getDb()
  const existing = setlists.value.find((s) => s.id === setlistId)
  if (!existing) return
  await putSetlist(db, { ...existing, songIds })
  await refresh()
}
