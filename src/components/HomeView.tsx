import React, {useMemo, useState} from 'react';
import {
  ArrowRight,
  BarChart2,
  BookOpen,
  Clock,
  Headphones,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AudioModeType,
  BookEdition,
  BookshelfEntry,
  CatalogBook,
  DailyActivityRecord,
  HighlightAnnotation,
  HomeCollectionsResponse,
  LastSessionActivity,
  ListeningProgress,
  MoodId,
  PublicationPeriodFilter,
  ReadingGoalsConfig,
  ReadingHistoryEntry,
  ReadingProgress,
  RecommendedBook,
} from '../types/library';
import {
  buildUserTasteProfile,
  filterBooksByMood,
  getDiscoverDifferentRecommendations,
  getPersonalizedRecommendations,
  getTimeOfDayGreeting,
  MOOD_DEFINITIONS,
  pickDailyBookRecommendation,
} from '../lib/recommendations';
import {getLocalDateKey} from '../lib/storage';
import {BookCard} from './BookCard';
import {BookCover} from './BookCover';

interface HomeViewProps {
  homeData: HomeCollectionsResponse | null;
  discoveryPool: CatalogBook[];
  loading: boolean;
  error: string | null;
  lastSession: LastSessionActivity | null;
  continueReading: ReadingProgress | null;
  continueListening: ListeningProgress | null;
  progressByBookId: Record<string, ReadingProgress>;
  offlineIds: Set<string>;
  shelf: BookshelfEntry[];
  progressList: ReadingProgress[];
  listeningList: ListeningProgress[];
  history: ReadingHistoryEntry[];
  highlights: HighlightAnnotation[];
  goals: ReadingGoalsConfig;
  activityDays: DailyActivityRecord[];
  reminderDueBanner: boolean;
  onDismissReminderBanner: () => void;
  onSelectBook: (book: CatalogBook) => void;
  onQuickRead: (book: CatalogBook, edition: BookEdition) => void;
  onQuickListen: (
    book: CatalogBook,
    edition: BookEdition | undefined,
    mode: AudioModeType,
  ) => void;
  onNavigateTab: (
    tab: 'books' | 'novels' | 'genres',
    genreSlug?: string,
    period?: PublicationPeriodFilter,
    allKinds?: boolean,
  ) => void;
  onOpenGoalsInsights: () => void;
  onOpenSearch: () => void;
  onTriggerSync: () => void;
  isSyncing: boolean;
}

const CURATED_COLLECTIONS = [
  {
    id: 'classics',
    title: 'World Classics & Literary Fiction',
    subtitle: 'Enduring novels from Austen, Dostoevsky, Tagore, and Shelley.',
    genre: 'classics',
    kind: 'novels' as const,
    image: '/src/assets/images/collection_world_classics_1795624568352.jpg',
  },
  {
    id: 'philosophy',
    title: 'Philosophy, Mind & Self-Mastery',
    subtitle: 'Modern psychology, Stoic meditations, Vedanta, and essays on conduct.',
    genre: 'philosophy',
    kind: 'books' as const,
    image: '/src/assets/images/collection_philosophy_essays_1795624568280.jpg',
  },
  {
    id: 'science-fiction',
    title: 'Contemporary & Speculative Worlds',
    subtitle:
      'Modern Sci-Fi & Fantasy from Baen, Clarkesworld, Lightspeed, and classic voyages.',
    genre: 'science-fiction',
    kind: 'novels' as const,
    image: '/src/assets/images/collection_speculative_tales_1795624567752.jpg',
  },
];

const ERA_BUTTONS: Array<{id: PublicationPeriodFilter; label: string}> = [
  {id: '2026', label: '2026'},
  {id: '2025', label: '2025'},
  {id: '2020-2024', label: '2020–2024'},
  {id: '2010-2019', label: '2010–2019'},
  {id: '2000-2009', label: '2000–2009'},
  {id: 'before-2000', label: 'Before 2000'},
  {id: 'future', label: 'Future'},
];

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Syncing...';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function computeGoalStreak(
  activityDays: DailyActivityRecord[],
  goals: ReadingGoalsConfig,
): number {
  if (!goals.streakEnabled) return 0;
  const byDate = new Map(activityDays.map((d) => [d.date, d]));
  const isMet = (rec?: DailyActivityRecord) => {
    if (!rec) return false;
    if (goals.goalType === 'books') {
      return rec.completedBookIds.length >= Math.max(1, goals.dailyBooksTarget);
    }
    const mins = Math.floor((rec.readingSeconds + rec.listeningSeconds) / 60);
    return mins >= Math.max(1, goals.dailyMinutesTarget);
  };

  let streak = 0;
  const d = new Date();
  // Count today if met; otherwise start checking from yesterday so streak doesn't break mid-day
  if (isMet(byDate.get(getLocalDateKey(d)))) {
    streak++;
  }
  d.setDate(d.getDate() - 1);
  while (isMet(byDate.get(getLocalDateKey(d)))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export const HomeView: React.FC<HomeViewProps> = ({
  homeData,
  discoveryPool,
  loading,
  error,
  lastSession,
  continueReading,
  continueListening,
  progressByBookId,
  offlineIds,
  shelf,
  progressList,
  listeningList,
  history,
  highlights,
  goals,
  activityDays,
  reminderDueBanner,
  onDismissReminderBanner,
  onSelectBook,
  onQuickRead,
  onQuickListen,
  onNavigateTab,
  onOpenGoalsInsights,
  onOpenSearch,
  onTriggerSync,
  isSyncing,
}) => {
  const [selectedMood, setSelectedMood] = useState<MoodId | null>(null);

  const timeContext = useMemo(() => getTimeOfDayGreeting(), []);
  const todayKey = getLocalDateKey();
  const todayActivity = useMemo(
    () => activityDays.find((d) => d.date === todayKey),
    [activityDays, todayKey],
  );

  const todayMinutes = Math.floor(
    ((todayActivity?.readingSeconds || 0) + (todayActivity?.listeningSeconds || 0)) / 60,
  );
  const todayBooksCount = todayActivity?.completedBookIds.length || 0;
  const goalProgressPct = useMemo(() => {
    if (goals.goalType === 'books') {
      return Math.min(100, Math.round((todayBooksCount / Math.max(1, goals.dailyBooksTarget)) * 100));
    }
    return Math.min(100, Math.round((todayMinutes / Math.max(1, goals.dailyMinutesTarget)) * 100));
  }, [goals.dailyBooksTarget, goals.dailyMinutesTarget, goals.goalType, todayBooksCount, todayMinutes]);

  const currentStreak = useMemo(() => computeGoalStreak(activityDays, goals), [activityDays, goals]);

  const fullCandidatePool = useMemo(() => {
    if (discoveryPool.length > 0) return discoveryPool;
    if (!homeData) return [];
    const merged = new Map<string, CatalogBook>();
    [
      ...homeData.recentReleases,
      ...homeData.contemporaryNovels,
      ...homeData.modernNonFiction,
      ...homeData.newlyAdded,
      ...(homeData.audiobooksHighlight || []),
      ...homeData.popularNovels,
      ...homeData.popularBooks,
      ...homeData.indianHeritageAndPhilosophy,
    ].forEach((b) => merged.set(b.id, b));
    return Array.from(merged.values());
  }, [discoveryPool, homeData]);

  const tasteProfile = useMemo(
    () =>
      buildUserTasteProfile({
        shelf,
        progressList,
        listeningList,
        history,
        highlights,
        preferredInterests: goals.preferredInterests,
      }),
    [goals.preferredInterests, highlights, history, listeningList, progressList, shelf],
  );

  const personalizedRecs = useMemo(
    () => getPersonalizedRecommendations(fullCandidatePool, tasteProfile, 12),
    [fullCandidatePool, tasteProfile],
  );

  const discoverDifferentRecs = useMemo(
    () => getDiscoverDifferentRecommendations(fullCandidatePool, tasteProfile, 6),
    [fullCandidatePool, tasteProfile],
  );

  const dailyRecommendation = useMemo(
    () => pickDailyBookRecommendation(fullCandidatePool, personalizedRecs, todayKey),
    [fullCandidatePool, personalizedRecs, todayKey],
  );

  const timeOfDayPicks = useMemo(() => {
    const matches = filterBooksByMood(fullCandidatePool, timeContext.preferredMood);
    return matches.filter((m) => m.book.id !== dailyRecommendation?.book.id).slice(0, 4);
  }, [dailyRecommendation?.book.id, fullCandidatePool, timeContext.preferredMood]);

  const activeMoodDef = useMemo(
    () => MOOD_DEFINITIONS.find((m) => m.id === selectedMood) || null,
    [selectedMood],
  );
  const activeMoodBooks = useMemo(
    () => (selectedMood ? filterBooksByMood(fullCandidatePool, selectedMood) : []),
    [fullCandidatePool, selectedMood],
  );

  const renderRecommendedRow = (
    title: string,
    subtitle: string,
    recs: RecommendedBook[],
    onAction?: {label: string; onClick: () => void},
  ) => {
    if (recs.length === 0) return null;
    return (
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b border-stone-200/80 dark:border-stone-800 pb-3">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] mt-0.5">
              {subtitle}
            </p>
          </div>
          {onAction && (
            <button
              type="button"
              onClick={onAction.onClick}
              className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs sm:text-sm font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline whitespace-nowrap shrink-0"
            >
              <span>{onAction.label}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5 overflow-x-auto sm:overflow-visible no-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
          {recs.slice(0, 6).map(({book, reason, estimatedMinutes}) => (
            <div key={book.id} className="w-[144px] sm:w-auto shrink-0 space-y-1.5">
              <BookCard
                book={book}
                onSelect={onSelectBook}
                progressPercent={progressByBookId[book.id]?.percentComplete}
                isOfflineSaved={offlineIds.has(book.id)}
              />
              <p className="text-[11px] leading-snug text-[#1E3A5F] dark:text-[#7BA3D1] line-clamp-2">
                {reason}
                {estimatedMinutes ? ` · Est. ${estimatedMinutes}m` : ''}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderShelfRow = (
    title: string,
    subtitle: string,
    books: CatalogBook[],
    onViewAll: () => void,
  ) => {
    if (books.length === 0) return null;
    return (
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b border-stone-200/80 dark:border-stone-800 pb-3">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] mt-0.5">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs sm:text-sm font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline whitespace-nowrap shrink-0"
          >
            <span>View all</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5 overflow-x-auto sm:overflow-visible no-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
          {books.slice(0, 6).map((book) => (
            <div key={book.id} className="w-[140px] sm:w-auto shrink-0">
              <BookCard
                book={book}
                onSelect={onSelectBook}
                progressPercent={progressByBookId[book.id]?.percentComplete}
                isOfflineSaved={offlineIds.has(book.id)}
              />
            </div>
          ))}
        </div>
      </section>
    );
  };

  const periodCounts = homeData?.syncStatus?.periodCounts;

  return (
    <div className="space-y-10 sm:space-y-12">
      {/* Gentle In-App Reading Reminder Banner (when scheduled time reached while app is active) */}
      {reminderDueBanner && (
        <div className="p-4 rounded-xl border border-[#1E3A5F]/25 dark:border-[#7BA3D1]/30 bg-[#F3EFE6] dark:bg-[#1D1A17] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-4 h-4 text-[#1E3A5F] dark:text-[#7BA3D1] shrink-0" />
            <p className="text-xs sm:text-sm text-[#1C1917] dark:text-[#F3EFE8]">
              Time for your reading session —{' '}
              {goals.goalType === 'time'
                ? `${Math.max(0, goals.dailyMinutesTarget - todayMinutes)} minutes left for today’s goal.`
                : `${todayBooksCount} of ${goals.dailyBooksTarget} completed today.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismissReminderBanner}
            aria-label="Dismiss reminder"
            className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-[#6B655E] dark:text-[#A8A095] hover:text-[#1C1917]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Editorial Hero + Personal Continuity & Daily Goal */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        <div className="lg:col-span-7 relative overflow-hidden rounded-2xl border border-stone-200/80 dark:border-stone-800 min-h-[260px] sm:min-h-[340px] flex items-end bg-[#1E3A5F]">
          <img
            src="/src/assets/images/hero_reading_atelier_1795624567025.jpg"
            alt="Open hardcover book on a wooden reading table beside morning tea"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/15"
          />
          <div className="relative z-10 p-6 sm:p-8 text-white max-w-xl space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-stone-200">
              {timeContext.greeting} · Personal Digital Library · ₹0
            </p>
            <h1 className="font-display text-2xl sm:text-4xl font-semibold leading-tight text-balance">
              Modern ideas, contemporary novels, and timeless books.
            </h1>
            <p className="text-sm text-stone-200/90 leading-relaxed max-w-md">
              Discover free books from 2000–2026+ and classics across 13 open-access, indie, and human-narrated sources.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenSearch}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg bg-[#FBF9F5] text-[#1C1917] text-sm font-medium hover:bg-stone-200 transition-colors"
              >
                <Search className="w-4 h-4" />
                <span>Search Catalogue</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('books', '', '2026', true)}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-lg border border-white/40 text-white text-sm font-medium hover:bg-white/10 transition-colors"
              >
                <span>2025–2026 Releases</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Active Reading/Listening Continuity + Compact Daily Habit Strip */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="flex-1 rounded-2xl bg-[#F3EFE6]/85 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 p-5 sm:p-6 flex flex-col justify-between">
            {(() => {
              const preferListen =
                (lastSession?.activeMode === 'listen' && continueListening) ||
                (!continueReading && continueListening);
              if (preferListen && continueListening) {
                const targetEd =
                  continueListening.book.editions.find(
                    (e) => e.editionId === continueListening.editionId,
                  ) || continueListening.book.editions[0];
                return (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095]">
                          Continue Listening ·{' '}
                          {continueListening.audioMode === 'audiobook' ? 'Human Audio' : 'Voice'}
                        </p>
                        <span className="text-xs font-medium tabular-nums text-[#9A3412] dark:text-[#E07A5F]">
                          {Math.round(continueListening.percentComplete)}% complete
                        </span>
                      </div>

                      <div className="flex gap-4 items-start">
                        <div className="w-20 sm:w-24 shrink-0">
                          <BookCover
                            title={continueListening.book.title}
                            author={continueListening.book.primaryAuthor}
                            coverUrl={continueListening.book.coverUrl}
                            size="sm"
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <h2 className="font-display text-lg sm:text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-snug line-clamp-2">
                            {continueListening.book.title}
                          </h2>
                          <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
                            {continueListening.book.primaryAuthor}
                          </p>
                          <p className="text-xs text-[#8A8279] dark:text-[#8E867B] tabular-nums">
                            {continueListening.audioMode === 'audiobook' ? 'Track' : 'Chapter'}{' '}
                            {continueListening.chapterIndex + 1} of{' '}
                            {Math.max(1, continueListening.totalChapters)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 space-y-3">
                      <div className="w-full h-1.5 rounded-full bg-stone-300/70 dark:bg-stone-800 overflow-hidden">
                        <div
                          className="h-full bg-[#9A3412] dark:bg-[#E07A5F]"
                          style={{
                            width: `${Math.min(100, Math.max(4, continueListening.percentComplete))}%`,
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onQuickListen(
                              continueListening.book,
                              targetEd,
                              continueListening.audioMode,
                            )
                          }
                          className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[#9A3412] text-white dark:bg-[#E07A5F] dark:text-[#141210] text-sm font-medium hover:opacity-95 transition-opacity"
                        >
                          {continueListening.audioMode === 'audiobook' ? (
                            <Headphones className="w-4 h-4" />
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                          <span>Resume Listening</span>
                        </button>
                        {targetEd && targetEd.provider !== 'librivox' && (
                          <button
                            type="button"
                            onClick={() => onQuickRead(continueListening.book, targetEd)}
                            className="min-h-[44px] px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]"
                          >
                            Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectBook(continueListening.book)}
                          className="min-h-[44px] px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </>
                );
              }
              return null;
            })() ||
              (continueReading ? (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095]">
                        Continue Reading
                      </p>
                      <span className="text-xs font-medium tabular-nums text-[#1E3A5F] dark:text-[#7BA3D1]">
                        {Math.round(continueReading.percentComplete)}% complete
                      </span>
                    </div>

                    <div className="flex gap-4 items-start">
                      <div className="w-20 sm:w-24 shrink-0">
                        <BookCover
                          title={continueReading.book.title}
                          author={continueReading.book.primaryAuthor}
                          coverUrl={continueReading.book.coverUrl}
                          size="sm"
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h2 className="font-display text-lg sm:text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-snug line-clamp-2">
                          {continueReading.book.title}
                        </h2>
                        <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
                          {continueReading.book.primaryAuthor}
                        </p>
                        <p className="text-xs text-[#8A8279] dark:text-[#8E867B] tabular-nums">
                          Chapter {continueReading.chapterIndex + 1} of{' '}
                          {continueReading.totalChapters}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 space-y-3">
                    <div className="w-full h-1.5 rounded-full bg-stone-300/70 dark:bg-stone-800 overflow-hidden">
                      <div
                        className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1]"
                        style={{
                          width: `${Math.min(100, Math.max(4, continueReading.percentComplete))}%`,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const ed =
                            continueReading.book.editions.find(
                              (e) => e.editionId === continueReading.editionId,
                            ) || continueReading.book.editions[0];
                          if (ed) onQuickRead(continueReading.book, ed);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium hover:opacity-95 transition-opacity"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>Resume Reading</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ed =
                            continueReading.book.editions.find(
                              (e) => e.editionId === continueReading.editionId,
                            ) || continueReading.book.editions[0];
                          const preferMode: AudioModeType =
                            (continueReading.book.audiobooks?.length ?? 0) > 0 ? 'audiobook' : 'tts';
                          onQuickListen(continueReading.book, ed, preferMode);
                        }}
                        aria-label="Listen to this book"
                        className="min-h-[44px] px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] inline-flex items-center gap-1.5"
                      >
                        <Headphones className="w-4 h-4" />
                        <span>Listen</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectBook(continueReading.book)}
                        className="min-h-[44px] px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                </>
              ) : null)}

            {!continueReading && !continueListening && homeData?.featuredPick ? (
              <>
                <div className="space-y-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095]">
                    Featured Selection
                    {homeData.featuredPick.publicationYear
                      ? ` · ${homeData.featuredPick.publicationYear}`
                      : ''}
                  </p>
                  <div className="flex gap-4 items-start">
                    <div className="w-20 sm:w-24 shrink-0">
                      <BookCover
                        title={homeData.featuredPick.title}
                        author={homeData.featuredPick.primaryAuthor}
                        coverUrl={homeData.featuredPick.coverUrl}
                        size="sm"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <h2 className="font-display text-lg sm:text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-snug line-clamp-2">
                        {homeData.featuredPick.title}
                      </h2>
                      <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
                        {homeData.featuredPick.primaryAuthor}
                      </p>
                      <p className="text-xs text-[#8A8279] dark:text-[#8E867B]">
                        {homeData.featuredPick.editions[0]?.providerLabel} ·{' '}
                        {homeData.featuredPick.editions[0]?.licenseLabel}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="pt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const ed = homeData.featuredPick!.editions[0];
                      if (ed) onQuickRead(homeData.featuredPick!, ed);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Start Reading</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectBook(homeData.featuredPick!)}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]"
                  >
                    Details
                  </button>
                </div>
              </>
            ) : !continueReading && !continueListening ? (
              <div className="my-auto space-y-3 py-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095]">
                  Digital Reading Room
                </p>
                <p className="font-display text-xl text-[#1C1917] dark:text-[#F3EFE8]">
                  {loading
                    ? 'Synchronizing open-access catalogues...'
                    : 'Select any mood, genre, or book to begin.'}
                </p>
              </div>
            ) : null}
          </div>

          {/* Today's Reading Goal Compact Card */}
          <button
            type="button"
            onClick={onOpenGoalsInsights}
            className="text-left rounded-2xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 hover:border-[#1E3A5F]/50 dark:hover:border-[#7BA3D1]/50 p-4 transition-colors space-y-2"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#1C1917] dark:text-[#F3EFE8]">
                <BarChart2 className="w-3.5 h-3.5 text-[#1E3A5F] dark:text-[#7BA3D1]" />
                <span>Today’s Reading Goal</span>
              </span>
              <span className="tabular-nums text-[#6B655E] dark:text-[#A8A095]">
                {goals.goalType === 'books'
                  ? `${todayBooksCount} / ${goals.dailyBooksTarget} book${goals.dailyBooksTarget > 1 ? 's' : ''}`
                  : `${todayMinutes} / ${goals.dailyMinutesTarget} min`}
                {goals.streakEnabled && currentStreak > 0 ? ` · ${currentStreak}d streak` : ''}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1] transition-all duration-300"
                style={{width: `${Math.max(goalProgressPct > 0 ? 4 : 0, goalProgressPct)}%`}}
              />
            </div>
          </button>
        </div>
      </section>

      {/* Personalized Daily & Time-of-Day Selections */}
      {(dailyRecommendation || timeOfDayPicks.length > 0) && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {dailyRecommendation && (
            <div className="lg:col-span-6 p-5 rounded-2xl bg-white/80 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 flex gap-4 items-start">
              <div className="w-20 sm:w-24 shrink-0">
                <BookCover
                  title={dailyRecommendation.book.title}
                  author={dailyRecommendation.book.primaryAuthor}
                  coverUrl={dailyRecommendation.book.coverUrl}
                  size="sm"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#9A3412] dark:text-[#E07A5F] font-medium">
                  Daily Recommendation · {dailyRecommendation.reason}
                </p>
                <h2 className="font-display text-lg sm:text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-snug line-clamp-2">
                  {dailyRecommendation.book.title}
                </h2>
                <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095]">
                  {dailyRecommendation.book.primaryAuthor}
                  {dailyRecommendation.estimatedMinutes
                    ? ` · Est. ${dailyRecommendation.estimatedMinutes} min`
                    : ''}
                </p>
                <div className="pt-2 flex items-center gap-2">
                  {dailyRecommendation.book.editions[0] &&
                    dailyRecommendation.book.editions[0].provider !== 'librivox' && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickRead(
                            dailyRecommendation.book,
                            dailyRecommendation.book.editions[0],
                          )
                        }
                        className="min-h-[38px] px-3.5 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium"
                      >
                        Read Today’s Pick
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => onSelectBook(dailyRecommendation.book)}
                    className="min-h-[38px] px-3 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium"
                  >
                    Details
                  </button>
                </div>
              </div>
            </div>
          )}

          {timeOfDayPicks[0] && (
            <div className="lg:col-span-6 p-5 rounded-2xl bg-[#F3EFE6]/70 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 flex gap-4 items-start">
              <div className="w-20 sm:w-24 shrink-0">
                <BookCover
                  title={timeOfDayPicks[0].book.title}
                  author={timeOfDayPicks[0].book.primaryAuthor}
                  coverUrl={timeOfDayPicks[0].book.coverUrl}
                  size="sm"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">
                  {timeContext.selectionHeading}
                </p>
                <h2 className="font-display text-lg sm:text-xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-snug line-clamp-2">
                  {timeOfDayPicks[0].book.title}
                </h2>
                <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095]">
                  {timeOfDayPicks[0].book.primaryAuthor}
                  {timeOfDayPicks[0].estimatedMinutes
                    ? ` · Est. ${timeOfDayPicks[0].estimatedMinutes} min`
                    : ''}
                </p>
                <div className="pt-2 flex items-center gap-2">
                  {timeOfDayPicks[0].book.editions[0] &&
                    timeOfDayPicks[0].book.editions[0].provider !== 'librivox' && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickRead(
                            timeOfDayPicks[0].book,
                            timeOfDayPicks[0].book.editions[0],
                          )
                        }
                        className="min-h-[38px] px-3.5 rounded-lg bg-[#1C1917] text-white dark:bg-[#F3EFE8] dark:text-[#141210] text-xs font-medium"
                      >
                        Open Read
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => onSelectBook(timeOfDayPicks[0].book)}
                    className="min-h-[38px] px-3 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium"
                  >
                    Details
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Mood-Based Discovery Strip */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
            Discover by Mood
          </h2>
          <span className="text-xs text-[#6B655E] dark:text-[#A8A095]">
            Pick how you want to feel right now
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {MOOD_DEFINITIONS.map((mood) => {
            const active = selectedMood === mood.id;
            return (
              <button
                key={mood.id}
                type="button"
                onClick={() => setSelectedMood(active ? null : mood.id)}
                className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                  active
                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                    : 'bg-white/80 dark:bg-[#1D1A17] border-stone-200/90 dark:border-stone-800 text-[#1C1917] dark:text-[#F3EFE8] hover:border-[#1E3A5F] dark:hover:border-[#7BA3D1]'
                }`}
              >
                {mood.label}
              </button>
            );
          })}
        </div>

        {activeMoodDef && (
          <div className="p-4 sm:p-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/55 dark:bg-[#1D1A17] space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
                  {activeMoodDef.label}
                </h3>
                <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                  {activeMoodDef.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMood(null)}
                aria-label="Close mood results"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeMoodBooks.length === 0 ? (
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                No matches cached yet — try another mood or refresh catalogue sync.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                {activeMoodBooks.slice(0, 6).map(({book, estimatedMinutes}) => (
                  <div key={book.id} className="space-y-1">
                    <BookCard
                      book={book}
                      onSelect={onSelectBook}
                      progressPercent={progressByBookId[book.id]?.percentComplete}
                      isOfflineSaved={offlineIds.has(book.id)}
                    />
                    {estimatedMinutes && (
                      <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095] tabular-nums">
                        Est. ~{estimatedMinutes} min
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Personalized Recommendations Row */}
      {renderRecommendedRow(
        tasteProfile.hasHistory ? 'Recommended For You' : 'Thoughtful Starting Picks',
        tasteProfile.hasHistory
          ? 'Adapted from your bookshelf, reading history, and selected interests — all ₹0 open access'
          : 'Curated across modern non-fiction, speculative fiction, classics, and human-narrated audio',
        personalizedRecs,
        {label: 'Adjust Interests', onClick: onOpenGoalsInsights},
      )}

      {/* Publication Era Quick-Jump Strip */}
      {periodCounts && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095] font-medium">
              Explore by Original Publication Era
            </h2>
            <button
              type="button"
              onClick={() => onNavigateTab('genres')}
              className="text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline"
            >
              All 22 Genres
            </button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
            {ERA_BUTTONS.map((era) => {
              const count = periodCounts[era.id] ?? 0;
              return (
                <button
                  key={era.id}
                  type="button"
                  onClick={() => onNavigateTab('books', '', era.id, true)}
                  className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white/80 dark:bg-[#1D1A17] border border-stone-200/90 dark:border-stone-800 hover:border-[#1E3A5F] dark:hover:border-[#7BA3D1] text-xs font-medium text-[#1C1917] dark:text-[#F3EFE8] whitespace-nowrap shrink-0 transition-colors tabular-nums"
                >
                  <span>{era.label}</span>
                  <span className="ml-1.5 text-[#8A8279] dark:text-[#8E867B]">({count})</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {error && !homeData && (
        <div className="p-5 rounded-xl border border-stone-300 dark:border-stone-800 bg-[#F3EFE6]/60 dark:bg-[#1D1A17] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]">
              Could not reach live catalogue providers
            </p>
            <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-1">
              {error}. Offline saved books in your Shelf remain available anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onTriggerSync}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-xs font-medium shrink-0"
          >
            Retry Sync
          </button>
        </div>
      )}

      {/* Loading skeleton when warming up */}
      {loading && !homeData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {Array.from({length: 6}).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[2/3] rounded-md bg-stone-200 dark:bg-stone-800 animate-pulse" />
              <div className="h-4 w-4/5 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Contemporary & Recent Discovery Shelves */}
      {homeData && (
        <>
          {renderShelfRow(
            'Recent Releases (2024–2026+)',
            'Contemporary open-access monographs, textbooks, and speculative stories originally published in 2024–2026',
            homeData.recentReleases,
            () => onNavigateTab('books', '', '2025', true),
          )}

          {renderShelfRow(
            'Contemporary Novels (2000–2026)',
            'Legally free modern novels & short fiction from Baen Free Library, Clarkesworld, Lightspeed, Uncanny, and Obooko',
            homeData.contemporaryNovels,
            () => onNavigateTab('novels', '', '2020-2024', false),
          )}

          {renderShelfRow(
            'Modern Non-Fiction & Open Books (2000–2026)',
            'Contemporary psychology, business, entrepreneurship, technology, and science via OpenStax, Open UMN, OpenAlex, and DOAB',
            homeData.modernNonFiction,
            () => onNavigateTab('books', '', '2020-2024', false),
          )}

          {renderRecommendedRow(
            'Discover Something Different',
            'Step outside your usual reading genres with serendipitous free editions',
            discoverDifferentRecs,
            {label: 'Browse Genres', onClick: () => onNavigateTab('genres')},
          )}

          {renderShelfRow(
            'Newly Available Free Editions',
            'Freshly added contemporary releases alongside newly digitized public-domain editions',
            homeData.newlyAdded,
            () => onNavigateTab('books', '', 'all', true),
          )}

          {renderShelfRow(
            'Human-Narrated Audiobooks (LibriVox)',
            'Complete public-domain audiobooks read aloud by LibriVox volunteers',
            homeData.audiobooksHighlight || [],
            () => onNavigateTab('novels', 'classics', 'before-2000', true),
          )}
        </>
      )}

      {/* Curated Literary Collections */}
      <section className="space-y-4">
        <div className="border-b border-stone-200/80 dark:border-stone-800 pb-3">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
            Curated Reading Rooms
          </h2>
          <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] mt-0.5">
            Thematic rooms spanning modern speculative presses, open-access scholarship, and world classics.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {CURATED_COLLECTIONS.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => onNavigateTab(col.kind, col.genre)}
              className="group text-left rounded-xl overflow-hidden border border-stone-200/80 dark:border-stone-800 bg-white/70 dark:bg-[#1D1A17] hover:border-[#1E3A5F]/50 dark:hover:border-[#7BA3D1]/50 transition-colors"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-stone-200 dark:bg-stone-800">
                <img
                  src={col.image}
                  alt={col.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div className="p-4 sm:p-5 space-y-1.5">
                <h3 className="font-display text-lg font-semibold text-[#1C1917] dark:text-[#F3EFE8] group-hover:text-[#1E3A5F] dark:group-hover:text-[#7BA3D1] transition-colors">
                  {col.title}
                </h3>
                <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] leading-relaxed">
                  {col.subtitle}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Enduring Classics & Heritage Shelves */}
      {homeData && (
        <>
          {renderShelfRow(
            'Popular Novels & Classics',
            'Most-read fiction across classic and contemporary free libraries',
            homeData.popularNovels,
            () => onNavigateTab('novels'),
          )}

          {renderShelfRow(
            'Popular Books & Non-Fiction',
            'Philosophy, history, science, business, and personal inquiry',
            homeData.popularBooks,
            () => onNavigateTab('books'),
          )}

          {renderShelfRow(
            'Indian Heritage & Philosophy',
            'Public-domain poetry, essays, and philosophical works via Wikisource & archives',
            homeData.indianHeritageAndPhilosophy,
            () => onNavigateTab('books', 'philosophy'),
          )}
        </>
      )}

      {/* Transparent Synchronization Bar */}
      {homeData?.syncStatus && (
        <section className="pt-4 border-t border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#6B655E] dark:text-[#A8A095]">
          <div className="space-y-1">
            <p className="font-medium text-[#1C1917] dark:text-[#F3EFE8] inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#1E3A5F] dark:text-[#7BA3D1]" />
              <span>
                Unified Multi-Source Sync · {homeData.syncStatus.totalCatalogBooks} titles across{' '}
                {homeData.syncStatus.providers.filter((p) => p.itemCount > 0).length} active providers
              </span>
            </p>
            <p>
              Last synchronized {formatSyncTime(homeData.syncStatus.lastSyncAt)} ·{' '}
              {homeData.syncStatus.syncMode === 'refresh-on-open'
                ? 'Refreshed on open'
                : 'Daily automated background schedule'}
            </p>
          </div>
          <button
            type="button"
            disabled={isSyncing}
            onClick={onTriggerSync}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing Providers...' : 'Sync Now'}</span>
          </button>
        </section>
      )}
    </div>
  );
};
