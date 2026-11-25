export type BookKind = 'novel' | 'book';

export type ProviderId =
  | 'openstax'
  | 'open-umn'
  | 'openalex'
  | 'doab'
  | 'baen'
  | 'speculative-press'
  | 'obooko'
  | 'wikibooks'
  | 'standard-ebooks'
  | 'gutendex'
  | 'wikisource'
  | 'open-library'
  | 'librivox';

export type CopyrightStatus =
  | 'open-license-cc'
  | 'publisher-free-edition'
  | 'author-free-edition'
  | 'public-domain-india-and-global'
  | 'public-domain-us-verify-india';

export type FreeAccessType =
  | 'open-access-cc'
  | 'publisher-free-library'
  | 'author-free-edition'
  | 'public-domain';

export type PublicationPeriodFilter =
  | 'all'
  | 'future'
  | '2026'
  | '2025'
  | '2020-2024'
  | '2010-2019'
  | '2000-2009'
  | 'before-2000';

export interface GenreDefinition {
  slug: string;
  name: string;
  kindAffinity: BookKind | 'both';
  description: string;
}

export interface BookAuthor {
  name: string;
  birthYear: number | null;
  deathYear: number | null;
}

export interface BookEdition {
  editionId: string;
  provider: ProviderId;
  providerLabel: string;
  sourceBookId: string;
  sourceUrl: string;
  readHtmlUrl?: string;
  readEpubUrl?: string;
  readTextUrl?: string;
  externalReadUrl: string;
  formatLabel: string;
  language: string;
  licenseLabel: string;
}

export interface AudiobookTrack {
  index: number;
  sectionNumber: string;
  title: string;
  audioUrl: string;
  durationSeconds: number;
  narrators: string[];
}

export interface AudiobookEdition {
  audiobookId: string;
  provider: 'librivox';
  providerLabel: string;
  narratorType: 'human';
  narrators: string[];
  language: string;
  totalTime: string;
  totalTimeSecs: number;
  numSections: number;
  sourceUrl: string;
  rssUrl: string;
  tracks?: AudiobookTrack[];
}

export interface CatalogBook {
  id: string;
  normalizedKey: string;
  title: string;
  subtitle?: string;
  authors: BookAuthor[];
  primaryAuthor: string;
  kind: BookKind;
  genres: string[];
  subjects: string[];
  languages: string[];
  coverUrl: string | null;
  rawCoverUrl: string | null;
  downloadCount: number | null;
  publicationYear: number | null;
  digitalReleaseYear: number | null;
  copyrightStatus: CopyrightStatus;
  freeAccessType: FreeAccessType;
  copyrightNote: string;
  summary: string | null;
  isNewArrival: boolean;
  addedAt: string;
  updatedAt: string;
  editions: BookEdition[];
  audiobooks?: AudiobookEdition[];
}

export interface ProviderSyncState {
  provider: ProviderId;
  name: string;
  status: 'ok' | 'degraded' | 'unavailable';
  itemCount: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

export type PublicationPeriodCounts = Record<PublicationPeriodFilter, number>;

export interface SyncStatus {
  lastSyncAt: string | null;
  nextScheduledSyncAt: string | null;
  isSyncing: boolean;
  syncMode: 'background-scheduled' | 'refresh-on-open' | 'manual' | 'initial';
  totalCatalogBooks: number;
  newlyAddedCount: number;
  updatedCount: number;
  staleAfterHours: number;
  isStale: boolean;
  periodCounts: PublicationPeriodCounts;
  providers: ProviderSyncState[];
}

export interface ReaderChapter {
  index: number;
  title: string;
  html: string;
  wordCount: number;
}

export interface ReaderContentResponse {
  bookId: string;
  editionId: string;
  title: string;
  author: string;
  provider: ProviderId;
  providerLabel: string;
  sourceUrl: string;
  externalReadUrl: string;
  readableInApp: boolean;
  unavailableReason?: string;
  chapters: ReaderChapter[];
  totalWords: number;
}

export interface HomeCollectionsResponse {
  featuredPick: CatalogBook | null;
  recentReleases: CatalogBook[];
  contemporaryNovels: CatalogBook[];
  modernNonFiction: CatalogBook[];
  newlyAdded: CatalogBook[];
  audiobooksHighlight: CatalogBook[];
  popularNovels: CatalogBook[];
  popularBooks: CatalogBook[];
  indianHeritageAndPhilosophy: CatalogBook[];
  syncStatus: SyncStatus;
}

export interface CatalogQueryResponse {
  items: CatalogBook[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  periodCounts: PublicationPeriodCounts;
  syncStatus: SyncStatus;
}

export interface BookshelfEntry {
  bookId: string;
  book: CatalogBook;
  addedAt: string;
  isFavourite: boolean;
  shelfStatus: 'saved' | 'reading' | 'finished';
}

export interface ReadingProgress {
  bookId: string;
  editionId: string;
  chapterIndex: number;
  totalChapters: number;
  scrollRatio: number;
  percentComplete: number;
  lastReadAt: string;
  book: CatalogBook;
}

export type AudioModeType = 'audiobook' | 'tts';

export interface ListeningProgress {
  bookId: string;
  audioMode: AudioModeType;
  audiobookId?: string;
  editionId?: string;
  chapterIndex: number;
  totalChapters: number;
  positionSeconds: number;
  durationSeconds: number;
  ttsSegmentIndex: number;
  ttsTotalSegments: number;
  percentComplete: number;
  lastListenedAt: string;
  book: CatalogBook;
}

export interface LastSessionActivity {
  bookId: string;
  activeMode: 'read' | 'listen';
  updatedAt: string;
  book: CatalogBook;
}

export interface BookmarkItem {
  id: string;
  bookId: string;
  editionId: string;
  chapterIndex: number;
  chapterTitle: string;
  scrollRatio: number;
  excerpt: string;
  note?: string;
  createdAt: string;
}

export interface ReadingHistoryEntry {
  bookId: string;
  book: CatalogBook;
  lastOpenedAt: string;
}

export interface OfflineSavedBook {
  bookId: string;
  editionId: string;
  book: CatalogBook;
  chapters: ReaderChapter[];
  totalWords: number;
  savedAt: string;
  byteSize: number;
}

export type AppAppearanceTheme = 'light' | 'dark' | 'system';
export type ReaderPageTheme = 'light' | 'sepia' | 'dark';
export type ReaderFontFamily = 'serif' | 'source-serif' | 'sans' | 'georgia';
export type ReaderLayoutMode = 'scroll' | 'paginated';
export type ReaderTextAlign = 'left' | 'justify';
export type ReaderPresetId = 'classic' | 'focus' | 'night' | 'comfortable' | 'custom';

export interface ReaderPreferences {
  appTheme: AppAppearanceTheme;
  readerTheme: ReaderPageTheme;
  preset: ReaderPresetId;
  fontFamily: ReaderFontFamily;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  marginWidth: 'compact' | 'balanced' | 'generous';
  textAlign: ReaderTextAlign;
  layoutMode: ReaderLayoutMode;
  showProgress: boolean;
  focusHideChrome: boolean;
  playbackRate: number;
  preferredVoiceURI: string | null;
}

export type HighlightColor = 'amber' | 'sage' | 'sky' | 'rose';

export interface HighlightAnnotation {
  id: string;
  bookId: string;
  editionId: string;
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  scrollRatio: number;
  color: HighlightColor;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryDefinition {
  definition: string;
  example?: string;
  synonyms?: string[];
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  audioUrl?: string;
  meanings: DictionaryMeaning[];
  sourceLabel: string;
  sourceUrl: string;
}

export type MoodId =
  | 'relaxing'
  | 'inspiring'
  | 'mysterious'
  | 'romantic'
  | 'adventurous'
  | 'thought-provoking'
  | 'educational'
  | 'quick-read';

export interface RecommendedBook {
  book: CatalogBook;
  reason: string;
  estimatedMinutes?: number;
}

export interface DailyActivityRecord {
  date: string; // YYYY-MM-DD in user's local timezone
  readingSeconds: number;
  listeningSeconds: number;
  sessionsCount: number;
  completedBookIds: string[];
}

export interface ReadingGoalsConfig {
  goalType: 'time' | 'books';
  dailyMinutesTarget: number;
  dailyBooksTarget: number;
  streakEnabled: boolean;
  preferredInterests: string[];
  reminderEnabled: boolean;
  reminderTime: string; // HH:MM 24h
  reminderFrequency: 'daily' | 'weekdays' | 'weekends';
  lastReminderDate: string | null;
}

export interface OfflineDownloadProgress {
  bookId: string;
  status: 'downloading' | 'error';
  percent: number;
  stageLabel: string;
  error?: string;
}

export interface FolioBackupPayload {
  schemaVersion: 1;
  exportedAt: string;
  appName: 'Folio';
  data: {
    bookshelf: BookshelfEntry[];
    readingProgress: ReadingProgress[];
    listeningProgress: ListeningProgress[];
    lastSession: LastSessionActivity | null;
    bookmarks: BookmarkItem[];
    highlights: HighlightAnnotation[];
    history: ReadingHistoryEntry[];
    preferences: ReaderPreferences;
    readingGoals: ReadingGoalsConfig;
    activityDays: DailyActivityRecord[];
  };
}

