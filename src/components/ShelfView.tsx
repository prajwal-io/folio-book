import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  BarChart2,
  Bell,
  BookOpen,
  Bookmark,
  CalendarPlus,
  Check,
  Download,
  Heart,
  Highlighter,
  History,
  MessageSquarePlus,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Search,
  Sun,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  BookmarkItem,
  BookshelfEntry,
  CatalogBook,
  DailyActivityRecord,
  FolioBackupPayload,
  HighlightAnnotation,
  HighlightColor,
  ListeningProgress,
  OfflineDownloadProgress,
  OfflineSavedBook,
  ReaderFontFamily,
  ReaderPreferences,
  ReaderPresetId,
  ReadingGoalsConfig,
  ReadingHistoryEntry,
  ReadingProgress,
  SyncStatus,
} from '../types/library';
import type {GenreWithCount} from '../lib/api';
import {useAudioPlayer} from '../lib/audioContext';
import {HIGHLIGHT_SWATCHES} from '../lib/highlightsDom';
import {
  buildReminderIcsContent,
  getNotificationPermissionState,
  requestReminderPermission,
} from '../lib/reminders';
import {
  applyReaderPreset,
  DEFAULT_PREFERENCES,
  getLocalDateKey,
  personalStorage,
  type BackupValidationResult,
} from '../lib/storage';
import {BookCard} from './BookCard';
import {PWAInstallButton} from './PWAInstallButton';

export type ShelfSubTab =
  | 'shelf'
  | 'notebook'
  | 'insights'
  | 'offline'
  | 'favourites'
  | 'history'
  | 'settings';

interface ShelfViewProps {
  initialSubTab?: ShelfSubTab;
  shelf: BookshelfEntry[];
  offlineBooks: OfflineSavedBook[];
  downloadProgressMap: Record<string, OfflineDownloadProgress>;
  history: ReadingHistoryEntry[];
  bookmarks: BookmarkItem[];
  highlights: HighlightAnnotation[];
  genres: GenreWithCount[];
  progressByBookId: Record<string, ReadingProgress>;
  listeningByBookId: Record<string, ListeningProgress>;
  preferences: ReaderPreferences;
  goals: ReadingGoalsConfig;
  activityDays: DailyActivityRecord[];
  syncStatus: SyncStatus | null;
  isSyncing: boolean;
  onSelectBook: (book: CatalogBook) => void;
  onOpenBookmark: (book: CatalogBook, bookmark: BookmarkItem) => void;
  onOpenHighlight: (book: CatalogBook, highlight: HighlightAnnotation) => void;
  onDeleteBookmark: (id: string) => void;
  onSaveHighlight: (hl: HighlightAnnotation) => void;
  onDeleteHighlight: (id: string) => void;
  onRemoveOffline: (bookId: string) => Promise<void>;
  onClearAllOffline: () => Promise<void>;
  onUpdatePreferences: (next: ReaderPreferences) => void;
  onUpdateGoals: (next: ReadingGoalsConfig) => void;
  onRestoreBackup: (payload: FolioBackupPayload, strategy: 'merge' | 'replace') => Promise<void>;
  onTriggerSync: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationHuman(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export const ShelfView: React.FC<ShelfViewProps> = ({
  initialSubTab = 'shelf',
  shelf,
  offlineBooks,
  downloadProgressMap,
  history,
  bookmarks,
  highlights,
  genres,
  progressByBookId,
  listeningByBookId,
  preferences,
  goals,
  activityDays,
  syncStatus,
  isSyncing,
  onSelectBook,
  onOpenBookmark,
  onOpenHighlight,
  onDeleteBookmark,
  onSaveHighlight,
  onDeleteHighlight,
  onRemoveOffline,
  onClearAllOffline,
  onUpdatePreferences,
  onUpdateGoals,
  onRestoreBackup,
  onTriggerSync,
}) => {
  const [subTab, setSubTab] = useState<ShelfSubTab>(initialSubTab);
  const [shelfStatusFilter, setShelfStatusFilter] = useState<'all' | 'reading' | 'saved' | 'finished'>('all');

  // Notebook state
  const [notebookQuery, setNotebookQuery] = useState('');
  const [notebookColorFilter, setNotebookColorFilter] = useState<HighlightColor | 'all'>('all');
  const [editingNote, setEditingNote] = useState<{id: string; text: string; color: HighlightColor} | null>(
    null,
  );

  // Storage estimate state
  const [storageEstimate, setStorageEstimate] = useState<{
    usageBytes: number | null;
    quotaBytes: number | null;
  }>({usageBytes: null, quotaBytes: null});

  // Reminder & Backup UI states
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermissionState(),
  );
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupValidationResult | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {voices, ttsVoicesAvailable} = useAudioPlayer();

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (subTab === 'offline') {
      void personalStorage.getStorageEstimate().then(setStorageEstimate);
    }
  }, [subTab, offlineBooks.length]);

  const favourites = shelf.filter((e) => e.isFavourite);
  const offlineIds = new Set(offlineBooks.map((o) => o.bookId));
  const totalOfflineBytes = offlineBooks.reduce((sum, o) => sum + o.byteSize, 0);

  const bookLookup = useMemo(() => {
    const map = new Map<string, CatalogBook>();
    for (const s of shelf) map.set(s.bookId, s.book);
    for (const o of offlineBooks) map.set(o.bookId, o.book);
    for (const h of history) map.set(h.bookId, h.book);
    for (const p of Object.values(progressByBookId)) map.set(p.bookId, p.book);
    for (const l of Object.values(listeningByBookId)) map.set(l.bookId, l.book);
    return map;
  }, [history, listeningByBookId, offlineBooks, progressByBookId, shelf]);

  const getCombinedProgress = (bookId: string) =>
    Math.max(
      progressByBookId[bookId]?.percentComplete ?? 0,
      listeningByBookId[bookId]?.percentComplete ?? 0,
    ) || undefined;

  const updateCustomReadingPref = (patch: Partial<ReaderPreferences>) => {
    onUpdatePreferences({...preferences, ...patch, preset: 'custom'});
  };

  // Filtered shelf entries
  const filteredShelf = useMemo(() => {
    if (shelfStatusFilter === 'all') return shelf;
    return shelf.filter((e) => e.shelfStatus === shelfStatusFilter);
  }, [shelf, shelfStatusFilter]);

  // Organized notebook entries (highlights + bookmarks grouped by book)
  const notebookGroups = useMemo(() => {
    const q = notebookQuery.trim().toLowerCase();
    const matchedHighlights = highlights.filter((h) => {
      if (notebookColorFilter !== 'all' && h.color !== notebookColorFilter) return false;
      if (!q) return true;
      const b = bookLookup.get(h.bookId);
      return (
        h.quote.toLowerCase().includes(q) ||
        (h.note || '').toLowerCase().includes(q) ||
        h.chapterTitle.toLowerCase().includes(q) ||
        (b?.title || '').toLowerCase().includes(q) ||
        (b?.primaryAuthor || '').toLowerCase().includes(q)
      );
    });

    const matchedBookmarks =
      notebookColorFilter === 'all'
        ? bookmarks.filter((bm) => {
            if (!q) return true;
            const b = bookLookup.get(bm.bookId);
            return (
              bm.excerpt.toLowerCase().includes(q) ||
              bm.chapterTitle.toLowerCase().includes(q) ||
              (b?.title || '').toLowerCase().includes(q) ||
              (b?.primaryAuthor || '').toLowerCase().includes(q)
            );
          })
        : [];

    const byBook = new Map<
      string,
      {
        bookId: string;
        book: CatalogBook | undefined;
        highlights: HighlightAnnotation[];
        bookmarks: BookmarkItem[];
        latestAt: number;
      }
    >();

    const ensureGroup = (bookId: string) => {
      let g = byBook.get(bookId);
      if (!g) {
        g = {
          bookId,
          book: bookLookup.get(bookId),
          highlights: [],
          bookmarks: [],
          latestAt: 0,
        };
        byBook.set(bookId, g);
      }
      return g;
    };

    for (const h of matchedHighlights) {
      const g = ensureGroup(h.bookId);
      g.highlights.push(h);
      g.latestAt = Math.max(g.latestAt, new Date(h.updatedAt).getTime());
    }
    for (const bm of matchedBookmarks) {
      const g = ensureGroup(bm.bookId);
      g.bookmarks.push(bm);
      g.latestAt = Math.max(g.latestAt, new Date(bm.createdAt).getTime());
    }

    return Array.from(byBook.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [bookLookup, bookmarks, highlights, notebookColorFilter, notebookQuery]);

  // Insights metrics derived authentically from stored user activity
  const insights = useMemo(() => {
    const completedIds = new Set<string>();
    for (const s of shelf) {
      if (s.shelfStatus === 'finished') completedIds.add(s.bookId);
    }
    for (const p of Object.values(progressByBookId)) {
      if (p.percentComplete >= 95) completedIds.add(p.bookId);
    }
    for (const l of Object.values(listeningByBookId)) {
      if (l.percentComplete >= 95) completedIds.add(l.bookId);
    }

    const activeIds = new Set<string>();
    for (const p of Object.values(progressByBookId)) {
      if (!completedIds.has(p.bookId) && p.percentComplete > 0) activeIds.add(p.bookId);
    }
    for (const l of Object.values(listeningByBookId)) {
      if (!completedIds.has(l.bookId) && l.percentComplete > 0) activeIds.add(l.bookId);
    }

    const totalReadingSeconds = activityDays.reduce((s, d) => s + d.readingSeconds, 0);
    const totalListeningSeconds = activityDays.reduce((s, d) => s + d.listeningSeconds, 0);
    const totalSessions = activityDays.reduce((s, d) => s + d.sessionsCount, 0);

    // Last 7 days bar data (oldest -> today)
    const dayMap = new Map(activityDays.map((d) => [d.date, d]));
    const last7Days: Array<{date: string; label: string; minutes: number; books: number}> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = getLocalDateKey(d);
      const rec = dayMap.get(key);
      last7Days.push({
        date: key,
        label: d.toLocaleDateString(undefined, {weekday: 'short'}),
        minutes: rec ? Math.round((rec.readingSeconds + rec.listeningSeconds) / 60) : 0,
        books: rec ? rec.completedBookIds.length : 0,
      });
    }

    // Most-read genres from books touched
    const genreCounts = new Map<string, number>();
    const touchedIds = new Set<string>([
      ...Object.keys(progressByBookId),
      ...Object.keys(listeningByBookId),
      ...shelf.map((s) => s.bookId),
    ]);
    for (const id of touchedIds) {
      const b = bookLookup.get(id);
      if (!b) continue;
      for (const g of b.genres) {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    }
    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const todayKey = getLocalDateKey();
    const todayRec = dayMap.get(todayKey);
    const todayMinutes = todayRec
      ? Math.floor((todayRec.readingSeconds + todayRec.listeningSeconds) / 60)
      : 0;
    const todayBooks = todayRec?.completedBookIds.length || 0;

    return {
      completedCount: completedIds.size,
      activeCount: activeIds.size,
      totalReadingSeconds,
      totalListeningSeconds,
      totalSessions,
      last7Days,
      topGenres,
      todayMinutes,
      todayBooks,
    };
  }, [activityDays, bookLookup, listeningByBookId, progressByBookId, shelf]);

  const handleExportBackup = async () => {
    setBackupError(null);
    setBackupMessage(null);
    try {
      const payload = await personalStorage.exportPersonalBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `folio-backup-${getLocalDateKey()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupMessage(
        `Exported ${payload.data.bookshelf.length} shelved books, ${payload.data.highlights.length} highlights/notes, and ${payload.data.bookmarks.length} bookmarks.`,
      );
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Unable to export backup');
    }
  };

  const handlePickBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackupError(null);
    setBackupMessage(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result = await personalStorage.validateBackupPayload(parsed);
      if (!result.valid || !result.payload) {
        setBackupError(result.error || 'Invalid backup file.');
        return;
      }
      setPendingRestore(result);
    } catch {
      setBackupError('Could not read JSON file. Please select a valid Folio backup JSON file.');
    }
  };

  const handleConfirmRestore = async (strategy: 'merge' | 'replace') => {
    if (!pendingRestore?.payload) return;
    setRestoreBusy(true);
    setBackupError(null);
    try {
      await onRestoreBackup(pendingRestore.payload, strategy);
      setBackupMessage(
        strategy === 'merge'
          ? 'Backup merged cleanly with your existing Folio data (kept newer versions).'
          : 'Personal library data restored from backup.',
      );
      setPendingRestore(null);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleDownloadIcs = () => {
    const ics = buildReminderIcsContent(goals);
    const blob = new Blob([ics], {type: 'text/calendar;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'folio-reading-reminder.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const maxBarMinutes = Math.max(15, goals.dailyMinutesTarget, ...insights.last7Days.map((d) => d.minutes));
  const activeDownloadsList = Object.values(downloadProgressMap);

  return (
    <div className="space-y-6">
      <header className="space-y-4 border-b border-stone-200 dark:border-stone-800 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
              Personal Bookshelf & Companion
            </h1>
            <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] mt-0.5">
              Saved privately on this device · {shelf.length} shelved · {highlights.length} highlights ·{' '}
              {offlineBooks.length} offline
            </p>
          </div>
          <PWAInstallButton variant="compact" />
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {(
            [
              {id: 'shelf', label: `Shelf (${shelf.length})`},
              {id: 'notebook', label: `Notebook (${highlights.length + bookmarks.length})`},
              {id: 'insights', label: 'Goals & Insights'},
              {id: 'offline', label: `Offline (${offlineBooks.length})`},
              {id: 'favourites', label: `Favourites (${favourites.length})`},
              {id: 'history', label: 'History'},
              {id: 'settings', label: 'Settings & Backup'},
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                subTab === t.id
                  ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                  : 'bg-white/70 dark:bg-[#1D1A17] border-stone-200 dark:border-stone-800 text-[#44403C] dark:text-[#D6D0C6]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* TAB 1: BOOKSHELF */}
      {subTab === 'shelf' && (
        <div className="space-y-4">
          {shelf.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  {id: 'all', label: `All (${shelf.length})`},
                  {
                    id: 'reading',
                    label: `Reading (${shelf.filter((s) => s.shelfStatus === 'reading').length})`,
                  },
                  {
                    id: 'saved',
                    label: `Saved (${shelf.filter((s) => s.shelfStatus === 'saved').length})`,
                  },
                  {
                    id: 'finished',
                    label: `Completed (${shelf.filter((s) => s.shelfStatus === 'finished').length})`,
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setShelfStatusFilter(f.id)}
                  className={`min-h-[34px] px-3 rounded-md text-xs font-medium border ${
                    shelfStatusFilter === f.id
                      ? 'bg-[#1C1917] text-white border-[#1C1917] dark:bg-[#F3EFE8] dark:text-[#141210]'
                      : 'border-stone-200 dark:border-stone-800 text-[#6B655E] dark:text-[#A8A095]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {filteredShelf.length === 0 ? (
            <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-2">
              <BookOpen className="w-6 h-6 mx-auto text-stone-400" />
              <h2 className="font-display text-lg font-medium">
                {shelf.length === 0 ? 'Your bookshelf is empty' : 'No books in this category'}
              </h2>
              <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
                Open any book or novel and tap the bookmark ribbon or status button to organize your shelf.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6">
              {filteredShelf.map((entry) => (
                <BookCard
                  key={entry.bookId}
                  book={entry.book}
                  onSelect={onSelectBook}
                  progressPercent={getCombinedProgress(entry.bookId)}
                  isOfflineSaved={offlineIds.has(entry.bookId)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PERSONAL READING NOTEBOOK */}
      {subTab === 'notebook' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                value={notebookQuery}
                onChange={(e) => setNotebookQuery(e.target.value)}
                placeholder="Search across saved highlights, notes, and books..."
                aria-label="Search highlights and notes"
                className="w-full min-h-[42px] pl-9 pr-3 rounded-lg bg-white dark:bg-[#1D1A17] border border-stone-300 dark:border-stone-700 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] dark:focus:ring-[#7BA3D1]"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setNotebookColorFilter('all')}
                className={`min-h-[34px] px-3 rounded-md text-xs font-medium border ${
                  notebookColorFilter === 'all'
                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                All
              </button>
              {(Object.keys(HIGHLIGHT_SWATCHES) as HighlightColor[]).map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    setNotebookColorFilter(notebookColorFilter === color ? 'all' : color)
                  }
                  className={`inline-flex items-center gap-1.5 min-h-[34px] px-2.5 rounded-md text-xs font-medium border ${
                    notebookColorFilter === color
                      ? 'border-[#1E3A5F] dark:border-[#7BA3D1] ring-1 ring-[#1E3A5F]'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${HIGHLIGHT_SWATCHES[color].dotClass}`} />
                  <span>{HIGHLIGHT_SWATCHES[color].label}</span>
                </button>
              ))}
            </div>
          </div>

          {notebookGroups.length === 0 ? (
            <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-2">
              <Highlighter className="w-6 h-6 mx-auto text-stone-400" />
              <h2 className="font-display text-lg font-medium">
                {highlights.length + bookmarks.length === 0
                  ? 'Your Reading Notebook is waiting'
                  : 'No highlights or notes match your search'}
              </h2>
              <p className="text-sm text-[#6B655E] dark:text-[#A8A095] max-w-md mx-auto">
                Select any passage while reading to highlight it in color, attach personal reflections, or save a bookmark. Everything stays organized here by book — even offline.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {notebookGroups.map((group) => (
                <section
                  key={group.bookId}
                  className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white/75 dark:bg-[#1D1A17] overflow-hidden"
                >
                  <div className="px-5 py-3.5 border-b border-stone-200/80 dark:border-stone-800 flex items-center justify-between gap-3 bg-[#F3EFE6]/50 dark:bg-[#231F1B]">
                    <div className="min-w-0">
                      <h2 className="font-display text-base sm:text-lg font-semibold text-[#1C1917] dark:text-[#F3EFE8] truncate">
                        {group.book?.title || 'Saved Book'}
                      </h2>
                      <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                        {group.book?.primaryAuthor || ''} · {group.highlights.length} highlight
                        {group.highlights.length === 1 ? '' : 's'}
                        {group.bookmarks.length > 0
                          ? ` · ${group.bookmarks.length} bookmark${group.bookmarks.length === 1 ? '' : 's'}`
                          : ''}
                      </p>
                    </div>
                    {group.book && (
                      <button
                        type="button"
                        onClick={() => onSelectBook(group.book!)}
                        className="text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline shrink-0"
                      >
                        Book Details
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-stone-200/70 dark:divide-stone-800">
                    {group.highlights.map((hl) => {
                      const isEditing = editingNote?.id === hl.id;
                      return (
                        <div key={hl.id} className="p-4 sm:px-5 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              disabled={!group.book}
                              onClick={() => group.book && onOpenHighlight(group.book, hl)}
                              className={`text-left flex-1 pl-3 border-l-4 ${HIGHLIGHT_SWATCHES[hl.color].borderClass} space-y-1 disabled:opacity-60`}
                            >
                              <p className="text-[11px] font-medium text-[#6B655E] dark:text-[#A8A095]">
                                {hl.chapterTitle} · Tap to jump to passage
                              </p>
                              <p className="font-prose text-sm sm:text-base text-[#1C1917] dark:text-[#F3EFE8] leading-relaxed">
                                “{hl.quote}”
                              </p>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingNote(
                                    isEditing
                                      ? null
                                      : {id: hl.id, text: hl.note || '', color: hl.color},
                                  )
                                }
                                aria-label="Edit highlight note"
                                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-stone-500 hover:text-[#1E3A5F]"
                              >
                                <MessageSquarePlus className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteHighlight(hl.id)}
                                aria-label="Delete highlight"
                                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-stone-400 hover:text-[#9A3412]"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {hl.note && !isEditing && (
                            <p className="pl-3.5 text-xs sm:text-sm text-[#44403C] dark:text-[#D6D0C6]">
                              <span className="font-medium text-[#1E3A5F] dark:text-[#7BA3D1]">
                                Note:{' '}
                              </span>
                              {hl.note}
                            </p>
                          )}

                          {isEditing && editingNote && (
                            <div className="pl-3.5 space-y-2 pt-1">
                              <div className="flex items-center gap-1.5">
                                {(Object.keys(HIGHLIGHT_SWATCHES) as HighlightColor[]).map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setEditingNote({...editingNote, color: c})}
                                    className={`w-6 h-6 rounded-full border ${
                                      HIGHLIGHT_SWATCHES[c].dotClass
                                    } ${
                                      editingNote.color === c
                                        ? 'ring-2 ring-offset-1 ring-[#1E3A5F]'
                                        : 'opacity-70'
                                    }`}
                                    aria-label={`Color ${HIGHLIGHT_SWATCHES[c].label}`}
                                  />
                                ))}
                              </div>
                              <textarea
                                rows={2}
                                value={editingNote.text}
                                onChange={(e) =>
                                  setEditingNote({...editingNote, text: e.target.value})
                                }
                                placeholder="Add or edit personal note..."
                                className="w-full p-2.5 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-xs sm:text-sm"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSaveHighlight({
                                      ...hl,
                                      color: editingNote.color,
                                      note: editingNote.text.trim() || undefined,
                                      updatedAt: new Date().toISOString(),
                                    });
                                    setEditingNote(null);
                                  }}
                                  className="inline-flex items-center gap-1 min-h-[34px] px-3 rounded-md bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Save</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingNote(null)}
                                  className="min-h-[34px] px-3 rounded-md border border-stone-300 dark:border-stone-700 text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {group.bookmarks.map((bm) => (
                      <div key={bm.id} className="p-4 sm:px-5 flex items-start justify-between gap-3">
                        <button
                          type="button"
                          disabled={!group.book}
                          onClick={() => group.book && onOpenBookmark(group.book, bm)}
                          className="text-left flex-1 space-y-1 disabled:opacity-60"
                        >
                          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#1E3A5F] dark:text-[#7BA3D1]">
                            <Bookmark className="w-3 h-3" />
                            <span>Bookmark · {bm.chapterTitle}</span>
                          </p>
                          <p className="font-prose text-sm text-[#44403C] dark:text-[#C8C0B4] line-clamp-2">
                            “{bm.excerpt}”
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBookmark(bm.id)}
                          aria-label="Delete bookmark"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-stone-400 hover:text-[#9A3412]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: READING GOALS & PERSONAL INSIGHTS */}
      {subTab === 'insights' && (
        <div className="space-y-6">
          {/* Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                Completed
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {insights.completedCount}
              </p>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">Books & novels</p>
            </div>
            <div className="p-4 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                Active Reads
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {insights.activeCount}
              </p>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">In progress</p>
            </div>
            <div className="p-4 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                Active Reading
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {formatDurationHuman(insights.totalReadingSeconds)}
              </p>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                Across {insights.totalSessions} session{insights.totalSessions === 1 ? '' : 's'}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                Active Listening
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {formatDurationHuman(insights.totalListeningSeconds)}
              </p>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">Audiobooks & voice</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 7-Day Daily Habit Activity */}
            <section className="p-5 sm:p-6 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-[#1E3A5F] dark:text-[#7BA3D1]" />
                    <span>Weekly Reading & Listening</span>
                  </h2>
                  <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                    Today: {insights.todayMinutes} min read/listened · {insights.todayBooks} completed
                  </p>
                </div>
              </div>

              <div className="h-40 flex items-end justify-between gap-2 pt-4 border-b border-stone-200/80 dark:border-stone-800 pb-2">
                {insights.last7Days.map((day) => {
                  const pct = Math.round((day.minutes / maxBarMinutes) * 100);
                  const metGoal =
                    goals.goalType === 'books'
                      ? day.books >= goals.dailyBooksTarget
                      : day.minutes >= goals.dailyMinutesTarget;
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="text-[10px] tabular-nums text-[#6B655E] dark:text-[#A8A095]">
                        {day.minutes > 0 ? `${day.minutes}m` : ''}
                      </span>
                      <div className="w-full max-w-[32px] flex-1 flex items-end">
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            metGoal
                              ? 'bg-[#1E3A5F] dark:bg-[#7BA3D1]'
                              : day.minutes > 0
                                ? 'bg-[#9A3412]/70 dark:bg-[#E07A5F]/80'
                                : 'bg-stone-200 dark:bg-stone-800'
                          }`}
                          style={{height: `${Math.max(day.minutes > 0 ? 12 : 4, pct)}%`}}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-[#6B655E] dark:text-[#A8A095]">
                        {day.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Top Read Genres */}
              <div className="space-y-2 pt-1">
                <p className="text-xs uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                  Most Explored Genres
                </p>
                {insights.topGenres.length === 0 ? (
                  <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                    Open or save books to see your top subjects emerge over time.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {insights.topGenres.map(([slug, count]) => (
                      <span
                        key={slug}
                        className="px-2.5 py-1 rounded-md bg-[#F3EFE6] dark:bg-[#25211D] text-[#1C1917] dark:text-[#F3EFE8] tabular-nums"
                      >
                        {slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} ({count})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Customize Daily Goal & Personal Interests */}
            <section className="p-5 sm:p-6 rounded-xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold">Daily Goal & Personal Taste</h2>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                  Gentle, private habits designed around your schedule — no guilt or leaderboards.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-[#6B655E] dark:text-[#A8A095]">Goal Mode</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateGoals({...goals, goalType: 'time'})}
                    className={`min-h-[40px] rounded-lg border text-xs font-medium ${
                      goals.goalType === 'time'
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}
                  >
                    Daily Reading & Listening Time
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateGoals({...goals, goalType: 'books'})}
                    className={`min-h-[40px] rounded-lg border text-xs font-medium ${
                      goals.goalType === 'books'
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}
                  >
                    Books Completed Target
                  </button>
                </div>
              </div>

              {goals.goalType === 'time' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6B655E] dark:text-[#A8A095]">Daily Time Target</span>
                    <span className="font-semibold tabular-nums">{goals.dailyMinutesTarget} minutes/day</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[10, 15, 20, 30, 45, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => onUpdateGoals({...goals, dailyMinutesTarget: mins})}
                        className={`min-h-[36px] px-3 rounded-md text-xs font-medium tabular-nums border ${
                          goals.dailyMinutesTarget === mins
                            ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                            : 'border-stone-300 dark:border-stone-700'
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6B655E] dark:text-[#A8A095]">Daily Completion Target</span>
                    <span className="font-semibold tabular-nums">
                      {goals.dailyBooksTarget} book{goals.dailyBooksTarget > 1 ? 's' : ''}/day
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => onUpdateGoals({...goals, dailyBooksTarget: cnt})}
                        className={`min-h-[36px] px-4 rounded-md text-xs font-medium tabular-nums border ${
                          goals.dailyBooksTarget === cnt
                            ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                            : 'border-stone-300 dark:border-stone-700'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-stone-200/70 dark:border-stone-800">
                <div>
                  <p className="text-sm font-medium">Track Daily Streaks</p>
                  <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                    Optional quiet streak indicator on your Home goal card
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateGoals({...goals, streakEnabled: !goals.streakEnabled})}
                  className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium border ${
                    goals.streakEnabled
                      ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  {goals.streakEnabled ? 'Enabled' : 'Hidden'}
                </button>
              </div>

              {/* Personal Interest Genres for Recommendation Tuning */}
              <div className="space-y-2 pt-2 border-t border-stone-200/70 dark:border-stone-800">
                <p className="text-sm font-medium">Personal Interests</p>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                  Select subjects you enjoy to personalize Home recommendations
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pt-1">
                  {genres.slice(0, 18).map((g) => {
                    const selected = goals.preferredInterests.includes(g.slug);
                    return (
                      <button
                        key={g.slug}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? goals.preferredInterests.filter((s) => s !== g.slug)
                            : [...goals.preferredInterests, g.slug];
                          onUpdateGoals({...goals, preferredInterests: next});
                        }}
                        className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium border transition-colors ${
                          selected
                            ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                            : 'border-stone-300 dark:border-stone-700 text-[#44403C] dark:text-[#D6D0C6]'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 4: OFFLINE STORAGE & DOWNLOAD MANAGER */}
      {subTab === 'offline' && (
        <div className="space-y-4">
          <div className="p-4 sm:p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/75 dark:bg-[#1D1A17] flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]">
                Offline Library & Storage
              </p>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095] tabular-nums">
                Saved book text: {formatBytes(totalOfflineBytes)} ({offlineBooks.length} book
                {offlineBooks.length === 1 ? '' : 's'})
                {storageEstimate.quotaBytes
                  ? ` · Device origin quota ~${formatBytes(storageEstimate.quotaBytes)}`
                  : ''}
              </p>
              <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">
                Bookmarks, highlights, personal notes, and reading/listening progress are always stored locally and reconcile cleanly when you reconnect.
              </p>
            </div>
            {offlineBooks.length > 0 && (
              <button
                type="button"
                onClick={() => void onClearAllOffline()}
                className="min-h-[38px] px-3.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-[#9A3412] dark:text-[#E07A5F] hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                Clear All Offline Copies
              </button>
            )}
          </div>

          {activeDownloadsList.length > 0 && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/60 dark:bg-[#1D1A17] space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]">
                Download Status
              </p>
              {activeDownloadsList.map((dl) => (
                <div key={dl.bookId} className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>{dl.stageLabel}</span>
                    <span className="tabular-nums">{dl.percent}%</span>
                  </div>
                  {dl.error && (
                    <p className="text-[#9A3412] dark:text-[#F28482]">{dl.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {offlineBooks.length === 0 ? (
            <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-2">
              <WifiOff className="w-6 h-6 mx-auto text-stone-400" />
              <h2 className="font-display text-lg font-medium">No offline books downloaded</h2>
              <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
                Folio never downloads books automatically. Open any readable book and tap “Save for Offline” to keep it on your device.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-200 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-xl bg-white/70 dark:bg-[#1D1A17] overflow-hidden">
              {offlineBooks.map((item) => (
                <div key={item.bookId} className="p-4 flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => onSelectBook(item.book)}
                    className="text-left flex-1 min-w-0 space-y-0.5"
                  >
                    <p className="font-display text-base font-medium text-[#1C1917] dark:text-[#F3EFE8] truncate">
                      {item.book.title}
                    </p>
                    <p className="text-xs text-[#6B655E] dark:text-[#A8A095] truncate tabular-nums">
                      {item.book.primaryAuthor} · {item.chapters.length} chapters ·{' '}
                      {formatBytes(item.byteSize)} · Available offline
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemoveOffline(item.bookId)}
                    aria-label={`Remove ${item.book.title} offline copy`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-stone-400 hover:text-[#9A3412]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: FAVOURITES */}
      {subTab === 'favourites' &&
        (favourites.length === 0 ? (
          <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-2">
            <Heart className="w-6 h-6 mx-auto text-stone-400" />
            <h2 className="font-display text-lg font-medium">No favourites marked yet</h2>
            <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
              Tap the heart icon on any book detail page to collect your personal favourites.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6">
            {favourites.map((entry) => (
              <BookCard
                key={entry.bookId}
                book={entry.book}
                onSelect={onSelectBook}
                progressPercent={getCombinedProgress(entry.bookId)}
                isOfflineSaved={offlineIds.has(entry.bookId)}
              />
            ))}
          </div>
        ))}

      {/* TAB 6: HISTORY */}
      {subTab === 'history' &&
        (history.length === 0 ? (
          <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-2">
            <History className="w-6 h-6 mx-auto text-stone-400" />
            <h2 className="font-display text-lg font-medium">No reading history yet</h2>
            <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
              Books you read or listen to will appear here chronologically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6">
            {history.map((entry) => (
              <BookCard
                key={entry.bookId}
                book={entry.book}
                onSelect={onSelectBook}
                progressPercent={getCombinedProgress(entry.bookId)}
                isOfflineSaved={offlineIds.has(entry.bookId)}
              />
            ))}
          </div>
        ))}

      {/* TAB 7: SETTINGS, REMINDERS, BACKUP & SYNC */}
      {subTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* App Appearance, Reading Presets & Listening Defaults */}
          <section className="p-5 sm:p-6 rounded-xl bg-white/75 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
                Appearance & Reading
              </h2>
              <button
                type="button"
                onClick={() => onUpdatePreferences(DEFAULT_PREFERENCES)}
                className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>
            </div>

            {/* Global 3-Way Appearance Switch */}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Application Appearance</p>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                  Applies consistently across discovery, bookshelf, search, and audio player
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#F3EFE6] dark:bg-[#25211D]">
                {(
                  [
                    {id: 'light', label: 'Light', Icon: Sun},
                    {id: 'dark', label: 'Dark', Icon: Moon},
                    {id: 'system', label: 'System', Icon: Monitor},
                  ] as const
                ).map(({id, label, Icon}) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onUpdatePreferences({...preferences, appTheme: id})}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-md text-xs font-medium transition-colors ${
                      preferences.appTheme === id
                        ? 'bg-white text-[#1C1917] dark:bg-[#141210] dark:text-[#F3EFE8] shadow-sm'
                        : 'text-[#6B655E] dark:text-[#A8A095]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Personal Reading Presets */}
            <div className="space-y-2 pt-3 border-t border-stone-200/70 dark:border-stone-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Personal Reading Preset</p>
                <span className="text-xs capitalize text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">
                  {preferences.preset}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    {id: 'classic', label: 'Classic', desc: 'Serif · Sepia'},
                    {id: 'focus', label: 'Focus', desc: 'Pages · Minimal'},
                    {id: 'night', label: 'Night', desc: 'Dark Ink'},
                    {id: 'comfortable', label: 'Comfortable', desc: 'Large · Airy'},
                  ] as Array<{id: Exclude<ReaderPresetId, 'custom'>; label: string; desc: string}>
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onUpdatePreferences(applyReaderPreset(preferences, p.id))}
                    className={`min-h-[48px] px-3 py-2 rounded-lg border text-left transition-colors ${
                      preferences.preset === p.id
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}
                  >
                    <span className="block text-xs font-semibold">{p.label}</span>
                    <span className="block text-[10px] opacity-80">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Reader Page Theme, Font Family, Layout */}
            <div className="space-y-3 pt-3 border-t border-stone-200/70 dark:border-stone-800">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium text-[#6B655E] dark:text-[#A8A095]">
                  Reader Screen Theme
                </span>
                <div className="flex gap-1.5">
                  {(['light', 'sepia', 'dark'] as const).map((rt) => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => updateCustomReadingPref({readerTheme: rt})}
                      className={`min-h-[36px] px-3 rounded-md text-xs font-medium capitalize border ${
                        preferences.readerTheme === rt
                          ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}
                    >
                      {rt === 'light' ? 'Paper' : rt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium text-[#6B655E] dark:text-[#A8A095]">
                  Font & Layout
                </span>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  <select
                    aria-label="Default reading font family"
                    value={preferences.fontFamily}
                    onChange={(e) =>
                      updateCustomReadingPref({fontFamily: e.target.value as ReaderFontFamily})
                    }
                    className="min-h-[36px] px-2.5 rounded-md border border-stone-300 dark:border-stone-700 bg-transparent text-xs font-medium"
                  >
                    <option value="serif">Lora Serif</option>
                    <option value="source-serif">Source Serif</option>
                    <option value="georgia">Georgia</option>
                    <option value="sans">Plus Jakarta</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      updateCustomReadingPref({
                        layoutMode: preferences.layoutMode === 'scroll' ? 'paginated' : 'scroll',
                      })
                    }
                    className="min-h-[36px] px-3 rounded-md border border-stone-300 dark:border-stone-700 text-xs font-medium"
                  >
                    {preferences.layoutMode === 'paginated' ? 'Pages' : 'Scroll'}
                  </button>
                </div>
              </div>
            </div>

            {/* Listening Defaults */}
            <div className="space-y-3 pt-3 border-t border-stone-200/70 dark:border-stone-800">
              <p className="text-sm font-medium">Audio & Voice Defaults</p>
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-[#6B655E] dark:text-[#A8A095]">Default Speed</span>
                <div className="flex gap-1">
                  {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onUpdatePreferences({...preferences, playbackRate: r})}
                      className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium tabular-nums border ${
                        Math.abs(preferences.playbackRate - r) < 0.04
                          ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                          : 'border-stone-300 dark:border-stone-700'
                      }`}
                    >
                      {r}x
                    </button>
                  ))}
                </div>
              </div>

              {ttsVoicesAvailable ? (
                <div className="space-y-1">
                  <label
                    htmlFor="settings-tts-voice"
                    className="block text-xs text-[#6B655E] dark:text-[#A8A095]"
                  >
                    Preferred Browser Speech Voice
                  </label>
                  <select
                    id="settings-tts-voice"
                    value={preferences.preferredVoiceURI || ''}
                    onChange={(e) =>
                      onUpdatePreferences({...preferences, preferredVoiceURI: e.target.value || null})
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-xs"
                  >
                    <option value="">System Default Voice</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                  Browser speech voices are unavailable in this headless/OS environment; LibriVox human-narrated audiobooks remain playable everywhere.
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-stone-200/70 dark:border-stone-800 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Install on Smartphone</p>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                  Add Folio to your home screen for offline reading
                </p>
              </div>
              <PWAInstallButton variant="full" />
            </div>
          </section>

          {/* Right Column: Reading Reminders + Personal Backup & Restore + Sync */}
          <div className="space-y-6">
            {/* Optional Reading Reminders */}
            <section className="p-5 sm:p-6 rounded-xl bg-white/75 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[#1E3A5F] dark:text-[#7BA3D1]" />
                    <span>Reading Reminders</span>
                  </h2>
                  <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                    Optional gentle reminder for your preferred reading window
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateGoals({...goals, reminderEnabled: !goals.reminderEnabled})
                  }
                  className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium border ${
                    goals.reminderEnabled
                      ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210]'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  {goals.reminderEnabled ? 'Active' : 'Off'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="reminder-time" className="block text-xs text-[#6B655E] dark:text-[#A8A095]">
                    Preferred Local Time
                  </label>
                  <input
                    id="reminder-time"
                    type="time"
                    value={goals.reminderTime}
                    onChange={(e) => onUpdateGoals({...goals, reminderTime: e.target.value})}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="reminder-freq" className="block text-xs text-[#6B655E] dark:text-[#A8A095]">
                    Schedule
                  </label>
                  <select
                    id="reminder-freq"
                    value={goals.reminderFrequency}
                    onChange={(e) =>
                      onUpdateGoals({
                        ...goals,
                        reminderFrequency: e.target.value as ReadingGoalsConfig['reminderFrequency'],
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-xs"
                  >
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays (Mon–Fri)</option>
                    <option value="weekends">Weekends (Sat–Sun)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {notifPerm !== 'unsupported' && notifPerm !== 'granted' && (
                  <button
                    type="button"
                    onClick={() => {
                      void requestReminderPermission().then(setNotifPerm);
                    }}
                    className="min-h-[38px] px-3.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Allow Browser Notifications
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadIcs}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  <span>Add Calendar Reminder (.ics)</span>
                </button>
              </div>

              <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095] leading-relaxed">
                {notifPerm === 'granted'
                  ? 'Browser notifications allowed. Local reminders trigger while Folio is open or resumed; for reliable OS lock-screen alerts without a remote push server, add the Calendar (.ics) reminder above.'
                  : 'Because Folio runs locally at ₹0 without a remote push server, browser reminders only appear when Folio is open or resumed. Use “Add Calendar Reminder (.ics)” for guaranteed phone lock-screen alerts.'}
              </p>
            </section>

            {/* Personal Data Backup & Restore */}
            <section className="p-5 sm:p-6 rounded-xl bg-white/75 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
                  Personal Data Backup & Restore
                </h2>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5 leading-relaxed">
                  Export or restore your bookshelf, reading & listening progress, bookmarks, highlights, personal notes, goals, and preferences. Downloaded book text is excluded so backups stay portable and copyright-safe.
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleExportBackup()}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Backup (.json)</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => void handlePickBackupFile(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <Upload className="w-4 h-4" />
                  <span>Restore from Backup</span>
                </button>
              </div>

              {backupMessage && (
                <p className="text-xs text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">
                  {backupMessage}
                </p>
              )}
              {backupError && (
                <p className="inline-flex items-center gap-1.5 text-xs text-[#9A3412] dark:text-[#F28482]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{backupError}</span>
                </p>
              )}

              {/* Explicit Confirmation Panel for Backup Import */}
              {pendingRestore?.summary && (
                <div className="p-4 rounded-xl bg-[#F3EFE6] dark:bg-[#25211D] border border-stone-300 dark:border-stone-700 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#1C1917] dark:text-[#F3EFE8]">
                        Confirm Backup Restore
                      </p>
                      <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">
                        Exported{' '}
                        {new Date(pendingRestore.summary.exportedAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingRestore(null)}
                      aria-label="Cancel restore"
                      className="p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <ul className="text-xs space-y-1 text-[#44403C] dark:text-[#D6D0C6] tabular-nums">
                    <li>
                      • {pendingRestore.summary.shelfCount} shelved books (
                      {pendingRestore.summary.duplicateShelfCount} already on shelf)
                    </li>
                    <li>
                      • {pendingRestore.summary.highlightsCount} highlights &{' '}
                      {pendingRestore.summary.notesCount} notes (
                      {pendingRestore.summary.duplicateHighlightsCount} existing)
                    </li>
                    <li>
                      • {pendingRestore.summary.bookmarksCount} bookmarks &{' '}
                      {pendingRestore.summary.progressCount} reading positions
                    </li>
                  </ul>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={restoreBusy}
                      onClick={() => void handleConfirmRestore('merge')}
                      className="min-h-[38px] px-3.5 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium disabled:opacity-50"
                    >
                      Merge (Keep Newer)
                    </button>
                    <button
                      type="button"
                      disabled={restoreBusy}
                      onClick={() => void handleConfirmRestore('replace')}
                      className="min-h-[38px] px-3.5 rounded-lg border border-[#9A3412]/50 text-[#9A3412] dark:text-[#E07A5F] text-xs font-medium disabled:opacity-50"
                    >
                      Replace Current Data
                    </button>
                    <button
                      type="button"
                      disabled={restoreBusy}
                      onClick={() => setPendingRestore(null)}
                      className="min-h-[38px] px-3 rounded-lg border border-stone-300 dark:border-stone-700 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Automated Catalogue Synchronization Panel */}
            <section className="p-5 sm:p-6 rounded-xl bg-white/75 dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
                    Catalogue Synchronization
                  </h2>
                  <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                    Daily automated sync + automatic stale-cache refresh on open.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={onTriggerSync}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Refresh'}</span>
                </button>
              </div>

              {syncStatus && (
                <>
                  <div className="grid grid-cols-3 gap-3 py-3 border-y border-stone-200/80 dark:border-stone-800 text-center">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">
                        {syncStatus.totalCatalogBooks}
                      </p>
                      <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">Indexed Titles</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">
                        {syncStatus.newlyAddedCount}
                      </p>
                      <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">New This Sync</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{syncStatus.updatedCount}</p>
                      <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">Updated</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {syncStatus.providers.map((p) => (
                      <div key={p.provider} className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-[#1C1917] dark:text-[#F3EFE8] truncate">
                            {p.name}
                          </p>
                          {p.error && (
                            <p className="text-[11px] text-[#9A3412] dark:text-[#F28482] truncate">
                              {p.error}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0 tabular-nums">
                          <span className="text-[#6B655E] dark:text-[#A8A095]">
                            {p.itemCount} books · {p.status === 'ok' ? 'Healthy' : p.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
