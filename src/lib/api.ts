import type {
  AudiobookEdition,
  AudiobookTrack,
  BookKind,
  CatalogBook,
  CatalogQueryResponse,
  DictionaryEntry,
  GenreDefinition,
  HomeCollectionsResponse,
  PublicationPeriodFilter,
  ReaderContentResponse,
  SyncStatus,
} from '../types/library';
import {personalStorage} from './storage';

export interface GenreWithCount extends GenreDefinition {
  count: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as {error?: string};
      if (body.error) errMsg = body.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return (await res.json()) as T;
}

export const libraryApi = {
  getHome(): Promise<HomeCollectionsResponse> {
    return fetchJson<HomeCollectionsResponse>('/api/catalog/home');
  },

  getDiscoveryPool(): Promise<{items: CatalogBook[]; syncStatus: SyncStatus}> {
    return fetchJson<{items: CatalogBook[]; syncStatus: SyncStatus}>('/api/catalog/discover');
  },

  async lookupWord(word: string): Promise<DictionaryEntry> {
    const clean = word.trim();
    if (!clean) throw new Error('Select a word to define.');
    const res = await fetchJson<{entry: DictionaryEntry}>(
      `/api/dictionary?word=${encodeURIComponent(clean)}`,
    );
    return res.entry;
  },

  getGenres(): Promise<{genres: GenreWithCount[]; syncStatus: SyncStatus}> {
    return fetchJson<{genres: GenreWithCount[]; syncStatus: SyncStatus}>('/api/catalog/genres');
  },

  queryBooks(params: {
    kind?: BookKind | 'all';
    genre?: string;
    q?: string;
    period?: PublicationPeriodFilter;
    sort?: 'popular' | 'newest' | 'year-desc' | 'title';
    page?: number;
    limit?: number;
  }): Promise<CatalogQueryResponse> {
    const qs = new URLSearchParams();
    if (params.kind && params.kind !== 'all') qs.set('kind', params.kind);
    if (params.genre) qs.set('genre', params.genre);
    if (params.q) qs.set('q', params.q);
    if (params.period && params.period !== 'all') qs.set('period', params.period);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return fetchJson<CatalogQueryResponse>(`/api/catalog/books?${qs.toString()}`);
  },

  getBook(id: string): Promise<{book: CatalogBook}> {
    return fetchJson<{book: CatalogBook}>(`/api/catalog/book/${encodeURIComponent(id)}`);
  },

  getSyncStatus(): Promise<SyncStatus> {
    return fetchJson<SyncStatus>('/api/catalog/sync-status');
  },

  triggerSync(): Promise<{started: boolean; message: string; syncStatus: SyncStatus}> {
    return fetchJson<{started: boolean; message: string; syncStatus: SyncStatus}>(
      '/api/catalog/sync',
      {method: 'POST'},
    );
  },

  getAudiobookTracks(params: {
    bookId?: string;
    audiobookId?: string;
  }): Promise<{audiobook: AudiobookEdition | null; tracks: AudiobookTrack[]}> {
    const qs = new URLSearchParams();
    if (params.bookId) qs.set('bookId', params.bookId);
    if (params.audiobookId) qs.set('audiobookId', params.audiobookId);
    return fetchJson<{audiobook: AudiobookEdition | null; tracks: AudiobookTrack[]}>(
      `/api/audiobook/tracks?${qs.toString()}`,
    );
  },

  async getReaderContent(book: CatalogBook, editionId?: string): Promise<ReaderContentResponse> {
    // Prefer offline IndexedDB copy when available for instant zero-latency reading
    const offline = await personalStorage.getOfflineBook(book.id);
    if (offline && (!editionId || offline.editionId === editionId)) {
      const edition = book.editions.find((e) => e.editionId === offline.editionId) || book.editions[0];
      return {
        bookId: book.id,
        editionId: offline.editionId,
        title: book.title,
        author: book.primaryAuthor,
        provider: edition?.provider || 'gutendex',
        providerLabel: `${edition?.providerLabel || 'Offline'} · Saved Copy`,
        sourceUrl: edition?.sourceUrl || '',
        externalReadUrl: edition?.externalReadUrl || '',
        readableInApp: offline.chapters.length > 0,
        chapters: offline.chapters,
        totalWords: offline.totalWords,
      };
    }

    const qs = new URLSearchParams({bookId: book.id});
    if (editionId) qs.set('editionId', editionId);
    return fetchJson<ReaderContentResponse>(`/api/reader/content?${qs.toString()}`);
  },
};
