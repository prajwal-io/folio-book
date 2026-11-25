import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  BookMarked,
  BookOpen,
  Compass,
  Home,
  Library,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AudiobookEdition,
  AudioModeType,
  BookEdition,
  BookmarkItem,
  BookshelfEntry,
  CatalogBook,
  DailyActivityRecord,
  FolioBackupPayload,
  HighlightAnnotation,
  HomeCollectionsResponse,
  LastSessionActivity,
  ListeningProgress,
  OfflineDownloadProgress,
  OfflineSavedBook,
  PublicationPeriodFilter,
  ReaderPreferences,
  ReadingGoalsConfig,
  ReadingHistoryEntry,
  ReadingProgress,
  SyncStatus,
} from './types/library';
import {libraryApi, type GenreWithCount} from './lib/api';
import {AudioPlayerProvider, useAudioPlayer} from './lib/audioContext';
import {shouldTriggerReminderNow, showLocalReadingReminder} from './lib/reminders';
import {
  DEFAULT_GOALS,
  DEFAULT_PREFERENCES,
  getLocalDateKey,
  personalStorage,
} from './lib/storage';
import {useOnlineStatus} from './lib/usePWA';
import {AudioPlayerModal} from './components/AudioPlayerModal';
import {BookDetailModal} from './components/BookDetailModal';
import {CatalogBrowseView} from './components/CatalogBrowseView';
import {GenresDirectoryView} from './components/GenresDirectoryView';
import {HomeView} from './components/HomeView';
import {MiniPlayerBar} from './components/MiniPlayerBar';
import {ReaderView} from './components/ReaderView';
import {ShelfView, type ShelfSubTab} from './components/ShelfView';

type PrimaryTab = 'home' | 'books' | 'novels' | 'genres' | 'shelf';

function applyAppearanceClass(appTheme: ReaderPreferences['appTheme']) {
  const root = document.documentElement;
  const systemDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = appTheme === 'dark' || (appTheme === 'system' && Boolean(systemDark));
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#141210' : '#FBF9F5');
  }
}

export default function App() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(() => {
    try {
      const raw = localStorage.getItem('folio-preferences');
      if (raw) return {...DEFAULT_PREFERENCES, ...JSON.parse(raw)};
    } catch {
      // ignore
    }
    return DEFAULT_PREFERENCES;
  });
  const [goals, setGoals] = useState<ReadingGoalsConfig>(DEFAULT_GOALS);
  const [shelf, setShelf] = useState<BookshelfEntry[]>([]);
  const [progressList, setProgressList] = useState<ReadingProgress[]>([]);
  const [listeningList, setListeningList] = useState<ListeningProgress[]>([]);
  const [lastSession, setLastSession] = useState<LastSessionActivity | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [highlights, setHighlights] = useState<HighlightAnnotation[]>([]);
  const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);
  const [offlineBooks, setOfflineBooks] = useState<OfflineSavedBook[]>([]);
  const [activityDays, setActivityDays] = useState<DailyActivityRecord[]>([]);

  // Hydrate personal reading, annotation, goal, and listening data from IndexedDB immediately
  const refreshPersonalData = useCallback(async () => {
    const [
      prefs,
      goalCfg,
      shelfRows,
      progRows,
      listenRows,
      sessionRow,
      bmRows,
      hlRows,
      histRows,
      offRows,
      actRows,
    ] = await Promise.all([
      personalStorage.getPreferences(),
      personalStorage.getGoals(),
      personalStorage.getBookshelf(),
      personalStorage.getAllProgress(),
      personalStorage.getAllListeningProgress(),
      personalStorage.getLastSession(),
      personalStorage.getBookmarks(),
      personalStorage.getHighlights(),
      personalStorage.getHistory(),
      personalStorage.getOfflineBooks(),
      personalStorage.getAllActivityDays(),
    ]);
    setPreferences(prefs);
    setGoals(goalCfg);
    setShelf(shelfRows);
    setProgressList(progRows);
    setListeningList(listenRows);
    setLastSession(sessionRow);
    setBookmarks(bmRows);
    setHighlights(hlRows);
    setHistory(histRows);
    setOfflineBooks(offRows);
    setActivityDays(actRows);
  }, []);

  useEffect(() => {
    void refreshPersonalData();
  }, [refreshPersonalData]);

  // Sync global light / dark / system appearance + watch OS theme changes live
  useEffect(() => {
    applyAppearanceClass(preferences.appTheme);
    if (preferences.appTheme !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyAppearanceClass('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [preferences.appTheme]);

  const handleUpdatePreferences = useCallback(async (next: ReaderPreferences) => {
    setPreferences(next);
    await personalStorage.savePreferences(next);
  }, []);

  const handleUpdateGoals = useCallback(async (next: ReadingGoalsConfig) => {
    setGoals(next);
    await personalStorage.saveGoals(next);
  }, []);

  const handleActiveListeningSeconds = useCallback((seconds: number) => {
    void personalStorage.recordActiveSeconds('listen', seconds, false).then(async () => {
      setActivityDays(await personalStorage.getAllActivityDays());
    });
  }, []);

  const handleListeningProgressSaved = useCallback((prog: ListeningProgress) => {
    setListeningList((prev) => {
      const filtered = prev.filter((item) => item.bookId !== prog.bookId);
      return [prog, ...filtered].sort(
        (a, b) => new Date(b.lastListenedAt).getTime() - new Date(a.lastListenedAt).getTime(),
      );
    });
    setLastSession({
      bookId: prog.bookId,
      activeMode: 'listen',
      updatedAt: prog.lastListenedAt,
      book: prog.book,
    });
    if (prog.percentComplete >= 97) {
      void personalStorage.markBookCompletedActivity(prog.bookId).then(async () => {
        setActivityDays(await personalStorage.getAllActivityDays());
      });
    }
  }, []);

  const handleRecordHistory = useCallback(async (book: CatalogBook) => {
    await personalStorage.recordHistory(book);
    setHistory(await personalStorage.getHistory());
  }, []);

  return (
    <AudioPlayerProvider
      preferences={preferences}
      onUpdatePreferences={(next) => void handleUpdatePreferences(next)}
      onListeningProgressSaved={handleListeningProgressSaved}
      onRecordHistory={(b) => void handleRecordHistory(b)}
      onActiveListeningSeconds={handleActiveListeningSeconds}
    >
      <FolioShell
        preferences={preferences}
        goals={goals}
        shelf={shelf}
        setShelf={setShelf}
        progressList={progressList}
        setProgressList={setProgressList}
        listeningList={listeningList}
        lastSession={lastSession}
        setLastSession={setLastSession}
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        highlights={highlights}
        setHighlights={setHighlights}
        history={history}
        offlineBooks={offlineBooks}
        setOfflineBooks={setOfflineBooks}
        activityDays={activityDays}
        setActivityDays={setActivityDays}
        onUpdatePreferences={(next) => void handleUpdatePreferences(next)}
        onUpdateGoals={(next) => void handleUpdateGoals(next)}
        onRefreshAllPersonal={refreshPersonalData}
        onRecordHistory={(b) => void handleRecordHistory(b)}
      />
    </AudioPlayerProvider>
  );
}

interface FolioShellProps {
  preferences: ReaderPreferences;
  goals: ReadingGoalsConfig;
  shelf: BookshelfEntry[];
  setShelf: React.Dispatch<React.SetStateAction<BookshelfEntry[]>>;
  progressList: ReadingProgress[];
  setProgressList: React.Dispatch<React.SetStateAction<ReadingProgress[]>>;
  listeningList: ListeningProgress[];
  lastSession: LastSessionActivity | null;
  setLastSession: React.Dispatch<React.SetStateAction<LastSessionActivity | null>>;
  bookmarks: BookmarkItem[];
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkItem[]>>;
  highlights: HighlightAnnotation[];
  setHighlights: React.Dispatch<React.SetStateAction<HighlightAnnotation[]>>;
  history: ReadingHistoryEntry[];
  offlineBooks: OfflineSavedBook[];
  setOfflineBooks: React.Dispatch<React.SetStateAction<OfflineSavedBook[]>>;
  activityDays: DailyActivityRecord[];
  setActivityDays: React.Dispatch<React.SetStateAction<DailyActivityRecord[]>>;
  onUpdatePreferences: (next: ReaderPreferences) => void;
  onUpdateGoals: (next: ReadingGoalsConfig) => void;
  onRefreshAllPersonal: () => Promise<void>;
  onRecordHistory: (book: CatalogBook) => void;
}

const FolioShell: React.FC<FolioShellProps> = ({
  preferences,
  goals,
  shelf,
  setShelf,
  progressList,
  setProgressList,
  listeningList,
  lastSession,
  setLastSession,
  bookmarks,
  setBookmarks,
  highlights,
  setHighlights,
  history,
  offlineBooks,
  setOfflineBooks,
  activityDays,
  setActivityDays,
  onUpdatePreferences,
  onUpdateGoals,
  onRefreshAllPersonal,
  onRecordHistory,
}) => {
  const isOnline = useOnlineStatus();
  const {activeBook, startListening, pause} = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');
  const [shelfInitialSubTab, setShelfInitialSubTab] = useState<ShelfSubTab>('shelf');
  const [browseGenre, setBrowseGenre] = useState('');
  const [browsePeriod, setBrowsePeriod] = useState<PublicationPeriodFilter>('all');
  const [browseAllKinds, setBrowseAllKinds] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');

  // Catalogue state
  const [homeData, setHomeData] = useState<HomeCollectionsResponse | null>(null);
  const [discoveryPool, setDiscoveryPool] = useState<CatalogBook[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [genres, setGenres] = useState<GenreWithCount[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Offline download status tracker & local reminders banner
  const [downloadProgressMap, setDownloadProgressMap] = useState<
    Record<string, OfflineDownloadProgress>
  >({});
  const [reminderDueBanner, setReminderDueBanner] = useState(false);

  // Active detail / reader overlays
  const [selectedBook, setSelectedBook] = useState<CatalogBook | null>(null);
  const [readerState, setReaderState] = useState<{
    book: CatalogBook;
    edition: BookEdition;
    overrideProgress?: ReadingProgress | null;
    highlightJump?: HighlightAnnotation | null;
  } | null>(null);

  // Load catalogue home, discovery pool, & genres
  const loadCatalogue = useCallback(async () => {
    setHomeLoading(true);
    setHomeError(null);
    try {
      const [homeRes, genreRes, discoverRes] = await Promise.all([
        libraryApi.getHome(),
        libraryApi.getGenres(),
        libraryApi.getDiscoveryPool().catch(() => ({items: [] as CatalogBook[]})),
      ]);
      setHomeData(homeRes);
      setSyncStatus(homeRes.syncStatus);
      setGenres(genreRes.genres);
      if (discoverRes.items.length > 0) {
        setDiscoveryPool(discoverRes.items);
      }
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Unable to fetch catalogue');
    } finally {
      setHomeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  // Evaluate local reminder trigger safely when active
  useEffect(() => {
    const checkReminder = () => {
      if (!shouldTriggerReminderNow(goals)) return;
      const todayKey = getLocalDateKey();
      setReminderDueBanner(true);
      onUpdateGoals({...goals, lastReminderDate: todayKey});
      void showLocalReadingReminder(
        'Folio Reading Reminder',
        'Ready for a quiet reading or listening session?',
      );
    };
    checkReminder();
    const timer = window.setInterval(checkReminder, 60_000);
    return () => window.clearInterval(timer);
  }, [goals, onUpdateGoals]);

  const handleTriggerSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await libraryApi.triggerSync();
      setSyncStatus(res.syncStatus);
      await loadCatalogue();
    } catch {
      // keep current state
    } finally {
      setIsSyncing(false);
    }
  };

  const progressByBookId = useMemo(() => {
    const map: Record<string, ReadingProgress> = {};
    for (const p of progressList) {
      map[p.bookId] = p;
    }
    return map;
  }, [progressList]);

  const listeningByBookId = useMemo(() => {
    const map: Record<string, ListeningProgress> = {};
    for (const l of listeningList) {
      map[l.bookId] = l;
    }
    return map;
  }, [listeningList]);

  const offlineMap = useMemo(() => {
    const map = new Map<string, OfflineSavedBook>();
    for (const o of offlineBooks) map.set(o.bookId, o);
    return map;
  }, [offlineBooks]);

  const offlineIds = useMemo(() => new Set(offlineBooks.map((o) => o.bookId)), [offlineBooks]);

  const continueReading = progressList[0] || null;
  const continueListening = listeningList[0] || null;

  const handleToggleShelf = async (book: CatalogBook) => {
    const existing = shelf.find((s) => s.bookId === book.id);
    if (existing) {
      await personalStorage.removeShelfEntry(book.id);
    } else {
      await personalStorage.upsertShelfEntry({
        bookId: book.id,
        book,
        addedAt: new Date().toISOString(),
        isFavourite: false,
        shelfStatus: 'saved',
      });
    }
    setShelf(await personalStorage.getBookshelf());
  };

  const handleSetShelfStatus = async (
    book: CatalogBook,
    status: BookshelfEntry['shelfStatus'],
  ) => {
    const existing = shelf.find((s) => s.bookId === book.id);
    await personalStorage.upsertShelfEntry({
      bookId: book.id,
      book,
      addedAt: existing?.addedAt || new Date().toISOString(),
      isFavourite: Boolean(existing?.isFavourite),
      shelfStatus: status,
    });
    setShelf(await personalStorage.getBookshelf());
    if (status === 'finished') {
      await personalStorage.markBookCompletedActivity(book.id);
      setActivityDays(await personalStorage.getAllActivityDays());
    }
  };

  const handleToggleFavourite = async (book: CatalogBook) => {
    const existing = shelf.find((s) => s.bookId === book.id);
    await personalStorage.upsertShelfEntry({
      bookId: book.id,
      book,
      addedAt: existing?.addedAt || new Date().toISOString(),
      isFavourite: !(existing?.isFavourite ?? false),
      shelfStatus: existing?.shelfStatus || 'saved',
    });
    setShelf(await personalStorage.getBookshelf());
  };

  const handleSaveOffline = async (book: CatalogBook, edition: BookEdition) => {
    setDownloadProgressMap((prev) => ({
      ...prev,
      [book.id]: {
        bookId: book.id,
        status: 'downloading',
        percent: 20,
        stageLabel: 'Fetching book chapters...',
      },
    }));

    try {
      const content = await libraryApi.getReaderContent(book, edition.editionId);
      if (!content.readableInApp || content.chapters.length === 0) {
        throw new Error(
          content.unavailableReason || 'This external edition cannot be cached for offline reading.',
        );
      }

      setDownloadProgressMap((prev) => ({
        ...prev,
        [book.id]: {
          bookId: book.id,
          status: 'downloading',
          percent: 78,
          stageLabel: `Storing ${content.chapters.length} chapters offline...`,
        },
      }));

      await personalStorage.saveOfflineBook(
        book,
        content.editionId,
        content.chapters,
        content.totalWords,
      );
      setOfflineBooks(await personalStorage.getOfflineBooks());
      setDownloadProgressMap((prev) => {
        const next = {...prev};
        delete next[book.id];
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Offline download failed';
      setDownloadProgressMap((prev) => ({
        ...prev,
        [book.id]: {
          bookId: book.id,
          status: 'error',
          percent: 0,
          stageLabel: 'Download interrupted',
          error: msg,
        },
      }));
      throw err instanceof Error ? err : new Error(msg);
    }
  };

  const handleRemoveOffline = async (bookId: string) => {
    await personalStorage.removeOfflineBook(bookId);
    setOfflineBooks(await personalStorage.getOfflineBooks());
    setDownloadProgressMap((prev) => {
      const next = {...prev};
      delete next[bookId];
      return next;
    });
  };

  const handleClearAllOffline = async () => {
    await personalStorage.clearAllOfflineBooks();
    setOfflineBooks([]);
    setDownloadProgressMap({});
  };

  const handleStartReading = useCallback(
    async (
      book: CatalogBook,
      edition: BookEdition,
      overrideProgress?: ReadingProgress | null,
      highlightJump?: HighlightAnnotation | null,
    ) => {
      pause();
      setSelectedBook(null);
      setReaderState({book, edition, overrideProgress, highlightJump});
      const session: LastSessionActivity = {
        bookId: book.id,
        activeMode: 'read',
        updatedAt: new Date().toISOString(),
        book,
      };
      setLastSession(session);
      void personalStorage.saveLastSession(session);
      onRecordHistory(book);
    },
    [onRecordHistory, pause, setLastSession],
  );

  const handleStartListening = useCallback(
    async (
      book: CatalogBook,
      edition: BookEdition | undefined,
      preferredMode: AudioModeType,
      audiobook?: AudiobookEdition,
      chapterIndex?: number,
      scrollRatio?: number,
    ) => {
      setSelectedBook(null);
      setReaderState(null);
      await startListening({
        book,
        edition,
        audiobook,
        preferredMode,
        chapterIndex,
        scrollRatio,
        resumeSaved: typeof chapterIndex !== 'number',
        expand: true,
      });
    },
    [startListening],
  );

  const handleSaveProgress = useCallback(
    async (progress: ReadingProgress) => {
      await personalStorage.saveProgress(progress);
      setProgressList(await personalStorage.getAllProgress());
      const session: LastSessionActivity = {
        bookId: progress.bookId,
        activeMode: 'read',
        updatedAt: progress.lastReadAt,
        book: progress.book,
      };
      setLastSession(session);
      void personalStorage.saveLastSession(session);

      if (progress.percentComplete >= 97) {
        const existingShelf = await personalStorage.getShelfEntry(progress.bookId);
        if (existingShelf && existingShelf.shelfStatus !== 'finished') {
          await personalStorage.upsertShelfEntry({...existingShelf, shelfStatus: 'finished'});
          setShelf(await personalStorage.getBookshelf());
        }
        await personalStorage.markBookCompletedActivity(progress.bookId);
        setActivityDays(await personalStorage.getAllActivityDays());
      }
    },
    [setActivityDays, setLastSession, setProgressList, setShelf],
  );

  const handleActiveReadingSeconds = useCallback(
    (seconds: number, isNewSession: boolean) => {
      void personalStorage.recordActiveSeconds('read', seconds, isNewSession).then(async () => {
        setActivityDays(await personalStorage.getAllActivityDays());
      });
    },
    [setActivityDays],
  );

  const handleAddBookmark = async (bm: BookmarkItem) => {
    await personalStorage.addBookmark(bm);
    setBookmarks(await personalStorage.getBookmarks());
  };

  const handleDeleteBookmark = async (id: string) => {
    await personalStorage.deleteBookmark(id);
    setBookmarks(await personalStorage.getBookmarks());
  };

  const handleSaveHighlight = async (hl: HighlightAnnotation) => {
    await personalStorage.saveHighlight(hl);
    setHighlights(await personalStorage.getHighlights());
  };

  const handleDeleteHighlight = async (id: string) => {
    await personalStorage.deleteHighlight(id);
    setHighlights(await personalStorage.getHighlights());
  };

  const handleRestoreBackup = async (
    payload: FolioBackupPayload,
    strategy: 'merge' | 'replace',
  ) => {
    await personalStorage.importPersonalBackup(payload, strategy);
    await onRefreshAllPersonal();
  };

  const handleNavigateTab = (
    tab: PrimaryTab,
    genreSlug = '',
    period: PublicationPeriodFilter = 'all',
    allKinds = false,
  ) => {
    setActiveTab(tab);
    setBrowseGenre(genreSlug);
    setBrowsePeriod(period);
    setBrowseAllKinds(allKinds);
    if (tab === 'home' || tab === 'genres' || tab === 'shelf') {
      setSearchQuery('');
    }
    window.scrollTo({top: 0, behavior: 'instant' as ScrollBehavior});
  };

  const handleSubmitGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchDraft.trim());
    setSearchModalOpen(false);
    setBrowseGenre('');
    setBrowsePeriod('all');
    setBrowseAllKinds(true);
    setActiveTab('books');
  };

  const navItems: Array<{id: PrimaryTab; label: string; icon: React.ComponentType<{className?: string}>}> = [
    {id: 'home', label: 'Home', icon: Home},
    {id: 'books', label: 'Books', icon: Library},
    {id: 'novels', label: 'Novels', icon: BookOpen},
    {id: 'genres', label: 'Genres', icon: Compass},
    {id: 'shelf', label: 'Shelf', icon: BookMarked},
  ];

  const mainBottomPadding = activeBook ? 'pb-36 md:pb-24' : 'pb-24 md:pb-14';

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] text-[#1C1917] dark:bg-[#141210] dark:text-[#F3EFE8] transition-colors">
      {/* 3-Zone Top Bar */}
      <header className="md:sticky md:top-0 z-30 bg-[#FBF9F5]/95 dark:bg-[#141210]/95 backdrop-blur-md border-b border-stone-200/80 dark:border-stone-800/80 pt-safe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 md:h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => handleNavigateTab('home')}
            className="font-display text-2xl font-semibold tracking-tight text-[#1C1917] dark:text-[#F3EFE8] whitespace-nowrap shrink-0"
          >
            Folio
          </button>

          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'shelf') setShelfInitialSubTab('shelf');
                    handleNavigateTab(item.id);
                  }}
                  className={`py-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-[#1E3A5F] text-[#1C1917] dark:border-[#7BA3D1] dark:text-[#F3EFE8]'
                      : 'border-transparent text-[#6B655E] dark:text-[#A8A095] hover:text-[#1C1917] dark:hover:text-[#F3EFE8]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                setSearchDraft(searchQuery);
                setSearchModalOpen(true);
              }}
              aria-label="Search library"
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg border border-stone-300/90 dark:border-stone-700 text-xs sm:text-sm font-medium text-[#44403C] dark:text-[#D6D0C6] hover:bg-stone-100 dark:hover:bg-stone-800/70 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${mainBottomPadding}`}>
        {activeTab === 'home' && (
          <HomeView
            homeData={homeData}
            discoveryPool={discoveryPool}
            loading={homeLoading}
            error={homeError}
            lastSession={lastSession}
            continueReading={continueReading}
            continueListening={continueListening}
            progressByBookId={progressByBookId}
            offlineIds={offlineIds}
            shelf={shelf}
            progressList={progressList}
            listeningList={listeningList}
            history={history}
            highlights={highlights}
            goals={goals}
            activityDays={activityDays}
            reminderDueBanner={reminderDueBanner}
            onDismissReminderBanner={() => setReminderDueBanner(false)}
            onSelectBook={setSelectedBook}
            onQuickRead={(book, edition) => void handleStartReading(book, edition)}
            onQuickListen={(book, edition, mode) =>
              void handleStartListening(book, edition, mode)
            }
            onNavigateTab={(tab, genre, period, allKinds) =>
              handleNavigateTab(tab, genre, period, allKinds)
            }
            onOpenGoalsInsights={() => {
              setShelfInitialSubTab('insights');
              handleNavigateTab('shelf');
            }}
            onOpenSearch={() => {
              setSearchDraft('');
              setSearchModalOpen(true);
            }}
            onTriggerSync={() => void handleTriggerSync()}
            isSyncing={isSyncing}
          />
        )}

        {(activeTab === 'books' || activeTab === 'novels') && (
          <CatalogBrowseView
            mode={searchQuery || browseAllKinds ? 'all' : activeTab}
            selectedGenre={browseGenre}
            selectedPeriod={browsePeriod}
            searchQuery={searchQuery}
            genres={genres}
            progressByBookId={progressByBookId}
            offlineIds={offlineIds}
            onChangeGenre={setBrowseGenre}
            onChangePeriod={setBrowsePeriod}
            onChangeSearch={setSearchQuery}
            onSelectBook={setSelectedBook}
          />
        )}

        {activeTab === 'genres' && (
          <GenresDirectoryView
            genres={genres}
            onPickGenre={(slug, targetTab) => handleNavigateTab(targetTab, slug)}
          />
        )}

        {activeTab === 'shelf' && (
          <ShelfView
            initialSubTab={shelfInitialSubTab}
            shelf={shelf}
            offlineBooks={offlineBooks}
            downloadProgressMap={downloadProgressMap}
            history={history}
            bookmarks={bookmarks}
            highlights={highlights}
            genres={genres}
            progressByBookId={progressByBookId}
            listeningByBookId={listeningByBookId}
            preferences={preferences}
            goals={goals}
            activityDays={activityDays}
            syncStatus={syncStatus}
            isSyncing={isSyncing}
            onSelectBook={setSelectedBook}
            onOpenBookmark={(book, bm) => {
              const ed =
                book.editions.find((e) => e.editionId === bm.editionId) || book.editions[0];
              if (!ed) return;
              void handleStartReading(book, ed, {
                bookId: book.id,
                editionId: ed.editionId,
                chapterIndex: bm.chapterIndex,
                totalChapters: 1,
                scrollRatio: bm.scrollRatio,
                percentComplete: 0,
                lastReadAt: bm.createdAt,
                book,
              });
            }}
            onOpenHighlight={(book, hl) => {
              const ed =
                book.editions.find((e) => e.editionId === hl.editionId) || book.editions[0];
              if (!ed) return;
              void handleStartReading(book, ed, undefined, hl);
            }}
            onDeleteBookmark={(id) => void handleDeleteBookmark(id)}
            onSaveHighlight={(hl) => void handleSaveHighlight(hl)}
            onDeleteHighlight={(id) => void handleDeleteHighlight(id)}
            onRemoveOffline={handleRemoveOffline}
            onClearAllOffline={handleClearAllOffline}
            onUpdatePreferences={onUpdatePreferences}
            onUpdateGoals={onUpdateGoals}
            onRestoreBackup={handleRestoreBackup}
            onTriggerSync={() => void handleTriggerSync()}
          />
        )}
      </main>

      {/* Persistent Mini-Player while navigating */}
      {!readerState && <MiniPlayerBar />}

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#FBF9F5]/95 dark:bg-[#141210]/95 backdrop-blur-md border-t border-stone-200 dark:border-stone-800 pb-safe"
      >
        <div className="grid grid-cols-5 h-14 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'shelf') setShelfInitialSubTab('shelf');
                  handleNavigateTab(item.id);
                }}
                className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? 'text-[#1E3A5F] dark:text-[#7BA3D1]'
                    : 'text-[#6B655E] dark:text-[#A8A095]'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'stroke-[2.25]' : 'stroke-[1.75]'}`} />
                <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div
          className={`fixed ${
            activeBook ? 'bottom-28 md:bottom-20' : 'bottom-16 md:bottom-4'
          } left-4 z-40 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1C1917] text-[#FBF9F5] dark:bg-[#F3EFE8] dark:text-[#141210] text-xs font-medium shadow-lg`}
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline — Saved books, highlights, and notes remain accessible</span>
        </div>
      )}

      {/* Global Search Overlay */}
      {searchModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center pt-14 sm:pt-24 px-4"
          onClick={() => setSearchModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitGlobalSearch}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl bg-[#FBF9F5] dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 p-4 sm:p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Search Library</h2>
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                aria-label="Close search"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-stone-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="search"
                autoFocus
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Title, author (e.g. Austen, Tagore, Vivekananda), or genre..."
                className="flex-1 min-h-[44px] px-4 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] dark:focus:ring-[#7BA3D1]"
              />
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium shrink-0"
              >
                Find
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                'Psychology',
                'Entrepreneurship',
                'Artificial Intelligence',
                'Romance',
                'Tagore',
                'Pride and Prejudice',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setSearchQuery(suggestion);
                    setBrowseGenre('');
                    setBrowsePeriod('all');
                    setBrowseAllKinds(true);
                    setSearchModalOpen(false);
                    setActiveTab('books');
                  }}
                  className="min-h-[34px] px-3 py-1 rounded-md bg-[#F3EFE6] dark:bg-[#26221E] text-[#44403C] dark:text-[#D6D0C6] hover:text-[#1E3A5F]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </form>
        </div>
      )}

      {/* Book Detail View */}
      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          isSaved={shelf.some((s) => s.bookId === selectedBook.id)}
          shelfStatus={shelf.find((s) => s.bookId === selectedBook.id)?.shelfStatus}
          isFavourite={Boolean(shelf.find((s) => s.bookId === selectedBook.id)?.isFavourite)}
          isOfflineSaved={offlineIds.has(selectedBook.id)}
          offlineByteSize={offlineMap.get(selectedBook.id)?.byteSize}
          downloadProgress={downloadProgressMap[selectedBook.id] || null}
          highlightCount={highlights.filter((h) => h.bookId === selectedBook.id).length}
          progress={progressByBookId[selectedBook.id] || null}
          listeningProgress={listeningByBookId[selectedBook.id] || null}
          onClose={() => setSelectedBook(null)}
          onRead={(book, edition) => void handleStartReading(book, edition)}
          onListen={(book, edition, mode, ab) =>
            void handleStartListening(book, edition, mode, ab)
          }
          onToggleShelf={(b) => void handleToggleShelf(b)}
          onSetShelfStatus={(b, st) => void handleSetShelfStatus(b, st)}
          onToggleFavourite={(b) => void handleToggleFavourite(b)}
          onSaveOffline={handleSaveOffline}
          onRemoveOffline={handleRemoveOffline}
          onSelectGenre={(slug) => handleNavigateTab('books', slug)}
        />
      )}

      {/* Distraction-Free Reader */}
      {readerState && (
        <ReaderView
          book={readerState.book}
          edition={readerState.edition}
          initialProgress={
            readerState.overrideProgress !== undefined
              ? readerState.overrideProgress
              : progressByBookId[readerState.book.id] || null
          }
          initialHighlightJump={readerState.highlightJump || null}
          bookmarks={bookmarks.filter((b) => b.bookId === readerState.book.id)}
          highlights={highlights.filter((h) => h.bookId === readerState.book.id)}
          preferences={preferences}
          onUpdatePreferences={onUpdatePreferences}
          onSaveProgress={(prog) => void handleSaveProgress(prog)}
          onAddBookmark={(bm) => void handleAddBookmark(bm)}
          onDeleteBookmark={(id) => void handleDeleteBookmark(id)}
          onSaveHighlight={(hl) => void handleSaveHighlight(hl)}
          onDeleteHighlight={(id) => void handleDeleteHighlight(id)}
          onActiveReadingSeconds={handleActiveReadingSeconds}
          onSwitchToListen={(book, edition, chapIdx, ratio) => {
            const preferMode: AudioModeType =
              (book.audiobooks?.length ?? 0) > 0 ? 'audiobook' : 'tts';
            void handleStartListening(book, edition, preferMode, undefined, chapIdx, ratio);
          }}
          onClose={() => setReaderState(null)}
        />
      )}

      {/* Full Audio Player Modal */}
      <AudioPlayerModal
        onSwitchToReader={(book, edition, chapterIndex, scrollRatio) => {
          void handleStartReading(book, edition, {
            bookId: book.id,
            editionId: edition.editionId,
            chapterIndex,
            totalChapters: 1,
            scrollRatio,
            percentComplete: 0,
            lastReadAt: new Date().toISOString(),
            book,
          });
        }}
      />
    </div>
  );
};
