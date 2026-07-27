import type { IDBPDatabase } from 'idb'
import type { Song } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getSong(db: Db, id: string): Promise<Song | undefined> {
  return db.get('songs', id)
}

export async function putSong(db: Db, song: Song): Promise<string> {
  return db.put('songs', song)
}

export async function deleteSong(db: Db, id: string): Promise<void> {
  return db.delete('songs', id)
}

export async function listSongs(db: Db): Promise<Song[]> {
  return db.getAll('songs')
}

export async function listSongsByArtist(db: Db, artist: string): Promise<Song[]> {
  return db.getAllFromIndex('songs', 'by-artist', artist)
}
