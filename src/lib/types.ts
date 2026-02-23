export interface Track {
  id: number;
  persistentId: string | null;
  title: string;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  genre: string | null;
  composer: string | null;
  year: number | null;
  trackNumber: number | null;
  trackCount: number | null;
  discNumber: number | null;
  discCount: number | null;
  duration: number | null;
  size: number | null;
  bitRate: number | null;
  sampleRate: number | null;
  playCount: number | null;
  skipCount: number | null;
  rating: number | null;
  loved: boolean | null;
  dateAdded: string | null;
  lastPlayedAt: string | null;
  lastSkippedAt: string | null;
  comments: string | null;
  grouping: string | null;
  sortTitle: string | null;
  sortArtist: string | null;
  sortAlbum: string | null;
  sortAlbumArtist: string | null;
  sortComposer: string | null;
  filePath: string | null;
  artworkHash: string | null;
  hasArtwork: boolean;
}

export interface Playlist {
  id: number;
  persistentId: string;
  name: string;
  isSmart: boolean;
  trackCount: number;
}

export interface ImportProgress {
  phase: string;
  message: string;
  current: number;
  total: number;
}

export interface ImportStats {
  totalTracks: number;
  jxaTracks: number;
  scannedFiles: number;
  matched: number;
  unmatchedJxa: number;
  unmatchedFiles: number;
  playlists: number;
}

export interface TrackQuery {
  offset?: number;
  limit?: number;
  sortColumn?: string;
  sortDir?: string;
}
