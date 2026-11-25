import React, {useEffect, useState} from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Headphones,
  Heart,
  Highlighter,
  Loader2,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  AudiobookEdition,
  AudioModeType,
  BookEdition,
  BookshelfEntry,
  CatalogBook,
  ListeningProgress,
  OfflineDownloadProgress,
  ReadingProgress,
} from '../types/library';
import {libraryApi} from '../lib/api';
import {BookCover} from './BookCover';

interface BookDetailModalProps {
  book: CatalogBook;
  isSaved: boolean;
  shelfStatus?: BookshelfEntry['shelfStatus'];
  isFavourite: boolean;
  isOfflineSaved: boolean;
  offlineByteSize?: number;
  downloadProgress?: OfflineDownloadProgress | null;
  highlightCount?: number;
  progress: ReadingProgress | null;
  listeningProgress: ListeningProgress | null;
  onClose: () => void;
  onRead: (book: CatalogBook, edition: BookEdition) => void;
  onListen: (
    book: CatalogBook,
    edition: BookEdition | undefined,
    preferredMode: AudioModeType,
    audiobook?: AudiobookEdition,
  ) => void;
  onToggleShelf: (book: CatalogBook) => void;
  onSetShelfStatus: (book: CatalogBook, status: BookshelfEntry['shelfStatus']) => void;
  onToggleFavourite: (book: CatalogBook) => void;
  onSaveOffline: (book: CatalogBook, edition: BookEdition) => Promise<void>;
  onRemoveOffline: (bookId: string) => Promise<void>;
  onSelectGenre: (genreSlug: string) => void;
}

const IN_APP_READABLE_PROVIDERS = new Set([
  'gutendex',
  'standard-ebooks',
  'wikisource',
  'wikibooks',
  'baen',
  'speculative-press',
  'open-umn',
]);

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  isSaved,
  shelfStatus,
  isFavourite,
  isOfflineSaved,
  offlineByteSize,
  downloadProgress,
  highlightCount = 0,
  progress,
  listeningProgress,
  onClose,
  onRead,
  onListen,
  onToggleShelf,
  onSetShelfStatus,
  onToggleFavourite,
  onSaveOffline,
  onRemoveOffline,
  onSelectGenre,
}) => {
  const [liveBook, setLiveBook] = useState<CatalogBook>(book);
  const [selectedEditionId, setSelectedEditionId] = useState<string>(
    progress?.editionId && book.editions.some((e) => e.editionId === progress.editionId)
      ? progress.editionId
      : book.editions[0]?.editionId || '',
  );
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  useEffect(() => {
    setLiveBook(book);
    setSelectedEditionId(
      progress?.editionId && book.editions.some((e) => e.editionId === progress.editionId)
        ? progress.editionId
        : book.editions[0]?.editionId || '',
    );

    let active = true;
    libraryApi
      .getBook(book.id)
      .then((res) => {
        if (active && res.book) setLiveBook(res.book);
      })
      .catch(() => {
        // offline or cached; keep existing book metadata
      });
    return () => {
      active = false;
    };
  }, [book, progress?.editionId]);

  const activeEdition =
    liveBook.editions.find((e) => e.editionId === selectedEditionId) || liveBook.editions[0];

  const primaryAudiobook = liveBook.audiobooks?.[0] || null;
  const supportsInAppText =
    Boolean(activeEdition && IN_APP_READABLE_PROVIDERS.has(activeEdition.provider)) ||
    isOfflineSaved;

  const isDownloading = offlineBusy || downloadProgress?.status === 'downloading';

  const handleOfflineAction = async () => {
    if (!activeEdition) return;
    setOfflineError(null);
    setOfflineBusy(true);
    try {
      if (isOfflineSaved) {
        await onRemoveOffline(liveBook.id);
      } else {
        await onSaveOffline(liveBook, activeEdition);
      }
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : 'Offline save failed');
    } finally {
      setOfflineBusy(false);
    }
  };

  const authorDates = liveBook.authors[0]
    ? liveBook.authors[0].birthYear || liveBook.authors[0].deathYear
      ? `(${liveBook.authors[0].birthYear ?? '?'}–${liveBook.authors[0].deathYear ?? '?'})`
      : ''
    : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#FBF9F5] dark:bg-[#141210] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-detail-title"
    >
      {/* Top sticky navigation bar */}
      <div className="sticky top-0 z-20 bg-[#FBF9F5]/95 dark:bg-[#141210]/95 backdrop-blur-md border-b border-stone-200/80 dark:border-stone-800/80 pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 min-h-[44px] -ml-2 px-2 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:text-[#1E3A5F] dark:hover:text-[#7BA3D1] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleFavourite(liveBook)}
              aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors"
            >
              <Heart
                className={`w-5 h-5 ${
                  isFavourite ? 'fill-[#9A3412] text-[#9A3412] dark:fill-[#E07A5F] dark:text-[#E07A5F]' : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => onToggleShelf(liveBook)}
              aria-label={isSaved ? 'Remove from bookshelf' : 'Save to bookshelf'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors"
            >
              <Bookmark
                className={`w-5 h-5 ${
                  isSaved ? 'fill-[#1E3A5F] text-[#1E3A5F] dark:fill-[#7BA3D1] dark:text-[#7BA3D1]' : ''
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Main editorial book presentation */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-28">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] md:grid-cols-[230px_1fr] gap-6 sm:gap-10 items-start">
          <div className="w-44 sm:w-full mx-auto sm:mx-0">
            <BookCover
              title={liveBook.title}
              author={liveBook.primaryAuthor}
              coverUrl={liveBook.coverUrl}
              size="lg"
              className="shadow-md"
            />
          </div>

          <div className="space-y-4 text-center sm:text-left">
            <p className="text-xs uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095]">
              <span>{liveBook.kind === 'novel' ? 'Novel' : 'Book'}</span>
              {liveBook.publicationYear && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">
                    {liveBook.publicationYear > 0
                      ? liveBook.publicationYear
                      : `${Math.abs(liveBook.publicationYear)} BCE`}
                  </span>
                </>
              )}
              <span aria-hidden="true"> · </span>
              <span>{liveBook.languages.map((l) => l.toUpperCase()).join(', ')}</span>
              {primaryAudiobook && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">
                    Human Audiobook ({primaryAudiobook.totalTime})
                  </span>
                </>
              )}
            </p>

            <h1
              id="book-detail-title"
              className="font-display text-2xl sm:text-4xl font-semibold text-[#1C1917] dark:text-[#F3EFE8] leading-tight text-balance"
            >
              {liveBook.title}
            </h1>

            <p className="text-base sm:text-lg text-[#44403C] dark:text-[#D6D0C6]">
              {liveBook.authors.map((a) => a.name).join(', ')}{' '}
              {authorDates && (
                <span className="text-sm text-[#6B655E] dark:text-[#A8A095] tabular-nums">
                  {authorDates}
                </span>
              )}
            </p>

            {/* Primary reading & listening actions */}
            <div className="pt-2 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
              {activeEdition && activeEdition.provider !== 'librivox' && (
                <button
                  type="button"
                  onClick={() => onRead(liveBook, activeEdition)}
                  className="inline-flex items-center justify-center gap-2.5 min-h-[48px] px-6 py-3 rounded-lg bg-[#1E3A5F] text-white hover:bg-[#162D4A] dark:bg-[#7BA3D1] dark:text-[#141210] dark:hover:bg-[#92B5DD] font-medium text-sm transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>
                    {progress && progress.percentComplete > 0
                      ? `Continue Reading (${Math.round(progress.percentComplete)}%)`
                      : 'Read Book'}
                  </span>
                </button>
              )}

              {primaryAudiobook ? (
                <button
                  type="button"
                  onClick={() => onListen(liveBook, activeEdition, 'audiobook', primaryAudiobook)}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-lg bg-[#9A3412] text-white hover:bg-[#7C2D12] dark:bg-[#E07A5F] dark:text-[#141210] dark:hover:bg-[#EA8C72] font-medium text-sm transition-colors"
                >
                  <Headphones className="w-4 h-4" />
                  <span>
                    {listeningProgress && listeningProgress.audioMode === 'audiobook'
                      ? `Resume Audiobook (${Math.round(listeningProgress.percentComplete)}%)`
                      : 'Listen · Human Audiobook'}
                  </span>
                </button>
              ) : supportsInAppText ? (
                <button
                  type="button"
                  onClick={() => onListen(liveBook, activeEdition, 'tts')}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-lg border border-[#1E3A5F] dark:border-[#7BA3D1] text-[#1E3A5F] dark:text-[#7BA3D1] hover:bg-[#1E3A5F]/5 dark:hover:bg-[#7BA3D1]/10 font-medium text-sm transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>
                    {listeningProgress && listeningProgress.audioMode === 'tts'
                      ? `Resume Voice (${Math.round(listeningProgress.percentComplete)}%)`
                      : 'Listen · Browser Voice'}
                  </span>
                </button>
              ) : null}

              {activeEdition && activeEdition.provider !== 'librivox' && (
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => void handleOfflineAction()}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-lg border border-stone-300 dark:border-stone-700 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] hover:bg-stone-100 dark:hover:bg-stone-800/70 transition-colors disabled:opacity-60"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {downloadProgress?.stageLabel || 'Downloading...'}{' '}
                        {downloadProgress ? `${downloadProgress.percent}%` : ''}
                      </span>
                    </>
                  ) : isOfflineSaved ? (
                    <>
                      <Check className="w-4 h-4 text-[#1E3A5F] dark:text-[#7BA3D1]" />
                      <span>Saved Offline{offlineByteSize ? ` (${formatBytes(offlineByteSize)})` : ''}</span>
                      <Trash2 className="w-3.5 h-3.5 ml-1 text-stone-400" />
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Save for Offline</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {downloadProgress?.status === 'downloading' && (
              <div className="max-w-md space-y-1 pt-1">
                <div className="w-full h-1.5 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1] transition-all duration-200"
                    style={{width: `${Math.max(8, downloadProgress.percent)}%`}}
                  />
                </div>
                <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095]">
                  {downloadProgress.stageLabel} ({downloadProgress.percent}%)
                </p>
              </div>
            )}

            {/* Shelf Reading Status Selector */}
            <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
              <span className="text-[#6B655E] dark:text-[#A8A095]">Status:</span>
              {(['saved', 'reading', 'finished'] as const).map((status) => {
                const active = (isSaved ? shelfStatus : undefined) === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => onSetShelfStatus(liveBook, status)}
                    className={`inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-md border text-xs font-medium capitalize transition-colors ${
                      active
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                        : 'border-stone-300 dark:border-stone-700 text-[#44403C] dark:text-[#D6D0C6] hover:border-[#1E3A5F] dark:hover:border-[#7BA3D1]'
                    }`}
                  >
                    {status === 'finished' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>{status === 'finished' ? 'Completed' : status}</span>
                  </button>
                );
              })}
              {highlightCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[#6B655E] dark:text-[#A8A095] ml-1 tabular-nums">
                  <Highlighter className="w-3.5 h-3.5 text-[#CA8A04]" />
                  <span>{highlightCount} saved highlight{highlightCount === 1 ? '' : 's'}</span>
                </span>
              )}
            </div>

            {/* Secondary voice option if both human audiobook and in-app text exist, or honest limitation note */}
            {primaryAudiobook && supportsInAppText && (
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                Narrated by {primaryAudiobook.narrators.slice(0, 2).join(', ')} (LibriVox) ·{' '}
                <button
                  type="button"
                  onClick={() => onListen(liveBook, activeEdition, 'tts')}
                  className="text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline font-medium"
                >
                  Or listen with Browser Text-to-Speech
                </button>
              </p>
            )}
            {!primaryAudiobook && !supportsInAppText && (
              <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                External publisher-hosted volume: open the verified source edition above to read. Audio narration requires an in-app text edition or a LibriVox recording.
              </p>
            )}

            {(offlineError || downloadProgress?.error) && (
              <div className="pt-1 flex items-center gap-3 text-xs text-[#9A3412] dark:text-[#F28482]">
                <span>{offlineError || downloadProgress?.error}</span>
                {activeEdition && (
                  <button
                    type="button"
                    onClick={() => void handleOfflineAction()}
                    className="underline font-medium shrink-0"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {/* Genre filters (interactive buttons) */}
            <div className="pt-2 flex flex-wrap justify-center sm:justify-start gap-2">
              {liveBook.genres.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectGenre(slug);
                  }}
                  className="min-h-[36px] px-3 py-1 rounded-md bg-[#F3EFE6] dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 text-xs font-medium text-[#44403C] dark:text-[#D6D0C6] hover:border-[#1E3A5F] dark:hover:border-[#7BA3D1] transition-colors"
                >
                  {slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Editorial metadata & summary */}
        <div className="mt-10 pt-8 border-t border-stone-200 dark:border-stone-800 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            {liveBook.summary && (
              <section>
                <h2 className="text-xs uppercase tracking-[0.14em] text-[#6B655E] dark:text-[#A8A095] font-medium mb-2.5">
                  Publisher & Archive Synopsis
                </h2>
                <p className="font-prose text-base leading-relaxed text-[#292524] dark:text-[#E5E0D8]">
                  {liveBook.summary}
                </p>
              </section>
            )}

            {liveBook.subjects.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-[0.14em] text-[#6B655E] dark:text-[#A8A095] font-medium mb-2">
                  Catalogue Subjects
                </h2>
                <p className="text-sm text-[#44403C] dark:text-[#C8C0B4] leading-relaxed">
                  {liveBook.subjects.join(' · ')}
                </p>
              </section>
            )}

            {/* Human-Narrated Audiobook Recordings */}
            {liveBook.audiobooks && liveBook.audiobooks.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-[0.14em] text-[#6B655E] dark:text-[#A8A095] font-medium mb-3">
                  Human-Narrated Audiobook Editions ({liveBook.audiobooks.length})
                </h2>
                <div className="divide-y divide-stone-200 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden bg-white/60 dark:bg-[#1D1A17]">
                  {liveBook.audiobooks.map((ab) => (
                    <div key={ab.audiobookId} className="p-4 flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => onListen(liveBook, activeEdition, 'audiobook', ab)}
                        className="text-left flex-1 min-h-[44px] flex flex-col justify-center"
                      >
                        <span className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] inline-flex items-center gap-1.5">
                          <Headphones className="w-3.5 h-3.5 text-[#9A3412] dark:text-[#E07A5F]" />
                          <span>{ab.providerLabel}</span>
                        </span>
                        <span className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5 tabular-nums">
                          Read by {ab.narrators.slice(0, 2).join(', ')} · {ab.numSections} chapters · {ab.totalTime}
                        </span>
                      </button>
                      <a
                        href={ab.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline shrink-0"
                      >
                        <span>LibriVox</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Editions & Sources */}
            <section>
              <h2 className="text-xs uppercase tracking-[0.14em] text-[#6B655E] dark:text-[#A8A095] font-medium mb-3">
                Available Free Editions ({liveBook.editions.length})
              </h2>
              <div className="divide-y divide-stone-200 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden bg-white/60 dark:bg-[#1D1A17]">
                {liveBook.editions.map((ed) => {
                  const selected = ed.editionId === activeEdition?.editionId;
                  return (
                    <div
                      key={ed.editionId}
                      className={`p-4 flex items-center justify-between gap-4 transition-colors ${
                        selected ? 'bg-[#F3EFE6]/80 dark:bg-[#25211D]' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedEditionId(ed.editionId)}
                        className="text-left flex-1 min-h-[44px] flex flex-col justify-center"
                      >
                        <span className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]">
                          {ed.providerLabel}
                        </span>
                        <span className="text-xs text-[#6B655E] dark:text-[#A8A095] mt-0.5">
                          {ed.formatLabel} · {ed.licenseLabel}
                        </span>
                      </button>

                      <a
                        href={ed.externalReadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline shrink-0"
                      >
                        <span>Source</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Provenance & Rights */}
          <aside className="space-y-4">
            <div className="p-5 rounded-xl bg-[#F3EFE6]/70 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 space-y-4">
              <h2 className="text-xs uppercase tracking-[0.14em] text-[#6B655E] dark:text-[#A8A095] font-medium">
                Rights & Provenance
              </h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-[#6B655E] dark:text-[#A8A095]">Free Access Status</dt>
                  <dd className="font-medium text-[#1C1917] dark:text-[#F3EFE8]">
                    {liveBook.freeAccessType === 'open-access-cc'
                      ? '₹0 · Open Access (Creative Commons)'
                      : liveBook.freeAccessType === 'publisher-free-library'
                        ? '₹0 · Publisher Free Library'
                        : liveBook.freeAccessType === 'author-free-edition'
                          ? '₹0 · Authorized Author Free Edition'
                          : '₹0 · Public Domain'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6B655E] dark:text-[#A8A095]">Original Publication</dt>
                  <dd className="font-medium tabular-nums text-[#1C1917] dark:text-[#F3EFE8]">
                    {typeof liveBook.publicationYear === 'number'
                      ? liveBook.publicationYear > 0
                        ? String(liveBook.publicationYear)
                        : `${Math.abs(liveBook.publicationYear)} BCE`
                      : liveBook.freeAccessType === 'public-domain'
                        ? 'Pre-1931 Classic'
                        : 'Contemporary'}
                  </dd>
                </div>
                {typeof liveBook.digitalReleaseYear === 'number' &&
                  liveBook.digitalReleaseYear !== liveBook.publicationYear && (
                    <div>
                      <dt className="text-xs text-[#6B655E] dark:text-[#A8A095]">Digital Edition Released</dt>
                      <dd className="font-medium tabular-nums text-[#1C1917] dark:text-[#F3EFE8]">
                        {liveBook.digitalReleaseYear}
                      </dd>
                    </div>
                  )}
                <div>
                  <dt className="text-xs text-[#6B655E] dark:text-[#A8A095]">Licensing Note</dt>
                  <dd className="text-[#292524] dark:text-[#D6D0C6] leading-snug mt-0.5">
                    {liveBook.copyrightNote}
                  </dd>
                </div>
                {typeof liveBook.downloadCount === 'number' && liveBook.downloadCount > 0 && (
                  <div>
                    <dt className="text-xs text-[#6B655E] dark:text-[#A8A095]">Reader Citations / Downloads</dt>
                    <dd className="font-medium tabular-nums text-[#1C1917] dark:text-[#F3EFE8]">
                      {liveBook.downloadCount.toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
