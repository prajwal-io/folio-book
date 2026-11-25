import type {
  BookmarkItem,
  BookshelfEntry,
  CatalogBook,
  DailyActivityRecord,
  FolioBackupPayload,
  HighlightAnnotation,
  LastSessionActivity,
  ListeningProgress,
  OfflineSavedBook,
  ReaderChapter,
  ReaderPreferences,
  ReaderPresetId,
  ReadingGoalsConfig,
  ReadingHistoryEntry,
  ReadingProgress,
} from '../types/library';

const DB_NAME = 'folio-digital-library';
const DB_VERSION = 3;

const STORES = {
  BOOKSHELF: 'bookshelf',
  PROGRESS: 'progress',
  LISTENING_PROGRESS: 'listeningProgress',
  BOOKMARKS: 'bookmarks',
  HIGHLIGHTS: 'highlights',
  HISTORY: 'history',
  OFFLINE: 'offlineBooks',
  ACTIVITY_DAYS: 'activityDays',
  PREFERENCES: 'preferences',
} as const;

export type ReaderPresetConfig = Pick<
  ReaderPreferences,
  | 'readerTheme'
  | 'fontFamily'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'marginWidth'
  | 'textAlign'
  | 'layoutMode'
  | 'showProgress'
  | 'focusHideChrome'
>;

export const READER_PRESETS: Record<Exclude<ReaderPresetId, 'custom'>, ReaderPresetConfig> = {
  classic: {
    readerTheme: 'sepia',
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 1.75,
    letterSpacing: 0,
    marginWidth: 'balanced',
    textAlign: 'left',
    layoutMode: 'scroll',
    showProgress: true,
    focusHideChrome: false,
  },
  focus: {
    readerTheme: 'light',
    fontFamily: 'source-serif',
    fontSize: 18,
    lineHeight: 1.8,
    letterSpacing: 0.005,
    marginWidth: 'generous',
    textAlign: 'left',
    layoutMode: 'paginated',
    showProgress: false,
    focusHideChrome: true,
  },
  night: {
    readerTheme: 'dark',
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 1.78,
    letterSpacing: 0.005,
    marginWidth: 'balanced',
    textAlign: 'left',
    layoutMode: 'scroll',
    showProgress: true,
    focusHideChrome: false,
  },
  comfortable: {
    readerTheme: 'light',
    fontFamily: 'sans',
    fontSize: 21,
    lineHeight: 1.95,
    letterSpacing: 0.015,
    marginWidth: 'compact',
    textAlign: 'left',
    layoutMode: 'scroll',
    showProgress: true,
    focusHideChrome: false,
  },
};

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  appTheme: 'system',
  preset: 'classic',
  ...READER_PRESETS.classic,
  playbackRate: 1,
  preferredVoiceURI: null,
};

export const DEFAULT_GOALS: ReadingGoalsConfig = {
  goalType: 'time',
  dailyMinutesTarget: 20,
  dailyBooksTarget: 1,
  streakEnabled: true,
  preferredInterests: [],
  reminderEnabled: false,
  reminderTime: '20:30',
  reminderFrequency: 'daily',
  lastReminderDate: null,
};

export function applyReaderPreset(
  current: ReaderPreferences,
  presetId: Exclude<ReaderPresetId, 'custom'>,
): ReaderPreferences {
  return {
    ...current,
    ...READER_PRESETS[presetId],
    preset: presetId,
  };
}

export function getLocalDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.BOOKSHELF)) {
        db.createObjectStore(STORES.BOOKSHELF, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.PROGRESS)) {
        db.createObjectStore(STORES.PROGRESS, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.LISTENING_PROGRESS)) {
        db.createObjectStore(STORES.LISTENING_PROGRESS, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.BOOKMARKS)) {
        const bmStore = db.createObjectStore(STORES.BOOKMARKS, {keyPath: 'id'});
        bmStore.createIndex('byBookId', 'bookId', {unique: false});
      }
      if (!db.objectStoreNames.contains(STORES.HIGHLIGHTS)) {
        const hlStore = db.createObjectStore(STORES.HIGHLIGHTS, {keyPath: 'id'});
        hlStore.createIndex('byBookId', 'bookId', {unique: false});
      }
      if (!db.objectStoreNames.contains(STORES.HISTORY)) {
        db.createObjectStore(STORES.HISTORY, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.OFFLINE)) {
        db.createObjectStore(STORES.OFFLINE, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.ACTIVITY_DAYS)) {
        db.createObjectStore(STORES.ACTIVITY_DAYS, {keyPath: 'date'});
      }
      if (!db.objectStoreNames.contains(STORES.PREFERENCES)) {
        db.createObjectStore(STORES.PREFERENCES, {keyPath: 'key'});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openDb();
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result || []) as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function getOneFromStore<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function putIntoStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Storage write failed'));
  });
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Storage delete failed'));
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Storage clear failed'));
  });
}

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  payload?: FolioBackupPayload;
  summary?: {
    exportedAt: string;
    shelfCount: number;
    highlightsCount: number;
    notesCount: number;
    bookmarksCount: number;
    progressCount: number;
    listeningCount: number;
    historyCount: number;
    activityDaysCount: number;
    duplicateShelfCount: number;
    duplicateHighlightsCount: number;
    duplicateBookmarksCount: number;
  };
}

export const personalStorage = {
  async getPreferences(): Promise<ReaderPreferences> {
    const row = await getOneFromStore<{key: string; value: Partial<ReaderPreferences>}>(
      STORES.PREFERENCES,
      'reader-prefs',
    );
    if (row?.value) {
      return {...DEFAULT_PREFERENCES, ...row.value};
    }
    try {
      const raw = localStorage.getItem('folio-preferences');
      if (raw) return {...DEFAULT_PREFERENCES, ...JSON.parse(raw)};
    } catch {
      // ignore
    }
    return DEFAULT_PREFERENCES;
  },

  async savePreferences(prefs: ReaderPreferences): Promise<void> {
    try {
      localStorage.setItem('folio-preferences', JSON.stringify(prefs));
    } catch {
      // ignore
    }
    await putIntoStore(STORES.PREFERENCES, {key: 'reader-prefs', value: prefs});
  },

  async getGoals(): Promise<ReadingGoalsConfig> {
    const row = await getOneFromStore<{key: string; value: Partial<ReadingGoalsConfig>}>(
      STORES.PREFERENCES,
      'reading-goals',
    );
    if (row?.value) {
      return {...DEFAULT_GOALS, ...row.value};
    }
    try {
      const raw = localStorage.getItem('folio-reading-goals');
      if (raw) return {...DEFAULT_GOALS, ...JSON.parse(raw)};
    } catch {
      // ignore
    }
    return DEFAULT_GOALS;
  },

  async saveGoals(goals: ReadingGoalsConfig): Promise<void> {
    try {
      localStorage.setItem('folio-reading-goals', JSON.stringify(goals));
    } catch {
      // ignore
    }
    await putIntoStore(STORES.PREFERENCES, {key: 'reading-goals', value: goals});
  },

  async getLastSession(): Promise<LastSessionActivity | null> {
    const row = await getOneFromStore<{key: string; value: LastSessionActivity}>(
      STORES.PREFERENCES,
      'last-session',
    );
    if (row?.value) return row.value;
    try {
      const raw = localStorage.getItem('folio-last-session');
      if (raw) return JSON.parse(raw) as LastSessionActivity;
    } catch {
      // ignore
    }
    return null;
  },

  async saveLastSession(session: LastSessionActivity): Promise<void> {
    try {
      localStorage.setItem('folio-last-session', JSON.stringify(session));
    } catch {
      // ignore
    }
    await putIntoStore(STORES.PREFERENCES, {key: 'last-session', value: session});
  },

  async getBookshelf(): Promise<BookshelfEntry[]> {
    const rows = await getAllFromStore<BookshelfEntry>(STORES.BOOKSHELF);
    return rows.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  },

  async getShelfEntry(bookId: string): Promise<BookshelfEntry | null> {
    return getOneFromStore<BookshelfEntry>(STORES.BOOKSHELF, bookId);
  },

  async upsertShelfEntry(entry: BookshelfEntry): Promise<void> {
    await putIntoStore(STORES.BOOKSHELF, entry);
  },

  async removeShelfEntry(bookId: string): Promise<void> {
    await deleteFromStore(STORES.BOOKSHELF, bookId);
  },

  async getAllProgress(): Promise<ReadingProgress[]> {
    const rows = await getAllFromStore<ReadingProgress>(STORES.PROGRESS);
    return rows.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());
  },

  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    return getOneFromStore<ReadingProgress>(STORES.PROGRESS, bookId);
  },

  async saveProgress(progress: ReadingProgress): Promise<void> {
    await putIntoStore(STORES.PROGRESS, progress);
  },

  async getAllListeningProgress(): Promise<ListeningProgress[]> {
    const rows = await getAllFromStore<ListeningProgress>(STORES.LISTENING_PROGRESS);
    return rows.sort(
      (a, b) => new Date(b.lastListenedAt).getTime() - new Date(a.lastListenedAt).getTime(),
    );
  },

  async getListeningProgress(bookId: string): Promise<ListeningProgress | null> {
    return getOneFromStore<ListeningProgress>(STORES.LISTENING_PROGRESS, bookId);
  },

  async saveListeningProgress(progress: ListeningProgress): Promise<void> {
    await putIntoStore(STORES.LISTENING_PROGRESS, progress);
  },

  async getBookmarks(bookId?: string): Promise<BookmarkItem[]> {
    const rows = await getAllFromStore<BookmarkItem>(STORES.BOOKMARKS);
    const filtered = bookId ? rows.filter((b) => b.bookId === bookId) : rows;
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async addBookmark(bookmark: BookmarkItem): Promise<void> {
    await putIntoStore(STORES.BOOKMARKS, bookmark);
  },

  async deleteBookmark(id: string): Promise<void> {
    await deleteFromStore(STORES.BOOKMARKS, id);
  },

  async getHighlights(bookId?: string): Promise<HighlightAnnotation[]> {
    const rows = await getAllFromStore<HighlightAnnotation>(STORES.HIGHLIGHTS);
    const filtered = bookId ? rows.filter((h) => h.bookId === bookId) : rows;
    return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async saveHighlight(highlight: HighlightAnnotation): Promise<void> {
    await putIntoStore(STORES.HIGHLIGHTS, highlight);
  },

  async deleteHighlight(id: string): Promise<void> {
    await deleteFromStore(STORES.HIGHLIGHTS, id);
  },

  async getAllActivityDays(): Promise<DailyActivityRecord[]> {
    const rows = await getAllFromStore<DailyActivityRecord>(STORES.ACTIVITY_DAYS);
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  },

  async recordActiveSeconds(
    mode: 'read' | 'listen',
    seconds: number,
    isNewSession = false,
  ): Promise<DailyActivityRecord> {
    const dateKey = getLocalDateKey();
    const existing = await getOneFromStore<DailyActivityRecord>(STORES.ACTIVITY_DAYS, dateKey);
    const safeSecs = Math.max(0, Math.min(3600, Math.round(seconds)));
    const updated: DailyActivityRecord = existing
      ? {
          ...existing,
          readingSeconds: existing.readingSeconds + (mode === 'read' ? safeSecs : 0),
          listeningSeconds: existing.listeningSeconds + (mode === 'listen' ? safeSecs : 0),
          sessionsCount: existing.sessionsCount + (isNewSession ? 1 : 0),
        }
      : {
          date: dateKey,
          readingSeconds: mode === 'read' ? safeSecs : 0,
          listeningSeconds: mode === 'listen' ? safeSecs : 0,
          sessionsCount: 1,
          completedBookIds: [],
        };
    await putIntoStore(STORES.ACTIVITY_DAYS, updated);
    return updated;
  },

  async markBookCompletedActivity(bookId: string): Promise<DailyActivityRecord> {
    const dateKey = getLocalDateKey();
    const existing = await getOneFromStore<DailyActivityRecord>(STORES.ACTIVITY_DAYS, dateKey);
    const completedSet = new Set(existing?.completedBookIds || []);
    completedSet.add(bookId);
    const updated: DailyActivityRecord = existing
      ? {
          ...existing,
          completedBookIds: Array.from(completedSet),
        }
      : {
          date: dateKey,
          readingSeconds: 0,
          listeningSeconds: 0,
          sessionsCount: 1,
          completedBookIds: [bookId],
        };
    await putIntoStore(STORES.ACTIVITY_DAYS, updated);
    return updated;
  },

  async getHistory(): Promise<ReadingHistoryEntry[]> {
    const rows = await getAllFromStore<ReadingHistoryEntry>(STORES.HISTORY);
    return rows.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
  },

  async recordHistory(book: CatalogBook): Promise<void> {
    await putIntoStore<ReadingHistoryEntry>(STORES.HISTORY, {
      bookId: book.id,
      book,
      lastOpenedAt: new Date().toISOString(),
    });
  },

  async getOfflineBooks(): Promise<OfflineSavedBook[]> {
    const rows = await getAllFromStore<OfflineSavedBook>(STORES.OFFLINE);
    return rows.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  },

  async getOfflineBook(bookId: string): Promise<OfflineSavedBook | null> {
    return getOneFromStore<OfflineSavedBook>(STORES.OFFLINE, bookId);
  },

  async saveOfflineBook(
    book: CatalogBook,
    editionId: string,
    chapters: ReaderChapter[],
    totalWords: number,
  ): Promise<OfflineSavedBook> {
    const serialized = JSON.stringify(chapters);
    const byteSize = new Blob([serialized]).size;
    const record: OfflineSavedBook = {
      bookId: book.id,
      editionId,
      book,
      chapters,
      totalWords,
      savedAt: new Date().toISOString(),
      byteSize,
    };
    try {
      await putIntoStore(STORES.OFFLINE, record);
      return record;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new Error(
          'Browser storage limit reached. Remove one or more offline books under Shelf > Offline to free space.',
        );
      }
      throw err instanceof Error ? err : new Error('Unable to store offline book cleanly.');
    }
  },

  async removeOfflineBook(bookId: string): Promise<void> {
    await deleteFromStore(STORES.OFFLINE, bookId);
  },

  async clearAllOfflineBooks(): Promise<void> {
    await clearStore(STORES.OFFLINE);
  },

  async getStorageEstimate(): Promise<{usageBytes: number | null; quotaBytes: number | null}> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        return {
          usageBytes: typeof est.usage === 'number' ? est.usage : null,
          quotaBytes: typeof est.quota === 'number' ? est.quota : null,
        };
      } catch {
        // ignore
      }
    }
    return {usageBytes: null, quotaBytes: null};
  },

  async exportPersonalBackup(): Promise<FolioBackupPayload> {
    const [
      bookshelf,
      readingProgress,
      listeningProgress,
      lastSession,
      bookmarks,
      highlights,
      history,
      preferences,
      readingGoals,
      activityDays,
    ] = await Promise.all([
      this.getBookshelf(),
      this.getAllProgress(),
      this.getAllListeningProgress(),
      this.getLastSession(),
      this.getBookmarks(),
      this.getHighlights(),
      this.getHistory(),
      this.getPreferences(),
      this.getGoals(),
      this.getAllActivityDays(),
    ]);

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: 'Folio',
      // Deliberately omits offlineBooks chapter bodies so copyrighted/external text is never exported
      data: {
        bookshelf,
        readingProgress,
        listeningProgress,
        lastSession,
        bookmarks,
        highlights,
        history,
        preferences,
        readingGoals,
        activityDays,
      },
    };
  },

  async validateBackupPayload(raw: unknown): Promise<BackupValidationResult> {
    if (!raw || typeof raw !== 'object') {
      return {valid: false, error: 'Backup file is not a valid JSON object.'};
    }
    const candidate = raw as Partial<FolioBackupPayload>;
    if (candidate.schemaVersion !== 1 || candidate.appName !== 'Folio' || !candidate.data) {
      return {
        valid: false,
        error: 'Unrecognized backup format. Expected a Folio v1 personal backup JSON file.',
      };
    }
    const d = candidate.data;
    if (
      !Array.isArray(d.bookshelf) ||
      !Array.isArray(d.readingProgress) ||
      !Array.isArray(d.bookmarks) ||
      !Array.isArray(d.highlights) ||
      !Array.isArray(d.history)
    ) {
      return {
        valid: false,
        error: 'Backup file is missing required bookshelf, highlight, or progress arrays.',
      };
    }

    const [curShelf, curHighlights, curBookmarks] = await Promise.all([
      this.getBookshelf(),
      this.getHighlights(),
      this.getBookmarks(),
    ]);
    const shelfIds = new Set(curShelf.map((s) => s.bookId));
    const hlIds = new Set(curHighlights.map((h) => h.id));
    const bmIds = new Set(curBookmarks.map((b) => b.id));

    return {
      valid: true,
      payload: candidate as FolioBackupPayload,
      summary: {
        exportedAt: candidate.exportedAt || new Date().toISOString(),
        shelfCount: d.bookshelf.length,
        highlightsCount: d.highlights.length,
        notesCount: d.highlights.filter((h) => Boolean(h.note?.trim())).length,
        bookmarksCount: d.bookmarks.length,
        progressCount: d.readingProgress.length,
        listeningCount: Array.isArray(d.listeningProgress) ? d.listeningProgress.length : 0,
        historyCount: d.history.length,
        activityDaysCount: Array.isArray(d.activityDays) ? d.activityDays.length : 0,
        duplicateShelfCount: d.bookshelf.filter((s) => shelfIds.has(s.bookId)).length,
        duplicateHighlightsCount: d.highlights.filter((h) => hlIds.has(h.id)).length,
        duplicateBookmarksCount: d.bookmarks.filter((b) => bmIds.has(b.id)).length,
      },
    };
  },

  async importPersonalBackup(
    payload: FolioBackupPayload,
    strategy: 'merge' | 'replace',
  ): Promise<void> {
    const d = payload.data;

    if (strategy === 'replace') {
      await Promise.all([
        clearStore(STORES.BOOKSHELF),
        clearStore(STORES.PROGRESS),
        clearStore(STORES.LISTENING_PROGRESS),
        clearStore(STORES.BOOKMARKS),
        clearStore(STORES.HIGHLIGHTS),
        clearStore(STORES.HISTORY),
        clearStore(STORES.ACTIVITY_DAYS),
      ]);

      for (const s of d.bookshelf) await putIntoStore(STORES.BOOKSHELF, s);
      for (const p of d.readingProgress) await putIntoStore(STORES.PROGRESS, p);
      for (const l of d.listeningProgress || []) await putIntoStore(STORES.LISTENING_PROGRESS, l);
      for (const bm of d.bookmarks) await putIntoStore(STORES.BOOKMARKS, bm);
      for (const hl of d.highlights) await putIntoStore(STORES.HIGHLIGHTS, hl);
      for (const h of d.history) await putIntoStore(STORES.HISTORY, h);
      for (const act of d.activityDays || []) await putIntoStore(STORES.ACTIVITY_DAYS, act);

      if (d.preferences) await this.savePreferences({...DEFAULT_PREFERENCES, ...d.preferences});
      if (d.readingGoals) await this.saveGoals({...DEFAULT_GOALS, ...d.readingGoals});
      if (d.lastSession) await this.saveLastSession(d.lastSession);
      return;
    }

    // Merge keeping newer records per entity
    const [curShelf, curProg, curListen, curBms, curHls, curHist, curDays] = await Promise.all([
      this.getBookshelf(),
      this.getAllProgress(),
      this.getAllListeningProgress(),
      this.getBookmarks(),
      this.getHighlights(),
      this.getHistory(),
      this.getAllActivityDays(),
    ]);

    const shelfMap = new Map(curShelf.map((s) => [s.bookId, s]));
    for (const inc of d.bookshelf) {
      const prev = shelfMap.get(inc.bookId);
      if (!prev || new Date(inc.addedAt).getTime() >= new Date(prev.addedAt).getTime()) {
        await putIntoStore(STORES.BOOKSHELF, {
          ...inc,
          isFavourite: Boolean(inc.isFavourite || prev?.isFavourite),
        });
      }
    }

    const progMap = new Map(curProg.map((p) => [p.bookId, p]));
    for (const inc of d.readingProgress) {
      const prev = progMap.get(inc.bookId);
      if (!prev || new Date(inc.lastReadAt).getTime() > new Date(prev.lastReadAt).getTime()) {
        await putIntoStore(STORES.PROGRESS, inc);
      }
    }

    const listenMap = new Map(curListen.map((l) => [l.bookId, l]));
    for (const inc of d.listeningProgress || []) {
      const prev = listenMap.get(inc.bookId);
      if (!prev || new Date(inc.lastListenedAt).getTime() > new Date(prev.lastListenedAt).getTime()) {
        await putIntoStore(STORES.LISTENING_PROGRESS, inc);
      }
    }

    const bmIds = new Set(curBms.map((b) => b.id));
    for (const inc of d.bookmarks) {
      if (!bmIds.has(inc.id)) await putIntoStore(STORES.BOOKMARKS, inc);
    }

    const hlMap = new Map(curHls.map((h) => [h.id, h]));
    for (const inc of d.highlights) {
      const prev = hlMap.get(inc.id);
      if (!prev || new Date(inc.updatedAt).getTime() > new Date(prev.updatedAt).getTime()) {
        await putIntoStore(STORES.HIGHLIGHTS, inc);
      }
    }

    const histMap = new Map(curHist.map((h) => [h.bookId, h]));
    for (const inc of d.history) {
      const prev = histMap.get(inc.bookId);
      if (!prev || new Date(inc.lastOpenedAt).getTime() > new Date(prev.lastOpenedAt).getTime()) {
        await putIntoStore(STORES.HISTORY, inc);
      }
    }

    const dayMap = new Map(curDays.map((day) => [day.date, day]));
    for (const inc of d.activityDays || []) {
      const prev = dayMap.get(inc.date);
      if (!prev) {
        await putIntoStore(STORES.ACTIVITY_DAYS, inc);
      } else {
        const mergedIds = Array.from(new Set([...prev.completedBookIds, ...inc.completedBookIds]));
        await putIntoStore(STORES.ACTIVITY_DAYS, {
          date: inc.date,
          readingSeconds: Math.max(prev.readingSeconds, inc.readingSeconds),
          listeningSeconds: Math.max(prev.listeningSeconds, inc.listeningSeconds),
          sessionsCount: Math.max(prev.sessionsCount, inc.sessionsCount),
          completedBookIds: mergedIds,
        });
      }
    }
  },
};
