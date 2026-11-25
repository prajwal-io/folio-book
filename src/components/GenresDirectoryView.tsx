import React from 'react';
import {ArrowRight} from 'lucide-react';
import type {GenreWithCount} from '../lib/api';

interface GenresDirectoryViewProps {
  genres: GenreWithCount[];
  onPickGenre: (slug: string, kind: 'books' | 'novels') => void;
}

export const GenresDirectoryView: React.FC<GenresDirectoryViewProps> = ({
  genres,
  onPickGenre,
}) => {
  const novelGenres = genres.filter((g) => g.kindAffinity === 'novel' || g.kindAffinity === 'both');
  const bookGenres = genres.filter((g) => g.kindAffinity === 'book');

  const renderGroup = (
    heading: string,
    description: string,
    list: GenreWithCount[],
    targetTab: 'books' | 'novels',
  ) => (
    <section className="space-y-4">
      <div className="border-b border-stone-200 dark:border-stone-800 pb-3">
        <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
          {heading}
        </h2>
        <p className="text-xs sm:text-sm text-[#6B655E] dark:text-[#A8A095] mt-0.5">
          {description}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {list.map((g) => (
          <button
            key={g.slug}
            type="button"
            onClick={() => onPickGenre(g.slug, targetTab)}
            className="group text-left p-4 sm:p-5 rounded-xl bg-white/75 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 hover:border-[#1E3A5F] dark:hover:border-[#7BA3D1] transition-colors flex items-center justify-between gap-4 min-h-[76px]"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-baseline gap-2.5">
                <h3 className="font-display text-lg font-semibold text-[#1C1917] dark:text-[#F3EFE8] group-hover:text-[#1E3A5F] dark:group-hover:text-[#7BA3D1] transition-colors">
                  {g.name}
                </h3>
                <span className="text-xs text-[#8A8279] dark:text-[#8E867B] tabular-nums">
                  {g.count} {g.count === 1 ? 'title' : 'titles'}
                </span>
              </div>
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095] line-clamp-1">
                {g.description}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-[#1E3A5F] dark:group-hover:text-[#7BA3D1] shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-10">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#1C1917] dark:text-[#F3EFE8]">
          Explore by Genre
        </h1>
        <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
          Twenty-two literary and non-fiction subjects indexed from open archives. Choosing any genre also searches providers for additional titles.
        </p>
      </header>

      {renderGroup(
        'Novels, Fiction & Classics',
        'Imaginative literature, mysteries, adventures, and canonical works.',
        novelGenres,
        'novels',
      )}

      {renderGroup(
        'Non-Fiction, Ideas, Craft & Poetry',
        'Philosophy, psychology, entrepreneurship, technology, science, history, and verse.',
        bookGenres,
        'books',
      )}
    </div>
  );
};
