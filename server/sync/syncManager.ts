import type {
  BookKind,
  CatalogBook,
  CatalogQueryResponse,
  HomeCollectionsResponse,
  ProviderId,
  ProviderSyncState,
  PublicationPeriodFilter,
  SyncStatus,
} from '../../src/types/library.ts';
import {GENRES, getProviderSearchTermsForGenre} from '../catalog/genres.ts';
import {
  computePeriodCounts,
  matchesPublicationPeriod,
  mergeCatalogBooks,
} from '../catalog/dedupe.ts';
import {fetchBaenFreeLibrary} from '../providers/baen.ts';
import {fetchDoabOaiBooks} from '../providers/doab.ts';
import {fetchGutendexBooks} from '../providers/gutendex.ts';
import {
  fetchLibriVoxCatalog,
  findLibriVoxMatchForBook,
  searchLibriVoxBooks,
} from '../providers/librivox.ts';
import {fetchObookoContemporaryBooks} from '../providers/obooko.ts';
import {fetchOpenAlexContemporaryBooks} from '../providers/openAlex.ts';
import {fetchOpenLibraryPublicDomain} from '../providers/openLibrary.ts';
import {fetchOpenStaxBooks} from '../providers/openStax.ts';
import {fetchOpenUmnBooks} from '../providers/openUmn.ts';
import {fetchSpeculativePressFiction} from '../providers/speculativePress.ts';
import {fetchStandardEbooksCatalog, fetchStandardEbooksNewReleases} from '../providers/standardEbooks.ts';
import {fetchWikibooksCatalog, searchWikibooks} from '../providers/wikibooks.ts';
import {fetchWikisourceSeeds, searchWikisource} from '../providers/wikisource.ts';

const STALE_AFTER_HOURS = 24;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 30 * 1000;

const VALID_PERIODS = new Set<PublicationPeriodFilter>([
  'all',
  'future',
  '2026',
  '2025',
  '2020-2024',
  '2010-2019',
  '2000-2009',
  'before-2000',
]);

function normalizePeriodFilter(raw?: string): PublicationPeriodFilter {
  if (raw && VALID_PERIODS.has(raw as PublicationPeriodFilter)) {
    return raw as PublicationPeriodFilter;
  }
  return 'all';
}

function periodToOpenAlexRange(period: PublicationPeriodFilter): string | null {
  switch (period) {
    case 'future':
      return '2027-2030';
    case '2026':
      return '2026';
    case '2025':
      return '2025';
    case '2020-2024':
      return '2020-2024';
    case '2010-2019':
      return '2010-2019';
    case '2000-2009':
      return '2000-2009';
    default:
      return null;
  }
}

function getEditorialPopularityScore(book: CatalogBook): number {
  if (typeof book.downloadCount === 'number' && book.downloadCount > 0) {
    return book.downloadCount;
  }
  const prov = book.editions[0]?.provider;
  let base = 800;
  if (prov === 'openstax' || prov === 'baen' || prov === 'speculative-press') base = 4200;
  else if (prov === 'open-umn' || prov === 'standard-ebooks') base = 2800;
  else if (prov === 'doab' || prov === 'wikibooks') base = 1800;
  else if (prov === 'obooko') base = 1400;

  if (typeof book.publicationYear === 'number' && book.publicationYear >= 2020) {
    base += 1200;
  }
  if (book.coverUrl) {
    base += 500;
  }
  return base;
}

function createInitialProviderStates(): Record<ProviderId, ProviderSyncState> {
  return {
    openstax: {
      provider: 'openstax',
      name: 'OpenStax (Rice University · CC BY)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    'open-umn': {
      provider: 'open-umn',
      name: 'Open Textbook Library (UMN · CC)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    openalex: {
      provider: 'openalex',
      name: 'OpenAlex Open Access Books',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    doab: {
      provider: 'doab',
      name: 'DOAB (Peer-Reviewed Open Books)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    baen: {
      provider: 'baen',
      name: 'Baen Free Library',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    'speculative-press': {
      provider: 'speculative-press',
      name: 'Clarkesworld, Lightspeed & Uncanny',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    obooko: {
      provider: 'obooko',
      name: 'Obooko (Free Indie Authors)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    wikibooks: {
      provider: 'wikibooks',
      name: 'Wikibooks (CC BY-SA)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    'standard-ebooks': {
      provider: 'standard-ebooks',
      name: 'Standard Ebooks',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    gutendex: {
      provider: 'gutendex',
      name: 'Gutendex (Project Gutenberg)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    wikisource: {
      provider: 'wikisource',
      name: 'Wikisource',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    'open-library': {
      provider: 'open-library',
      name: 'Open Library (Public Scans)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
    librivox: {
      provider: 'librivox',
      name: 'LibriVox (Human-Narrated Audiobooks)',
      status: 'ok',
      itemCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    },
  };
}

class CatalogSyncManager {
  private catalogByKey = new Map<string, CatalogBook>();
  private keyByBookId = new Map<string, string>();
  private lastSyncAt: string | null = null;
  private nextScheduledSyncAt: string | null = null;
  private isSyncing = false;
  private syncPromise: Promise<void> | null = null;
  private syncMode: SyncStatus['syncMode'] = 'initial';
  private newlyAddedCount = 0;
  private updatedCount = 0;
  private lastManualSyncMs = 0;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private providerStates: Record<ProviderId, ProviderSyncState> = createInitialProviderStates();

  start(): void {
    void this.runSync('initial');

    if (!this.scheduledTimer) {
      this.scheduledTimer = setInterval(() => {
        void this.runSync('background-scheduled');
      }, DAILY_INTERVAL_MS);
      this.scheduledTimer.unref();
      this.nextScheduledSyncAt = new Date(Date.now() + DAILY_INTERVAL_MS).toISOString();
    }
  }

  private ingestBooks(books: CatalogBook[]): {added: number; updated: number} {
    let added = 0;
    let updated = 0;
    for (const incoming of books) {
      const existing = this.catalogByKey.get(incoming.normalizedKey);
      if (!existing) {
        this.catalogByKey.set(incoming.normalizedKey, incoming);
        this.keyByBookId.set(incoming.id, incoming.normalizedKey);
        added++;
      } else {
        const prevEditions = existing.editions.length;
        const merged = mergeCatalogBooks(existing, incoming);
        this.catalogByKey.set(incoming.normalizedKey, merged);
        this.keyByBookId.set(existing.id, incoming.normalizedKey);
        this.keyByBookId.set(incoming.id, incoming.normalizedKey);
        if (merged.editions.length > prevEditions || incoming.isNewArrival) {
          updated++;
        }
      }
    }
    this.recountProviders();
    return {added, updated};
  }

  private recountProviders(): void {
    const counts: Record<ProviderId, number> = {
      openstax: 0,
      'open-umn': 0,
      openalex: 0,
      doab: 0,
      baen: 0,
      'speculative-press': 0,
      obooko: 0,
      wikibooks: 0,
      'standard-ebooks': 0,
      gutendex: 0,
      wikisource: 0,
      'open-library': 0,
      librivox: 0,
    };
    for (const book of this.catalogByKey.values()) {
      const seen = new Set<ProviderId>();
      for (const ed of book.editions) {
        if (!seen.has(ed.provider)) {
          counts[ed.provider] = (counts[ed.provider] || 0) + 1;
          seen.add(ed.provider);
        }
      }
      for (const ab of book.audiobooks || []) {
        if (!seen.has(ab.provider)) {
          counts[ab.provider] = (counts[ab.provider] || 0) + 1;
          seen.add(ab.provider);
        }
      }
    }
    (Object.keys(counts) as ProviderId[]).forEach((p) => {
      if (this.providerStates[p]) {
        this.providerStates[p].itemCount = counts[p];
      }
    });
  }

  private isCatalogStale(): boolean {
    if (!this.lastSyncAt) return true;
    const ageHours = (Date.now() - new Date(this.lastSyncAt).getTime()) / (1000 * 60 * 60);
    return ageHours >= STALE_AFTER_HOURS;
  }

  async ensureReady(): Promise<void> {
    if (this.syncMode === 'initial' && this.isSyncing && this.syncPromise) {
      await Promise.race([
        this.syncPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 5500)),
      ]);
      return;
    }
    if (this.catalogByKey.size === 0 && this.syncPromise) {
      await this.syncPromise;
      return;
    }
    if (this.isCatalogStale() && !this.isSyncing) {
      void this.runSync('refresh-on-open');
    }
  }

  async runSync(mode: SyncStatus['syncMode']): Promise<{started: boolean; message: string}> {
    if (this.isSyncing && this.syncPromise) {
      await this.syncPromise;
      return {started: false, message: 'Synchronization already in progress.'};
    }

    if (mode === 'manual') {
      const elapsed = Date.now() - this.lastManualSyncMs;
      if (elapsed < MANUAL_COOLDOWN_MS) {
        return {
          started: false,
          message: `Recently synchronized. Please wait ${Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 1000)}s before refreshing again.`,
        };
      }
      this.lastManualSyncMs = Date.now();
    }

    this.isSyncing = true;
    this.syncMode = mode;

    this.syncPromise = (async () => {
      let totalAdded = 0;
      let totalUpdated = 0;
      const checkedAt = new Date().toISOString();

      const recordBatch = (items: CatalogBook[]) => {
        if (items.length === 0) return;
        const counts = this.ingestBooks(items);
        totalAdded += counts.added;
        totalUpdated += counts.updated;
      };

      const tasks: Array<{provider: ProviderId; run: () => Promise<CatalogBook[]>}> = [
        {
          provider: 'openstax',
          run: async () => {
            const items = await fetchOpenStaxBooks();
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'open-umn',
          run: async () => {
            const queries = [
              {page: 1},
              {page: 2},
              {q: 'psychology'},
              {q: 'entrepreneurship'},
              {q: 'business'},
              {q: 'computer science'},
              {q: 'literature'},
              {q: 'history'},
              {q: 'philosophy'},
            ];
            const collected: CatalogBook[] = [];
            for (let i = 0; i < queries.length; i += 3) {
              const slice = queries.slice(i, i + 3);
              const res = await Promise.allSettled(slice.map((p) => fetchOpenUmnBooks(p)));
              const batchItems: CatalogBook[] = [];
              for (const r of res) {
                if (r.status === 'fulfilled') batchItems.push(...r.value);
              }
              recordBatch(batchItems);
              collected.push(...batchItems);
            }
            return collected;
          },
        },
        {
          provider: 'openalex',
          run: async () => {
            const specs: Array<Parameters<typeof fetchOpenAlexContemporaryBooks>[0]> = [
              {yearRange: '2026', perPage: 25},
              {yearRange: '2025', perPage: 25},
              {yearRange: '2020-2024', perPage: 25},
              {yearRange: '2010-2019', perPage: 20},
              {yearRange: '2000-2009', perPage: 20},
              {yearRange: '2027-2030', perPage: 15},
              {search: 'psychology behavior', yearRange: '2015-2026', perPage: 15, hintGenre: 'psychology'},
              {search: 'entrepreneurship startup', yearRange: '2015-2026', perPage: 15, hintGenre: 'entrepreneurship'},
              {search: 'business strategy economics', yearRange: '2015-2026', perPage: 15, hintGenre: 'business'},
              {search: 'artificial intelligence software engineering', yearRange: '2020-2026', perPage: 15, hintGenre: 'technology'},
              {search: 'personal development leadership habits', yearRange: '2015-2026', perPage: 15, hintGenre: 'self-development'},
            ];
            const collected: CatalogBook[] = [];
            for (let i = 0; i < specs.length; i += 4) {
              const slice = specs.slice(i, i + 4);
              const res = await Promise.allSettled(
                slice.map((s) => fetchOpenAlexContemporaryBooks(s)),
              );
              const batchItems: CatalogBook[] = [];
              for (const r of res) {
                if (r.status === 'fulfilled') batchItems.push(...r.value);
              }
              recordBatch(batchItems);
              collected.push(...batchItems);
            }
            return collected;
          },
        },
        {
          provider: 'doab',
          run: async () => {
            const [recent, newer] = await Promise.allSettled([
              fetchDoabOaiBooks('2023-01-01'),
              fetchDoabOaiBooks('2025-01-01'),
            ]);
            const items = [
              ...(recent.status === 'fulfilled' ? recent.value : []),
              ...(newer.status === 'fulfilled' ? newer.value : []),
            ];
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'baen',
          run: async () => {
            const items = await fetchBaenFreeLibrary();
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'speculative-press',
          run: async () => {
            const items = await fetchSpeculativePressFiction();
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'obooko',
          run: async () => {
            const items = await fetchObookoContemporaryBooks();
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'wikibooks',
          run: async () => {
            const items = await fetchWikibooksCatalog();
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'standard-ebooks',
          run: async () => {
            const [newReleases, page1] = await Promise.all([
              fetchStandardEbooksNewReleases(),
              fetchStandardEbooksCatalog({page: 1}),
            ]);
            const items = [...newReleases, ...page1];
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'gutendex',
          run: async () => {
            const specs: Array<Parameters<typeof fetchGutendexBooks>[0]> = [
              {sort: 'popular', page: 1},
              {sort: 'descending', page: 1, isNewArrival: true},
              {topic: 'philosophy', hintGenre: 'philosophy'},
              {topic: 'science', hintGenre: 'science'},
              {topic: 'history', hintGenre: 'history'},
              {topic: 'psychology', hintGenre: 'psychology'},
              {topic: 'economics', hintGenre: 'business'},
              {topic: 'science fiction', hintGenre: 'science-fiction'},
              {topic: 'detective', hintGenre: 'mystery'},
              {topic: 'poetry', hintGenre: 'poetry'},
              {search: 'engineering', hintGenre: 'technology'},
              {search: 'education', hintGenre: 'education'},
            ];
            const collected: CatalogBook[] = [];
            for (let i = 0; i < specs.length; i += 3) {
              const slice = specs.slice(i, i + 3);
              const res = await Promise.allSettled(slice.map((s) => fetchGutendexBooks(s)));
              const batchItems: CatalogBook[] = [];
              for (const r of res) {
                if (r.status === 'fulfilled') batchItems.push(...r.value);
              }
              recordBatch(batchItems);
              collected.push(...batchItems);
            }
            return collected;
          },
        },
        {
          provider: 'wikisource',
          run: async () => {
            const [seeds, poetryHits] = await Promise.all([
              fetchWikisourceSeeds(),
              searchWikisource('Rabindranath Tagore OR Swami Vivekananda', 'literature'),
            ]);
            const items = [...seeds, ...poetryHits];
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'open-library',
          run: async () => {
            const [businessBooks, techBooks, bioBooks] = await Promise.all([
              fetchOpenLibraryPublicDomain({subject: 'entrepreneurship', limit: 6, hintGenre: 'entrepreneurship'}),
              fetchOpenLibraryPublicDomain({subject: 'technology', limit: 6, hintGenre: 'technology'}),
              fetchOpenLibraryPublicDomain({subject: 'self-improvement', limit: 6, hintGenre: 'self-development'}),
            ]);
            const items = [...businessBooks, ...techBooks, ...bioBooks];
            recordBatch(items);
            return items;
          },
        },
        {
          provider: 'librivox',
          run: async () => {
            const items = await fetchLibriVoxCatalog();
            recordBatch(items);
            return items;
          },
        },
      ];

      await Promise.allSettled(
        tasks.map(async (t) => {
          this.providerStates[t.provider].lastCheckedAt = checkedAt;
          try {
            const items = await t.run();
            this.providerStates[t.provider].status = items.length > 0 ? 'ok' : 'degraded';
            this.providerStates[t.provider].lastSuccessAt = new Date().toISOString();
            this.providerStates[t.provider].error = null;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Provider request failed';
            this.providerStates[t.provider].status =
              this.providerStates[t.provider].itemCount > 0 ? 'degraded' : 'unavailable';
            this.providerStates[t.provider].error = msg;
          }
        }),
      );

      this.newlyAddedCount = totalAdded;
      this.updatedCount = totalUpdated;
      this.lastSyncAt = new Date().toISOString();
      this.nextScheduledSyncAt = new Date(Date.now() + DAILY_INTERVAL_MS).toISOString();
      this.isSyncing = false;
      this.syncPromise = null;
    })();

    await this.syncPromise;
    return {started: true, message: 'Multi-source contemporary and open-access synchronization completed.'};
  }

  getSyncStatus(): SyncStatus {
    const all = Array.from(this.catalogByKey.values());
    return {
      lastSyncAt: this.lastSyncAt,
      nextScheduledSyncAt: this.nextScheduledSyncAt,
      isSyncing: this.isSyncing,
      syncMode: this.syncMode,
      totalCatalogBooks: this.catalogByKey.size,
      newlyAddedCount: this.newlyAddedCount,
      updatedCount: this.updatedCount,
      staleAfterHours: STALE_AFTER_HOURS,
      isStale: this.isCatalogStale(),
      periodCounts: computePeriodCounts(all),
      providers: Object.values(this.providerStates),
    };
  }

  getBookById(id: string): CatalogBook | null {
    const key = this.keyByBookId.get(id);
    if (key) {
      return this.catalogByKey.get(key) || null;
    }
    for (const book of this.catalogByKey.values()) {
      if (book.id === id || book.editions.some((e) => e.editionId === id)) {
        return book;
      }
    }
    return null;
  }

  async attachAudiobookOnDemand(bookId: string): Promise<CatalogBook | null> {
    const existing = this.getBookById(bookId);
    if (!existing) return null;
    if ((existing.audiobooks?.length ?? 0) > 0) return existing;
    if (existing.freeAccessType !== 'public-domain') return existing;

    const match = await findLibriVoxMatchForBook(existing.title, existing.primaryAuthor);
    if (!match) return existing;

    const updated: CatalogBook = {
      ...existing,
      audiobooks: [match],
      updatedAt: new Date().toISOString(),
    };
    this.catalogByKey.set(existing.normalizedKey, updated);
    this.recountProviders();
    return updated;
  }

  async getHomeCollections(): Promise<HomeCollectionsResponse> {
    await this.ensureReady();
    const all = Array.from(this.catalogByKey.values());

    // Recent releases strictly use authentic original publicationYear >= 2024
    const recentReleases = all
      .filter((b) => typeof b.publicationYear === 'number' && b.publicationYear >= 2024)
      .sort((a, b) => {
        const yrDiff = (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
        if (yrDiff !== 0) return yrDiff;
        const coverDiff = Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl));
        if (coverDiff !== 0) return coverDiff;
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      })
      .slice(0, 12);

    // Contemporary novels published 2000–2026+
    const contemporaryNovels = all
      .filter(
        (b) =>
          b.kind === 'novel' &&
          typeof b.publicationYear === 'number' &&
          b.publicationYear >= 2000,
      )
      .sort((a, b) => {
        const coverDiff = Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl));
        if (coverDiff !== 0) return coverDiff;
        return (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
      })
      .slice(0, 12);

    // Modern non-fiction & open educational books published 2000–2026+
    const modernNonFiction = all
      .filter(
        (b) =>
          b.kind === 'book' &&
          typeof b.publicationYear === 'number' &&
          b.publicationYear >= 2000,
      )
      .sort((a, b) => {
        const coverDiff = Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl));
        if (coverDiff !== 0) return coverDiff;
        const yrDiff = (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
        if (yrDiff !== 0) return yrDiff;
        return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
      })
      .slice(0, 12);

    // Newly added free editions (contemporary new releases + newly digitized public-domain releases)
    const newlyAdded = all
      .filter(
        (b) =>
          b.isNewArrival ||
          (typeof b.digitalReleaseYear === 'number' && b.digitalReleaseYear >= 2025),
      )
      .sort((a, b) => {
        const contemporaryDiff =
          Number((b.publicationYear ?? 0) >= 2000) - Number((a.publicationYear ?? 0) >= 2000);
        if (contemporaryDiff !== 0) return contemporaryDiff;
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      })
      .slice(0, 12);

    const byPopularity = [...all].sort(
      (a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0),
    );

    const popularNovels = byPopularity
      .filter((b) => b.kind === 'novel')
      .slice(0, 12);

    const popularBooks = byPopularity
      .filter((b) => b.kind === 'book')
      .slice(0, 12);

    const indianHeritageAndPhilosophy = all
      .filter(
        (b) =>
          b.editions.some((e) => e.provider === 'wikisource') ||
          b.genres.includes('philosophy') ||
          b.genres.includes('poetry'),
      )
      .slice(0, 10);

    const featuredPick =
      recentReleases.find(
        (b) =>
          b.coverUrl &&
          b.summary &&
          b.editions.some((e) => e.provider === 'openstax' || e.provider === 'baen'),
      ) ||
      contemporaryNovels.find(
        (b) => b.coverUrl && b.summary && b.editions.some((e) => e.provider === 'baen'),
      ) ||
      contemporaryNovels.find((b) => b.coverUrl && b.summary) ||
      modernNonFiction.find((b) => b.coverUrl && b.summary) ||
      popularNovels.find((b) => b.coverUrl && b.editions.some((e) => e.provider === 'standard-ebooks')) ||
      popularNovels.find((b) => b.coverUrl) ||
      byPopularity[0] ||
      null;

    const audiobooksHighlight = all
      .filter((b) => (b.audiobooks?.length ?? 0) > 0)
      .sort((a, b) => {
        const coverDiff = Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl));
        if (coverDiff !== 0) return coverDiff;
        return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
      })
      .slice(0, 12);

    return {
      featuredPick,
      recentReleases,
      contemporaryNovels,
      modernNonFiction,
      newlyAdded,
      audiobooksHighlight,
      popularNovels,
      popularBooks,
      indianHeritageAndPhilosophy,
      syncStatus: this.getSyncStatus(),
    };
  }

  async getDiscoveryPool(limit = 180): Promise<CatalogBook[]> {
    await this.ensureReady();
    const all = Array.from(this.catalogByKey.values());
    if (all.length <= limit) return all;

    // Pick a diverse balanced slice: recent contemporary releases, human-narrated audiobooks,
    // genre representatives, and top downloaded/open works so personalized ranking & moods
    // draw across the entire library rather than skewing to one era.
    const picked = new Map<string, CatalogBook>();
    const addSlice = (items: CatalogBook[], maxCount: number) => {
      for (const b of items) {
        if (picked.size >= limit || maxCount <= 0) break;
        if (!picked.has(b.id)) {
          picked.set(b.id, b);
          maxCount--;
        }
      }
    };

    const contemporary = all
      .filter((b) => typeof b.publicationYear === 'number' && b.publicationYear >= 2015)
      .sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
    addSlice(contemporary, Math.floor(limit * 0.35));

    const audiobooks = all.filter((b) => (b.audiobooks?.length ?? 0) > 0);
    addSlice(audiobooks, Math.floor(limit * 0.2));

    for (const g of GENRES) {
      const genreMatches = all.filter((b) => b.genres.includes(g.slug));
      addSlice(genreMatches, 4);
    }

    const byPop = [...all].sort(
      (a, b) => getEditorialPopularityScore(b) - getEditorialPopularityScore(a),
    );
    addSlice(byPop, limit - picked.size);

    return Array.from(picked.values());
  }

  getGenreCounts(): Array<{slug: string; name: string; kindAffinity: BookKind | 'both'; description: string; count: number}> {
    const all = Array.from(this.catalogByKey.values());
    return GENRES.map((g) => ({
      ...g,
      count: all.filter((b) => b.genres.includes(g.slug)).length,
    }));
  }

  async queryCatalog(opts: {
    kind?: BookKind | 'all';
    genre?: string;
    q?: string;
    period?: string;
    sort?: 'popular' | 'newest' | 'year-desc' | 'title';
    page?: number;
    limit?: number;
  }): Promise<CatalogQueryResponse> {
    await this.ensureReady();

    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(40, Math.max(6, opts.limit || 18));
    const q = opts.q?.trim() || '';
    const genre = opts.genre?.trim().toLowerCase() || '';
    const period = normalizePeriodFilter(opts.period);

    // Live provider enrichment for search, thin genres, or specific contemporary eras
    if (q.length >= 2) {
      await this.enrichFromSearch(q, period);
    } else if (genre) {
      const currentGenreMatches = Array.from(this.catalogByKey.values()).filter((b) =>
        b.genres.includes(genre),
      );
      const contemporaryCount = currentGenreMatches.filter(
        (b) => typeof b.publicationYear === 'number' && b.publicationYear >= 2000,
      ).length;
      if (currentGenreMatches.length < 12 || contemporaryCount < 4) {
        await this.enrichFromGenre(genre);
      }
    } else if (period !== 'all' && period !== 'before-2000') {
      const currentPeriodCount = Array.from(this.catalogByKey.values()).filter((b) =>
        matchesPublicationPeriod(b, period),
      ).length;
      if (currentPeriodCount < 12) {
        const range = periodToOpenAlexRange(period);
        if (range) {
          const res = await Promise.allSettled([
            fetchOpenAlexContemporaryBooks({yearRange: range, perPage: 25}),
          ]);
          for (const r of res) {
            if (r.status === 'fulfilled' && r.value.length > 0) this.ingestBooks(r.value);
          }
        }
      }
    }

    let baseList = Array.from(this.catalogByKey.values());

    if (opts.kind && opts.kind !== 'all') {
      baseList = baseList.filter((b) => b.kind === opts.kind);
    }

    if (genre) {
      baseList = baseList.filter((b) => b.genres.includes(genre));
    }

    if (q) {
      const needle = q.toLowerCase();
      baseList = baseList.filter(
        (b) =>
          b.title.toLowerCase().includes(needle) ||
          b.primaryAuthor.toLowerCase().includes(needle) ||
          b.genres.some((g) => g.includes(needle)) ||
          b.subjects.some((s) => s.toLowerCase().includes(needle)),
      );
    }

    const periodCounts = computePeriodCounts(baseList);
    const list = baseList.filter((b) => matchesPublicationPeriod(b, period));

    const sortMode = opts.sort || 'popular';
    list.sort((a, b) => {
      if (sortMode === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortMode === 'year-desc') {
        const ya = a.publicationYear ?? -9999;
        const yb = b.publicationYear ?? -9999;
        if (yb !== ya) return yb - ya;
        return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
      }
      if (sortMode === 'newest') {
        const newDiff = Number(b.isNewArrival) - Number(a.isNewArrival);
        if (newDiff !== 0) return newDiff;
        const dyDiff = (b.digitalReleaseYear ?? 0) - (a.digitalReleaseYear ?? 0);
        if (dyDiff !== 0) return dyDiff;
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      }
      // popular: balance verified download/citation counts with contemporary publisher editions
      const scoreDiff = getEditorialPopularityScore(b) - getEditorialPopularityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const yrDiff = (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
      if (yrDiff !== 0) return yrDiff;
      return b.editions.length - a.editions.length;
    });

    const total = list.length;
    const start = (page - 1) * limit;
    const items = list.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      hasMore: start + limit < total,
      periodCounts,
      syncStatus: this.getSyncStatus(),
    };
  }

  private async enrichFromSearch(q: string, period: PublicationPeriodFilter): Promise<void> {
    const yearRange = periodToOpenAlexRange(period) || '2000-2026';
    const settled = await Promise.allSettled([
      fetchOpenAlexContemporaryBooks({search: q, yearRange, perPage: 15}),
      fetchOpenUmnBooks({q}),
      searchWikibooks(q),
      fetchGutendexBooks({search: q, sort: 'popular'}),
      fetchStandardEbooksCatalog({query: q}),
      searchWikisource(q),
      fetchOpenLibraryPublicDomain({q, limit: 8}),
      searchLibriVoxBooks(q),
    ]);
    for (const res of settled) {
      if (res.status === 'fulfilled' && res.value.length > 0) {
        this.ingestBooks(res.value);
      }
    }
  }

  private async enrichFromGenre(genreSlug: string): Promise<void> {
    const terms = getProviderSearchTermsForGenre(genreSlug);
    const subjectQuery = terms.openLibrarySubject.replace(/_/g, ' ');
    const settled = await Promise.allSettled([
      fetchOpenAlexContemporaryBooks({
        search: subjectQuery,
        yearRange: '2015-2026',
        perPage: 15,
        hintGenre: genreSlug,
      }),
      fetchOpenUmnBooks({q: subjectQuery}),
      fetchGutendexBooks({topic: terms.gutendexTopic, sort: 'popular', hintGenre: genreSlug}),
      fetchOpenLibraryPublicDomain({subject: terms.openLibrarySubject, limit: 8, hintGenre: genreSlug}),
      searchWikisource(terms.wikisourceQuery, genreSlug),
    ]);
    for (const res of settled) {
      if (res.status === 'fulfilled' && res.value.length > 0) {
        this.ingestBooks(res.value);
      }
    }
  }
}

export const syncManager = new CatalogSyncManager();
