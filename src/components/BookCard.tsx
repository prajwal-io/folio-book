import React from 'react';
import type {CatalogBook} from '../types/library';
import {BookCover} from './BookCover';

interface BookCardProps {
  book: CatalogBook;
  onSelect: (book: CatalogBook) => void;
  progressPercent?: number;
  isOfflineSaved?: boolean;
  compact?: boolean;
}

export const BookCard: React.FC<BookCardProps> = ({
  book,
  onSelect,
  progressPercent,
  isOfflineSaved,
  compact = false,
}) => {
  const primaryGenre = book.genres[0]
    ? book.genres[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : book.kind === 'novel'
      ? 'Novel'
      : 'Book';

  const hasAudiobook = (book.audiobooks?.length ?? 0) > 0;
  const primaryProvider = book.editions[0]?.providerLabel || 'Open Archive';
  const yearLabel =
    typeof book.publicationYear === 'number'
      ? book.publicationYear > 0
        ? String(book.publicationYear)
        : `${Math.abs(book.publicationYear)} BCE`
      : book.freeAccessType === 'public-domain'
        ? 'Classic'
        : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      className="group text-left w-full flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] dark:focus-visible:ring-[#7BA3D1] rounded-lg"
    >
      <div className="relative w-full transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-active:scale-[0.98]">
        <BookCover
          title={book.title}
          author={book.primaryAuthor}
          coverUrl={book.coverUrl}
          size={compact ? 'sm' : 'md'}
        />
        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/25 overflow-hidden rounded-b-md">
            <div
              className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1]"
              style={{width: `${Math.min(100, Math.max(4, progressPercent))}%`}}
            />
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-1 px-0.5">
        <h3 className="font-display text-[15px] sm:text-base font-medium leading-snug text-[#1C1917] dark:text-[#F3EFE8] line-clamp-2 group-hover:text-[#1E3A5F] dark:group-hover:text-[#7BA3D1] transition-colors">
          {book.title}
        </h3>
        <p className="text-xs sm:text-[13px] text-[#6B655E] dark:text-[#A8A095] truncate">
          {book.primaryAuthor}
        </p>
        <p className="text-[11px] text-[#8A8279] dark:text-[#8E867B] truncate tabular-nums">
          <span>{primaryGenre}</span>
          {yearLabel && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{yearLabel}</span>
            </>
          )}
          {hasAudiobook && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">Audiobook</span>
            </>
          )}
          <span aria-hidden="true"> · </span>
          <span>
            {isOfflineSaved
              ? 'Offline Ready'
              : typeof progressPercent === 'number' && progressPercent > 0
                ? `${Math.round(progressPercent)}%`
                : book.editions.length > 1
                  ? `${book.editions.length} editions`
                  : primaryProvider}
          </span>
        </p>
      </div>
    </button>
  );
};
