/**
 * Shared album-index utilities. Single source of truth for slug generation and
 * the lookup index built from public/static-albums.json.
 */

export interface AlbumIndexEntry {
  title: string;
  artist?: string;
  coverArt?: string;
  feedId?: string;
  feedUrl?: string;
  index: number;
}

export interface AlbumIndexFile {
  version: string;
  totalAlbums: number;
  indexedAt: string;
  index: Record<string, AlbumIndexEntry>;
}

export function createSlug(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildAlbumIndex(albums: any[]): AlbumIndexFile {
  const index: Record<string, AlbumIndexEntry> = {};

  albums.forEach((album, idx) => {
    if (!album?.title) return;

    const title = album.title;
    const lowerTitle = title.toLowerCase();
    const slug = createSlug(title);
    const simpleSlug = lowerTitle.replace(/\s+/g, '-');
    const baseTitle = lowerTitle.split(/\s*[-–]\s*/)[0];
    const baseSlug = createSlug(baseTitle);

    const entry: AlbumIndexEntry = {
      title: album.title,
      artist: album.artist,
      coverArt: album.coverArt,
      feedId: album.feedId,
      feedUrl: album.feedUrl,
      index: idx,
    };

    index[lowerTitle] = entry;
    index[slug] = entry;
    index[simpleSlug] = entry;
    index[baseSlug] = entry;

    if (album.feedId) {
      index[album.feedId.toLowerCase()] = entry;
    }
  });

  return {
    version: '1.0',
    totalAlbums: albums.length,
    indexedAt: new Date().toISOString(),
    index,
  };
}
