import React, {useEffect, useState} from 'react';
import {Loader2, Search, X} from 'lucide-react';
import type {
  BookKind,
  CatalogBook,
  PublicationPeriodCounts,
  PublicationPeriodFilter,
  ReadingProgress,
} from '../types/library';
import {libraryApi, type GenreWithCount} from '../lib/api';
import {BookCard} from './BookCard';

interface CatalogBrowseViewProps {
  mode: 'books' | 'novels' | 'all';
  selectedGenre: string;
  selectedPeriod: PublicationPeriodFilter;
  searchQuery: string;
  genres: GenreWithCount[];
  progressByBookId: Record<string, ReadingProgress>;
  offlineIds: Set<string>;
  onChangeGenre: (slug: string) => void;
  onChangePeriod: (period: PublicationPeriodFilter) => void;
  onChangeSearch: (q: string) => void;
  onSelectBook: (book: CatalogBook) => void;
}

const PERIOD_FILTERS: Array<{id: PublicationPeriodFilter; label: string}> = [
  {id: 'all', label: 'All Years'},
  {id: '2026', label: '2026'},
  {id: '2025', label: '2025'},
  {id: '2020-2024', label: '2020–2024'},
  {id: '2010-2019', label: '2010–2019'},
  {id: '2000-2009', label: '2000–2009'},
  {id: 'before-2000', label: 'Before 2000'},
  {id: 'future', label: 'Future'},
];

export const CatalogBrowseView: React.FC<CatalogBrowseViewProps> = ({
  mode,
  selectedGenre,
  selectedPeriod,
  searchQuery,
  genres,
  progressByBookId,
  offlineIds,
  onChangeGenre,
  onChangePeriod,
  onChangeSearch,
  onSelectBook,
}) => {
  const [sort, setSort] = useState<'popular' | 'year-desc' | 'newest' | 'title'>(
    selectedPeriod !== 'all' ? 'year-desc' : 'popular',
  );
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CatalogBook[]>([]);
  const [total, setTotal] = useState(0);
  const [periodCounts, setPeriodCounts] = useState<PublicationPeriodCounts | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localInput, setLocalInput] = useState(searchQuery);

  useEffect(() => {
    setLocalInput(searchQuery);
  }, [searchQuery]);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (localInput !== searchQuery) {
        onChangeSearch(localInput);
      }
    }, 320);
    return () => window.clearTimeout(t);
  }, [localInput, searchQuery, onChangeSearch]);

  const kindParam: BookKind | 'all' =
    mode === 'books' ? 'book' : mode === 'novels' ? 'novel' : 'all';

  // Fetch initial page whenever filters change
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPage(1);

    libraryApi
      .queryBooks({
        kind: kindParam,
        genre: selectedGenre || undefined,
        q: searchQuery || undefined,
        period: selectedPeriod,
        sort,
        page: 1,
        limit: 18,
      })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
        setPeriodCounts(res.periodCounts);
        setHasMore(res.hasMore);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load catalogue');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kindParam, selectedGenre, selectedPeriod, searchQuery, sort]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await libraryApi.queryBooks({
        kind: kindParam,
        genre: selectedGenre || undefined,
        q: searchQuery || undefined,
        period: selectedPeriod,
        sort,
        page: nextPage,
        limit: 18,
      });
      setItems((prev) => [...prev, ...res.items]);
      setPage(nextPage);
      setHasMore(res.hasMore);
    } catch {
      // keep existing items
    } finally {
      setLoadingMore(false);
    }
  };

  const relevantGenres = genres.filter((g) => {
    if (mode === 'novels') return g.kindAffinity === 'novel' || g.kindAffinity === 'both';
    if (mode === 'books') return g.kindAffinity === 'book' || g.kindAffinity === 'both';
    return true;
  });

  const heading =
    mode === 'novels'
      ? 'Novels & Fiction'
      : mode === 'books'
        ? 'Books & Non-Fiction'
        : 'Library Catalogue';

  const subtitle =
    mode === 'novels'
      ? 'Contemporary and classic novels, mysteries, romance, sci-fi, and speculative tales.'
      : mode === 'books'
        ? 'Modern open-access books, psychology, business, technology, philosophy, and poetry.'
        : 'Search across contemporary open-access and classic editions by title, author, genre, or era.';

  return (
    <div className="space-y-6">
      <header className="space-y-2 border-b border-stone-200 dark:border-stone-800 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
              {heading}
            </h1>
            <p className="text-sm text-[#6B655E] dark:text-[#A8A095] mt-1">
              {subtitle}
            </p>
          </div>
          {!loading && (
            <p className="text-xs text-[#6B655E] dark:text-[#A8A095] tabular-nums">
              {total} {total === 1 ? 'edition' : 'editions'} available
            </p>
          )}
        </div>

        {/* Search & Sort toolbar */}
        <div className="pt-3 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={localInput}
              onChange={(e) => setLocalInput(e.target.value)}
              placeholder="Search title, author, or subject..."
              aria-label="Search books by title, author, or subject"
              className="w-full min-h-[44px] pl-10 pr-10 rounded-lg bg-white dark:bg-[#1D1A17] border border-stone-300 dark:border-stone-700 text-sm text-[#1C1917] dark:text-[#F3EFE8] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] dark:focus:ring-[#7BA3D1]"
            />
            {localInput && (
              <button
                type="button"
                onClick={() => {
                  setLocalInput('');
                  onChangeSearch('');
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3EFE6] dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 overflow-x-auto no-scrollbar self-start sm:self-auto">
            {(
              [
                {key: 'popular', label: 'Popular'},
                {key: 'year-desc', label: 'Newest Published'},
                {key: 'newest', label: 'Recently Added'},
                {key: 'title', label: 'Title'},
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSort(opt.key)}
                className={`min-h-[36px] px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  sort === opt.key
                    ? 'bg-white dark:bg-[#2A2622] text-[#1C1917] dark:text-[#F3EFE8] shadow-sm'
                    : 'text-[#6B655E] dark:text-[#A8A095] hover:text-[#1C1917] dark:hover:text-[#F3EFE8]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Genre filter strip */}
        <div className="pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => onChangeGenre('')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
              selectedGenre === ''
                ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                : 'bg-white/70 dark:bg-[#1D1A17] border-stone-200 dark:border-stone-800 text-[#44403C] dark:text-[#D6D0C6]'
            }`}
          >
            All Genres
          </button>
          {relevantGenres.map((g) => {
            const active = selectedGenre === g.slug;
            return (
              <button
                key={g.slug}
                type="button"
                onClick={() => onChangeGenre(active ? '' : g.slug)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                  active
                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                    : 'bg-white/70 dark:bg-[#1D1A17] border-stone-200 dark:border-stone-800 text-[#44403C] dark:text-[#D6D0C6]'
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>

        {/* Publication Year / Era filter strip */}
        <div className="pt-1 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {PERIOD_FILTERS.map((p) => {
            const active = selectedPeriod === p.id;
            const count = periodCounts ? periodCounts[p.id] : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChangePeriod(active && p.id !== 'all' ? 'all' : p.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors tabular-nums ${
                  active
                    ? 'bg-[#9A3412] text-white border-[#9A3412] dark:bg-[#E07A5F] dark:text-[#141210] dark:border-[#E07A5F]'
                    : 'bg-[#F3EFE6]/70 dark:bg-[#1D1A17] border-stone-200/80 dark:border-stone-800 text-[#44403C] dark:text-[#D6D0C6]'
                }`}
              >
                <span>{p.label}</span>
                {typeof count === 'number' && (
                  <span className={`ml-1.5 ${active ? 'opacity-90' : 'text-[#8A8279] dark:text-[#8E867B]'}`}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Results grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
          {Array.from({length: 12}).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[2/3] rounded-md bg-stone-200 dark:bg-stone-800 animate-pulse" />
              <div className="h-4 w-4/5 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/50 dark:bg-[#1D1A17]">
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]">{error}</p>
          <p className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-1">
            Check your connection or open your Shelf for offline saved books.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-stone-200 dark:border-stone-800 bg-[#F3EFE6]/40 dark:bg-[#1D1A17] space-y-3">
          <h2 className="font-display text-xl font-medium text-[#1C1917] dark:text-[#F3EFE8]">
            No matching titles found
          </h2>
          <p className="text-sm text-[#6B655E] dark:text-[#A8A095] max-w-md mx-auto">
            {selectedPeriod === 'future'
              ? 'No verified free editions with post-2026 release dates are currently listed by our open-access providers. Clear the year filter or explore 2025–2026 releases.'
              : 'Try broadening the publication era, clearing your genre filter, or searching by author or topic.'}
          </p>
          {(selectedGenre || searchQuery || selectedPeriod !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setLocalInput('');
                onChangeSearch('');
                onChangeGenre('');
                onChangePeriod('all');
              }}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6">
            {items.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onSelect={onSelectBook}
                progressPercent={progressByBookId[book.id]?.percentComplete}
                isOfflineSaved={offlineIds.has(book.id)}
              />
            ))}
          </div>

          {hasMore && (
            <div className="pt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore()}
                className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{loadingMore ? 'Loading more...' : 'Load More Editions'}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
