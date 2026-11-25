import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  AlignJustify,
  AlignLeft,
  ArrowLeft,
  BookA,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Headphones,
  Highlighter,
  List,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RotateCcw,
  Trash2,
  Type,
  Volume2,
  X,
} from 'lucide-react';
import type {
  BookEdition,
  BookmarkItem,
  CatalogBook,
  DictionaryEntry,
  HighlightAnnotation,
  HighlightColor,
  ReaderContentResponse,
  ReaderFontFamily,
  ReaderPreferences,
  ReaderPresetId,
  ReadingProgress,
} from '../types/library';
import {libraryApi} from '../lib/api';
import {
  applyHighlightsToDom,
  extractSelectionAnchor,
  HIGHLIGHT_SWATCHES,
  type SelectionAnchorResult,
} from '../lib/highlightsDom';
import {applyReaderPreset, DEFAULT_PREFERENCES} from '../lib/storage';

interface ReaderViewProps {
  book: CatalogBook;
  edition: BookEdition;
  initialProgress: ReadingProgress | null;
  initialHighlightJump?: HighlightAnnotation | null;
  bookmarks: BookmarkItem[];
  highlights: HighlightAnnotation[];
  preferences: ReaderPreferences;
  onUpdatePreferences: (next: ReaderPreferences) => void;
  onSaveProgress: (progress: ReadingProgress) => void;
  onAddBookmark: (bookmark: BookmarkItem) => void;
  onDeleteBookmark: (id: string) => void;
  onSaveHighlight: (highlight: HighlightAnnotation) => void;
  onDeleteHighlight: (id: string) => void;
  onActiveReadingSeconds: (seconds: number, isNewSession: boolean) => void;
  onSwitchToListen: (
    book: CatalogBook,
    edition: BookEdition,
    chapterIndex: number,
    scrollRatio: number,
  ) => void;
  onClose: () => void;
}

const PAGE_GAP = 32;

const READER_THEMES: Record<
  ReaderPreferences['readerTheme'],
  {bg: string; surface: string; text: string; muted: string; border: string; label: string}
> = {
  light: {
    bg: 'bg-[#FBF9F5]',
    surface: 'bg-[#F3EFE6]',
    text: 'text-[#1C1917]',
    muted: 'text-[#6B655E]',
    border: 'border-stone-200',
    label: 'Paper',
  },
  sepia: {
    bg: 'bg-[#F4ECD8]',
    surface: 'bg-[#EAE0C8]',
    text: 'text-[#2D2218]',
    muted: 'text-[#6E5C49]',
    border: 'border-[#DFD2B6]',
    label: 'Sepia',
  },
  dark: {
    bg: 'bg-[#141210]',
    surface: 'bg-[#1E1B18]',
    text: 'text-[#E6E0D6]',
    muted: 'text-[#9E9589]',
    border: 'border-stone-800',
    label: 'Night',
  },
};

const FONT_OPTIONS: Array<{id: ReaderFontFamily; label: string; className: string}> = [
  {id: 'serif', label: 'Lora Serif', className: 'font-prose'},
  {id: 'source-serif', label: 'Source Serif', className: 'font-prose-modern'},
  {id: 'georgia', label: 'Georgia Classic', className: 'font-prose-georgia'},
  {id: 'sans', label: 'Plus Jakarta', className: 'font-ui'},
];

const PRESET_CARDS: Array<{id: Exclude<ReaderPresetId, 'custom'>; label: string; hint: string}> = [
  {id: 'classic', label: 'Classic', hint: 'Serif · Sepia'},
  {id: 'focus', label: 'Focus', hint: 'Pages · Minimal'},
  {id: 'night', label: 'Night', hint: 'Dark Ink'},
  {id: 'comfortable', label: 'Comfortable', hint: 'Large · Airy'},
];

function extractSingleWord(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '');
  if (!cleaned || cleaned.includes(' ') || !/^[a-zA-Z][a-zA-Z'-]{0,38}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function getWordAtPoint(x: number, y: number, container: HTMLElement): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node; offset: number} | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || !container.contains(node) || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = node.textContent || '';
  if (!text) return null;

  let start = offset;
  let end = offset;
  const wordChar = /[a-zA-Z'-]/;
  while (start > 0 && wordChar.test(text[start - 1])) start--;
  while (end < text.length && wordChar.test(text[end])) end++;
  const raw = text.slice(start, end);
  return extractSingleWord(raw);
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  edition,
  initialProgress,
  initialHighlightJump,
  bookmarks,
  highlights,
  preferences,
  onUpdatePreferences,
  onSaveProgress,
  onAddBookmark,
  onDeleteBookmark,
  onSaveHighlight,
  onDeleteHighlight,
  onActiveReadingSeconds,
  onSwitchToListen,
  onClose,
}) => {
  const [content, setContent] = useState<ReaderContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chapterIndex, setChapterIndex] = useState<number>(
    initialHighlightJump?.chapterIndex ?? initialProgress?.chapterIndex ?? 0,
  );
  const [scrollRatio, setScrollRatio] = useState<number>(
    initialHighlightJump?.scrollRatio ?? initialProgress?.scrollRatio ?? 0,
  );
  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(
    initialHighlightJump?.id || null,
  );

  const [controlsVisible, setControlsVisible] = useState(!preferences.focusHideChrome);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'toc' | 'typography'>('none');
  const [tocTab, setTocTab] = useState<'chapters' | 'bookmarks' | 'highlights'>('chapters');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Dictionary & selection states
  const [tapToDefineMode, setTapToDefineMode] = useState(false);
  const [selectionPending, setSelectionPending] = useState<SelectionAnchorResult | null>(null);
  const [dictState, setDictState] = useState<{
    open: boolean;
    word: string;
    loading: boolean;
    entry: DictionaryEntry | null;
    error: string | null;
  }>({
    open: false,
    word: '',
    loading: false,
    entry: null,
    error: null,
  });

  // Highlight / Note editor modal state
  const [noteModal, setNoteModal] = useState<{
    mode: 'new' | 'edit';
    existingId?: string;
    anchor?: SelectionAnchorResult;
    quote: string;
    color: HighlightColor;
    note: string;
  } | null>(null);

  // Paginated layout measurements
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pageDims, setPageDims] = useState<{width: number; height: number}>({width: 600, height: 640});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageBoxRef = useRef<HTMLDivElement | null>(null);
  const paginatedTrackRef = useRef<HTMLDivElement | null>(null);
  const proseRef = useRef<HTMLDivElement | null>(null);
  const restoredChapterRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const lastActivityMsRef = useRef<number>(Date.now());
  const sessionStartedRef = useRef<boolean>(false);

  const markUserActive = useCallback(() => {
    lastActivityMsRef.current = Date.now();
  }, []);

  // Load sanitized book content (prefers IndexedDB offline copy if present)
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    libraryApi
      .getReaderContent(book, edition.editionId)
      .then((res) => {
        if (!active) return;
        setContent(res);
        if (res.chapters.length > 0 && chapterIndex >= res.chapters.length) {
          setChapterIndex(0);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to load book text.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [book, edition.editionId]);

  const currentChapter = content?.chapters[chapterIndex] || null;
  const totalChapters = content?.chapters.length || 0;

  const chapterHighlights = useMemo(
    () => highlights.filter((h) => h.chapterIndex === chapterIndex),
    [chapterIndex, highlights],
  );

  // Genuine active reading time tracker (pauses when hidden or idle > 60s)
  useEffect(() => {
    if (loading || loadError || !currentChapter || !content?.readableInApp) return;
    const onVisChange = () => {
      if (!document.hidden) markUserActive();
    };
    document.addEventListener('visibilitychange', onVisChange);

    const interval = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActivityMsRef.current > 60_000) return;
      const isNewSession = !sessionStartedRef.current;
      sessionStartedRef.current = true;
      onActiveReadingSeconds(15, isNewSession);
    }, 15000);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [content?.readableInApp, currentChapter, loadError, loading, markUserActive, onActiveReadingSeconds]);

  // Apply sanitized chapter HTML + restore highlights cleanly in DOM without mutating on unrelated re-renders
  const isDarkSurface = preferences.readerTheme === 'dark';
  useLayoutEffect(() => {
    const proseEl = proseRef.current;
    if (!proseEl || !currentChapter) return;
    proseEl.innerHTML = currentChapter.html;
    applyHighlightsToDom(proseEl, chapterHighlights, isDarkSurface);
  }, [chapterHighlights, currentChapter, isDarkSurface, preferences.layoutMode]);

  const computePercentComplete = useCallback(
    (chapIdx: number, ratio: number, total: number) => {
      if (total <= 0) return 0;
      return Math.min(100, Math.max(1, ((chapIdx + ratio) / total) * 100));
    },
    [],
  );

  const persistProgressNow = useCallback(
    (chapIdx: number, ratio: number) => {
      if (!content || totalChapters === 0) return;
      onSaveProgress({
        bookId: book.id,
        editionId: content.editionId,
        chapterIndex: chapIdx,
        totalChapters,
        scrollRatio: Math.max(0, Math.min(1, ratio)),
        percentComplete: computePercentComplete(chapIdx, ratio, totalChapters),
        lastReadAt: new Date().toISOString(),
        book,
      });
    },
    [book, computePercentComplete, content, onSaveProgress, totalChapters],
  );

  // Scroll directly to pending jumped highlight or saved scroll ratio
  useEffect(() => {
    if (!currentChapter) return;
    const proseEl = proseRef.current;

    if (pendingHighlightId && proseEl) {
      const targetMark = proseEl.querySelector(
        `mark[data-folio-highlight="${pendingHighlightId}"]`,
      ) as HTMLElement | null;
      if (targetMark) {
        if (preferences.layoutMode === 'scroll') {
          targetMark.scrollIntoView({behavior: 'smooth', block: 'center'});
          setPendingHighlightId(null);
          return;
        } else if (pageBoxRef.current && paginatedTrackRef.current && pageDims.width > 0) {
          const boxRect = pageBoxRef.current.getBoundingClientRect();
          const markRect = targetMark.getBoundingClientRect();
          const offsetFromTrackStart =
            markRect.left - boxRect.left + currentPage * (pageDims.width + PAGE_GAP);
          const targetPage = Math.max(
            0,
            Math.min(
              totalPages - 1,
              Math.floor(offsetFromTrackStart / (pageDims.width + PAGE_GAP)),
            ),
          );
          setCurrentPage(targetPage);
          setPendingHighlightId(null);
          return;
        }
      }
      setPendingHighlightId(null);
    }

    if (preferences.layoutMode !== 'scroll') return;
    const el = scrollRef.current;
    if (!el) return;
    if (restoredChapterRef.current === chapterIndex) return;

    restoredChapterRef.current = chapterIndex;
    const targetRatio =
      initialProgress && initialProgress.chapterIndex === chapterIndex
        ? initialProgress.scrollRatio
        : scrollRatio;

    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = maxScroll * targetRatio;
      setScrollRatio(targetRatio);
    });
  }, [
    chapterIndex,
    currentChapter,
    currentPage,
    initialProgress,
    pageDims.width,
    pendingHighlightId,
    preferences.layoutMode,
    scrollRatio,
    totalPages,
  ]);

  // Measure paginated container bounds cleanly on mount, resize, or margin changes
  useEffect(() => {
    if (preferences.layoutMode !== 'paginated') return;
    const box = pageBoxRef.current;
    if (!box) return;

    const updateDims = () => {
      const w = Math.max(240, box.clientWidth);
      const h = Math.max(260, box.clientHeight);
      setPageDims({width: w, height: h});
    };
    updateDims();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateDims);
      ro.observe(box);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateDims);
    return () => window.removeEventListener('resize', updateDims);
  }, [preferences.layoutMode, preferences.marginWidth, controlsVisible, currentChapter]);

  // Recompute total pages in paginated mode whenever typography or dimensions change
  useLayoutEffect(() => {
    if (preferences.layoutMode !== 'paginated' || !currentChapter) return;
    const track = paginatedTrackRef.current;
    if (!track || pageDims.width <= 0) return;

    const measuredPages = Math.max(
      1,
      Math.round((track.scrollWidth + PAGE_GAP) / (pageDims.width + PAGE_GAP)),
    );
    setTotalPages(measuredPages);

    if (restoredChapterRef.current !== chapterIndex) {
      restoredChapterRef.current = chapterIndex;
      const targetRatio =
        initialProgress && initialProgress.chapterIndex === chapterIndex
          ? initialProgress.scrollRatio
          : scrollRatio;
      const targetPage =
        measuredPages > 1 ? Math.round(targetRatio * (measuredPages - 1)) : 0;
      setCurrentPage(Math.max(0, Math.min(measuredPages - 1, targetPage)));
    } else {
      setCurrentPage((prev) => Math.max(0, Math.min(measuredPages - 1, prev)));
    }
  }, [
    chapterIndex,
    currentChapter,
    initialProgress,
    pageDims.height,
    pageDims.width,
    preferences.fontFamily,
    preferences.fontSize,
    preferences.layoutMode,
    preferences.letterSpacing,
    preferences.lineHeight,
    preferences.marginWidth,
    preferences.textAlign,
  ]);

  const handleScroll = () => {
    markUserActive();
    if (preferences.layoutMode !== 'scroll') return;
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
    setScrollRatio(ratio);

    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      persistProgressNow(chapterIndex, ratio);
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        window.clearTimeout(progressTimerRef.current);
      }
    };
  }, []);

  // Listen to native text selection changes inside reader prose cleanly
  useEffect(() => {
    let timer: number | null = null;
    const onSelectionChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const proseEl = proseRef.current;
        if (!proseEl) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionPending(null);
          return;
        }
        const range = sel.getRangeAt(0);
        if (!proseEl.contains(range.commonAncestorContainer)) {
          return;
        }
        const anchor = extractSelectionAnchor(proseEl, range);
        if (anchor && anchor.quote.length >= 1) {
          markUserActive();
          setSelectionPending(anchor);
        } else {
          setSelectionPending(null);
        }
      }, 140);
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (timer) window.clearTimeout(timer);
    };
  }, [markUserActive]);

  const clearSelection = () => {
    setSelectionPending(null);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
  };

  const openDictionaryLookup = useCallback(async (rawWord: string) => {
    const clean = extractSingleWord(rawWord) || rawWord.trim();
    if (!clean) return;
    setSelectionPending(null);
    setDictState({
      open: true,
      word: clean,
      loading: true,
      entry: null,
      error: null,
    });
    try {
      const entry = await libraryApi.lookupWord(clean);
      setDictState({
        open: true,
        word: clean,
        loading: false,
        entry,
        error: null,
      });
    } catch (err) {
      const offlineMsg =
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'Dictionary requires an internet connection. Your offline books, highlights, and notes remain accessible.'
          : err instanceof Error
            ? err.message
            : 'Unable to look up word definition.';
      setDictState({
        open: true,
        word: clean,
        loading: false,
        entry: null,
        error: offlineMsg,
      });
    }
  }, []);

  const handleQuickHighlight = (color: HighlightColor) => {
    if (!selectionPending || !currentChapter || !content) return;
    const now = new Date().toISOString();
    onSaveHighlight({
      id: `${book.id}-hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bookId: book.id,
      editionId: content.editionId,
      chapterIndex,
      chapterTitle: currentChapter.title,
      quote: selectionPending.quote,
      prefix: selectionPending.prefix,
      suffix: selectionPending.suffix,
      startOffset: selectionPending.startOffset,
      endOffset: selectionPending.endOffset,
      scrollRatio,
      color,
      createdAt: now,
      updatedAt: now,
    });
    clearSelection();
  };

  const handleOpenNoteComposerFromSelection = () => {
    if (!selectionPending) return;
    setNoteModal({
      mode: 'new',
      anchor: selectionPending,
      quote: selectionPending.quote,
      color: 'amber',
      note: '',
    });
    clearSelection();
  };

  const handleProseSurfaceClick = (e: React.MouseEvent): boolean => {
    markUserActive();
    const target = e.target as HTMLElement;
    const markEl = target.closest('mark[data-folio-highlight]') as HTMLElement | null;
    if (markEl) {
      const hlId = markEl.getAttribute('data-folio-highlight');
      const existing = highlights.find((h) => h.id === hlId);
      if (existing) {
        setNoteModal({
          mode: 'edit',
          existingId: existing.id,
          quote: existing.quote,
          color: existing.color,
          note: existing.note || '',
        });
        return true;
      }
    }

    if (tapToDefineMode && proseRef.current && target.closest('.reader-prose')) {
      const word = getWordAtPoint(e.clientX, e.clientY, proseRef.current);
      if (word) {
        void openDictionaryLookup(word);
        return true;
      }
    }
    return false;
  };

  const goToChapter = useCallback(
    (nextIdx: number, targetScrollRatio = 0, highlightIdToScroll?: string) => {
      if (nextIdx < 0 || nextIdx >= totalChapters) return;
      markUserActive();
      restoredChapterRef.current = null;
      setChapterIndex(nextIdx);
      setScrollRatio(targetScrollRatio);
      setCurrentPage(0);
      setPendingHighlightId(highlightIdToScroll || null);
      setActiveDrawer('none');
      clearSelection();
      persistProgressNow(nextIdx, targetScrollRatio);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
          el.scrollTop = maxScroll * targetScrollRatio;
        }
      });
    },
    [markUserActive, persistProgressNow, totalChapters],
  );

  const goToPage = useCallback(
    (nextPage: number) => {
      markUserActive();
      const clamped = Math.max(0, Math.min(totalPages - 1, nextPage));
      setCurrentPage(clamped);
      const nextRatio = totalPages > 1 ? clamped / (totalPages - 1) : 0;
      setScrollRatio(nextRatio);
      persistProgressNow(chapterIndex, nextRatio);
    },
    [chapterIndex, markUserActive, persistProgressNow, totalPages],
  );

  const goNextPage = useCallback(() => {
    if (currentPage < totalPages - 1) {
      goToPage(currentPage + 1);
    } else if (chapterIndex < totalChapters - 1) {
      goToChapter(chapterIndex + 1, 0);
    }
  }, [chapterIndex, currentPage, goToChapter, goToPage, totalChapters, totalPages]);

  const goPrevPage = useCallback(() => {
    if (currentPage > 0) {
      goToPage(currentPage - 1);
    } else if (chapterIndex > 0) {
      goToChapter(chapterIndex - 1, 0.99);
    }
  }, [chapterIndex, currentPage, goToChapter, goToPage]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noteModal || dictState.open) {
        if (e.key === 'Escape') {
          setNoteModal(null);
          setDictState((prev) => ({...prev, open: false}));
        }
        return;
      }
      if (activeDrawer !== 'none') {
        if (e.key === 'Escape') setActiveDrawer('none');
        return;
      }
      if (preferences.layoutMode === 'paginated') {
        if (e.key === 'ArrowRight' || e.key === ' ') {
          e.preventDefault();
          goNextPage();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goPrevPage();
        }
      } else {
        if (e.key === 'ArrowRight' && chapterIndex < totalChapters - 1) {
          goToChapter(chapterIndex + 1);
        } else if (e.key === 'ArrowLeft' && chapterIndex > 0) {
          goToChapter(chapterIndex - 1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeDrawer,
    chapterIndex,
    dictState.open,
    goNextPage,
    goPrevPage,
    goToChapter,
    noteModal,
    preferences.layoutMode,
    totalChapters,
  ]);

  const updateCustomPref = (patch: Partial<ReaderPreferences>) => {
    onUpdatePreferences({
      ...preferences,
      ...patch,
      preset: 'custom',
    });
  };

  const handleToggleFullscreen = async () => {
    if (typeof document !== 'undefined' && document.fullscreenEnabled) {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
          setControlsVisible(false);
        } else {
          await document.exitFullscreen();
          setIsFullscreen(false);
          setControlsVisible(true);
        }
        return;
      } catch {
        // Fallback below if browser blocks fullscreen API
      }
    }
    setIsFullscreen((v) => !v);
    setControlsVisible((v) => !v);
  };

  const handleAddBookmarkHere = () => {
    if (!currentChapter || !content) return;
    const container = scrollRef.current || paginatedTrackRef.current;
    let excerpt = currentChapter.title;
    if (container) {
      const paras = Array.from(container.querySelectorAll('.reader-prose p'));
      const midY = window.innerHeight * 0.35;
      const visiblePara =
        paras.find((p) => p.getBoundingClientRect().bottom >= midY) || paras[0];
      if (visiblePara?.textContent) {
        excerpt = visiblePara.textContent.trim().slice(0, 140);
      }
    }

    onAddBookmark({
      id: `${book.id}-${Date.now()}`,
      bookId: book.id,
      editionId: content.editionId,
      chapterIndex,
      chapterTitle: currentChapter.title,
      scrollRatio,
      excerpt,
      createdAt: new Date().toISOString(),
    });
  };

  const theme = READER_THEMES[preferences.readerTheme];
  const fontClass =
    FONT_OPTIONS.find((f) => f.id === preferences.fontFamily)?.className || 'font-prose';

  const marginClass =
    preferences.marginWidth === 'compact'
      ? 'max-w-3xl px-4 sm:px-6'
      : preferences.marginWidth === 'generous'
        ? 'max-w-xl px-6 sm:px-10'
        : 'max-w-2xl px-5 sm:px-8';

  const percentDisplay = useMemo(
    () => Math.round(computePercentComplete(chapterIndex, scrollRatio, totalChapters)),
    [chapterIndex, computePercentComplete, scrollRatio, totalChapters],
  );

  const hasBookmarkNearHere = bookmarks.some(
    (b) => b.chapterIndex === chapterIndex && Math.abs(b.scrollRatio - scrollRatio) < 0.08,
  );

  const singleSelectedWord = selectionPending ? extractSingleWord(selectionPending.quote) : null;
  const showFooterBar =
    controlsVisible && (preferences.showProgress || preferences.layoutMode === 'paginated');

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${theme.bg} ${theme.text} transition-colors duration-200`}
      onTouchStart={markUserActive}
      onPointerDown={markUserActive}
    >
      {/* Top Reader Bar */}
      <header
        className={`fixed top-0 inset-x-0 z-30 pt-safe border-b ${theme.border} ${theme.bg}/95 backdrop-blur-md transition-transform duration-200 ${
          controlsVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="max-w-4xl mx-auto px-3 sm:px-5 h-14 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              persistProgressNow(chapterIndex, scrollRatio);
              onClose();
            }}
            aria-label="Exit reader"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs font-medium truncate">{book.title}</p>
            {currentChapter && (
              <p className={`text-[11px] truncate ${theme.muted}`}>{currentChapter.title}</p>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setTapToDefineMode((v) => !v)}
              aria-label={tapToDefineMode ? 'Disable tap-word dictionary' : 'Enable tap-word dictionary'}
              title={tapToDefineMode ? 'Tap-to-Define active' : 'Tap any word to define'}
              className={`min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
                tapToDefineMode
                  ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210]'
                  : 'hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              <BookA className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                persistProgressNow(chapterIndex, scrollRatio);
                onSwitchToListen(book, edition, chapterIndex, scrollRatio);
              }}
              aria-label="Listen to this book"
              title="Switch to Listening"
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Headphones className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDrawer(activeDrawer === 'toc' ? 'none' : 'toc');
              }}
              aria-label="Chapters, bookmarks, and notes"
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleAddBookmarkHere}
              aria-label="Bookmark this page"
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Bookmark
                className={`w-4 h-4 ${
                  hasBookmarkNearHere
                    ? 'fill-[#9A3412] text-[#9A3412] dark:fill-[#E07A5F] dark:text-[#E07A5F]'
                    : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => setActiveDrawer(activeDrawer === 'typography' ? 'none' : 'typography')}
              aria-label="Reading preferences"
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Type className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              aria-label={
                isFullscreen ? 'Exit distraction-free view' : 'Enter distraction-free view'
              }
              className="hidden sm:flex min-h-[44px] min-w-[40px] items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Subtle tap hint when controls hidden */}
      {!controlsVisible && (
        <button
          type="button"
          onClick={() => setControlsVisible(true)}
          aria-label="Show reading controls"
          className="fixed top-3 right-3 z-30 min-h-[36px] px-3 rounded-full bg-black/10 dark:bg-white/10 backdrop-blur-sm text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity"
        >
          Menu
        </button>
      )}

      {/* Subtle active Tap-to-Define indicator */}
      {tapToDefineMode && controlsVisible && (
        <div className="fixed top-16 inset-x-0 z-20 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-[11px] font-medium shadow-md">
            <span>Tap any word to define · Select phrase to highlight</span>
            <button
              type="button"
              onClick={() => setTapToDefineMode(false)}
              className="opacity-80 hover:opacity-100"
              aria-label="Turn off tap to define"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Surface: Scroll Mode OR Paginated Mode */}
      {loading || loadError || (content && !content.readableInApp) ? (
        <div className="flex-1 overflow-y-auto pt-20 pb-24">
          {loading ? (
            <div className={`mx-auto ${marginClass} py-16 space-y-4`}>
              <div className="h-7 w-2/3 rounded bg-current opacity-10 animate-pulse" />
              <div className="h-4 w-full rounded bg-current opacity-10 animate-pulse" />
              <div className="h-4 w-11/12 rounded bg-current opacity-10 animate-pulse" />
              <div className="h-4 w-4/5 rounded bg-current opacity-10 animate-pulse" />
              <p className={`text-sm pt-4 ${theme.muted}`}>
                Preparing formatted chapters from {edition.providerLabel}...
              </p>
            </div>
          ) : loadError ? (
            <div className={`mx-auto ${marginClass} py-16 space-y-4`}>
              <h2 className="font-display text-2xl font-semibold">Unable to Load Text</h2>
              <p className={`text-sm leading-relaxed ${theme.muted}`}>{loadError}</p>
              <div className="pt-2 flex flex-wrap gap-3">
                <a
                  href={edition.externalReadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-lg bg-[#1E3A5F] text-white text-sm font-medium"
                >
                  <span>Open Official Source</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className={`min-h-[44px] px-5 py-2.5 rounded-lg border ${theme.border} text-sm font-medium`}
                >
                  Return to Details
                </button>
              </div>
            </div>
          ) : content && !content.readableInApp ? (
            <div className={`mx-auto ${marginClass} py-16 space-y-5`}>
              <p className={`text-xs uppercase tracking-widest ${theme.muted}`}>
                {content.providerLabel}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-balance">
                Read Directly at Verified Source
              </h2>
              <p className={`text-base leading-relaxed ${theme.muted}`}>
                {content.unavailableReason ||
                  'This edition is hosted externally without reflowable HTML/EPUB.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={content.externalReadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 min-h-[48px] px-6 py-3 rounded-lg bg-[#1E3A5F] text-white text-sm font-medium"
                >
                  <span>Read Free at {content.providerLabel}</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
                {(book.audiobooks?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onSwitchToListen(book, edition, 0, 0)}
                    className={`inline-flex items-center gap-2 min-h-[48px] px-5 py-3 rounded-lg border ${theme.border} text-sm font-medium`}
                  >
                    <Headphones className="w-4 h-4" />
                    <span>Listen to LibriVox Audiobook</span>
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : preferences.layoutMode === 'paginated' && currentChapter ? (
        /* Paginated Page-by-Page Surface */
        <div
          className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${
            controlsVisible ? 'pt-16 pb-12' : 'pt-5 pb-5'
          }`}
          onTouchStart={(e) => {
            touchStartXRef.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            if (touchStartXRef.current === null) return;
            const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartXRef.current;
            touchStartXRef.current = null;
            if (Math.abs(dx) > 45) {
              if (dx < 0) goNextPage();
              else goPrevPage();
            }
          }}
          onClick={(e) => {
            const sel = window.getSelection();
            if (sel && sel.toString().length > 0) return;
            if ((e.target as HTMLElement).closest('button, a')) return;
            if (handleProseSurfaceClick(e)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            if (relX < 0.25) {
              goPrevPage();
            } else if (relX > 0.75) {
              goNextPage();
            } else {
              setControlsVisible((v) => !v);
            }
          }}
        >
          <div ref={pageBoxRef} className={`flex-1 w-full mx-auto ${marginClass} overflow-hidden py-2`}>
            <div
              ref={paginatedTrackRef}
              style={{
                columnWidth: `${pageDims.width}px`,
                columnGap: `${PAGE_GAP}px`,
                columnFill: 'auto',
                height: `${pageDims.height}px`,
                width: `${pageDims.width}px`,
                transform: `translateX(-${currentPage * (pageDims.width + PAGE_GAP)}px)`,
                transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <header className={`mb-6 pb-4 border-b ${theme.border} break-inside-avoid`}>
                <p className={`text-xs uppercase tracking-[0.15em] ${theme.muted} tabular-nums`}>
                  Chapter {chapterIndex + 1} of {totalChapters}
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold mt-1.5 leading-tight text-balance">
                  {currentChapter.title}
                </h1>
              </header>

              <div
                ref={proseRef}
                className={`reader-prose ${fontClass}`}
                style={{
                  fontSize: `${preferences.fontSize}px`,
                  lineHeight: preferences.lineHeight,
                  letterSpacing: `${preferences.letterSpacing}em`,
                  textAlign: preferences.textAlign,
                }}
              />
            </div>
          </div>
        </div>
      ) : currentChapter ? (
        /* Continuous Vertical Scroll Surface */
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={(e) => {
            const sel = window.getSelection();
            if (sel && sel.toString().length > 0) return;
            if ((e.target as HTMLElement).closest('button, a')) return;
            if (handleProseSurfaceClick(e)) return;
            setControlsVisible((v) => !v);
          }}
          className={`flex-1 overflow-y-auto ${controlsVisible ? 'pt-20 pb-24' : 'pt-8 pb-12'}`}
        >
          <article className={`mx-auto ${marginClass} py-4 sm:py-8`}>
            <header className={`mb-8 pb-6 border-b ${theme.border}`}>
              <p className={`text-xs uppercase tracking-[0.15em] ${theme.muted} tabular-nums`}>
                Chapter {chapterIndex + 1} of {totalChapters} ·{' '}
                {Math.max(1, Math.round(currentChapter.wordCount / 220))} min read
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold mt-2 leading-tight text-balance">
                {currentChapter.title}
              </h1>
            </header>

            <div
              ref={proseRef}
              className={`reader-prose ${fontClass}`}
              style={{
                fontSize: `${preferences.fontSize}px`,
                lineHeight: preferences.lineHeight,
                letterSpacing: `${preferences.letterSpacing}em`,
                textAlign: preferences.textAlign,
              }}
            />

            {/* End-of-chapter navigation */}
            <nav
              aria-label="Chapter navigation"
              className={`mt-14 pt-8 border-t ${theme.border} flex items-center justify-between gap-4`}
            >
              <button
                type="button"
                disabled={chapterIndex === 0}
                onClick={() => goToChapter(chapterIndex - 1)}
                className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-lg border ${theme.border} text-sm font-medium disabled:opacity-35`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <span className={`text-xs tabular-nums ${theme.muted}`}>
                {chapterIndex + 1} / {totalChapters}
              </span>

              <button
                type="button"
                disabled={chapterIndex >= totalChapters - 1}
                onClick={() => goToChapter(chapterIndex + 1)}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-5 py-2 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-sm font-medium disabled:opacity-35"
              >
                <span>Next Chapter</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </nav>
          </article>
        </div>
      ) : null}

      {/* Contextual Text Selection Floating Bar (Dictionary + Highlight Colors + Note) */}
      {selectionPending && !noteModal && (
        <div className="fixed bottom-16 inset-x-0 z-40 px-4 flex justify-center pointer-events-none">
          <div
            onClick={(e) => e.stopPropagation()}
            className={`pointer-events-auto flex flex-wrap items-center gap-1.5 p-2 rounded-2xl border ${theme.border} ${theme.surface} ${theme.text} shadow-2xl max-w-md`}
          >
            {singleSelectedWord && (
              <button
                type="button"
                onClick={() => void openDictionaryLookup(singleSelectedWord)}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium"
              >
                <BookA className="w-3.5 h-3.5" />
                <span>Define “{singleSelectedWord}”</span>
              </button>
            )}

            <div className="flex items-center gap-1 px-1">
              {(Object.keys(HIGHLIGHT_SWATCHES) as HighlightColor[]).map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleQuickHighlight(color)}
                  aria-label={`Highlight in ${HIGHLIGHT_SWATCHES[color].label}`}
                  title={`Highlight ${HIGHLIGHT_SWATCHES[color].label}`}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span
                    className={`w-5 h-5 rounded-full border border-black/20 dark:border-white/25 ${HIGHLIGHT_SWATCHES[color].dotClass}`}
                  />
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleOpenNoteComposerFromSelection}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border ${theme.border} text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10`}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Note</span>
            </button>

            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear text selection"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Reading Progress / Pagination Bar */}
      <footer
        className={`fixed bottom-0 inset-x-0 z-30 pb-safe border-t ${theme.border} ${theme.bg}/95 backdrop-blur-md transition-transform duration-200 ${
          showFooterBar ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="max-w-4xl mx-auto px-3 sm:px-6 h-12 flex items-center justify-between gap-3 text-xs">
          {preferences.layoutMode === 'paginated' ? (
            <>
              <button
                type="button"
                onClick={goPrevPage}
                disabled={currentPage === 0 && chapterIndex === 0}
                className="inline-flex items-center gap-1 min-h-[40px] px-2.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className={`tabular-nums ${theme.muted}`}>
                Page {currentPage + 1} of {totalPages}
                {preferences.showProgress ? ` · ${percentDisplay}%` : ''}
              </span>

              <button
                type="button"
                onClick={goNextPage}
                disabled={currentPage >= totalPages - 1 && chapterIndex >= totalChapters - 1}
                className="inline-flex items-center gap-1 min-h-[40px] px-2.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 font-medium"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <span className={`truncate ${theme.muted}`}>
                {content?.providerLabel || edition.providerLabel}
              </span>
              {preferences.showProgress && (
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-24 sm:w-36 h-1 rounded-full bg-current/15 overflow-hidden">
                    <div
                      className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1]"
                      style={{width: `${percentDisplay}%`}}
                    />
                  </div>
                  <span className={`tabular-nums font-medium ${theme.muted}`}>{percentDisplay}%</span>
                </div>
              )}
            </>
          )}
        </div>
      </footer>

      {/* Dictionary Bottom Sheet / Popover */}
      {dictState.open && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDictState((prev) => ({...prev, open: false}))}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Dictionary definition"
            onClick={(e) => e.stopPropagation()}
            className={`w-full sm:max-w-lg max-h-[78vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl ${theme.bg} ${theme.text} border ${theme.border} p-5 sm:p-6 pb-8 shadow-2xl space-y-4`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[11px] uppercase tracking-[0.14em] ${theme.muted}`}>
                  Reader Dictionary
                </p>
                <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                  <h2 className="font-display text-2xl font-semibold">
                    {dictState.entry?.word || dictState.word}
                  </h2>
                  {dictState.entry?.phonetic && (
                    <span className={`text-sm font-mono ${theme.muted}`}>
                      {dictState.entry.phonetic}
                    </span>
                  )}
                  {dictState.entry?.audioUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const audio = new Audio(dictState.entry!.audioUrl);
                        void audio.play().catch(() => {});
                      }}
                      aria-label="Play word pronunciation"
                      className={`inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border ${theme.border} text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Pronounce</span>
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDictState((prev) => ({...prev, open: false}))}
                aria-label="Close dictionary"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {dictState.loading ? (
              <div className="py-8 flex items-center gap-3 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className={theme.muted}>Looking up “{dictState.word}”...</span>
              </div>
            ) : dictState.error ? (
              <div className={`p-4 rounded-xl ${theme.surface} border ${theme.border} space-y-2`}>
                <p className="text-sm leading-relaxed">{dictState.error}</p>
              </div>
            ) : dictState.entry ? (
              <div className="space-y-4">
                {dictState.entry.meanings.map((meaning, idx) => (
                  <div key={`${meaning.partOfSpeech}-${idx}`} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#1E3A5F] dark:text-[#7BA3D1]">
                      {meaning.partOfSpeech}
                    </p>
                    <ol className="space-y-2.5 list-decimal list-inside text-sm leading-relaxed">
                      {meaning.definitions.map((d, dIdx) => (
                        <li key={dIdx} className="space-y-1">
                          <span>{d.definition}</span>
                          {d.example && (
                            <p className={`pl-5 text-xs italic font-prose ${theme.muted}`}>
                              “{d.example}”
                            </p>
                          )}
                          {d.synonyms && d.synonyms.length > 0 && (
                            <p className={`pl-5 text-[11px] ${theme.muted}`}>
                              Similar: {d.synonyms.join(', ')}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}

                <div className={`pt-3 border-t ${theme.border} flex items-center justify-between text-[11px] ${theme.muted}`}>
                  <span>Source: {dictState.entry.sourceLabel}</span>
                  <a
                    href={dictState.entry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <span>Reference</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Highlight & Personal Note Editor Sheet */}
      {noteModal && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setNoteModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Highlight and personal note"
            onClick={(e) => e.stopPropagation()}
            className={`w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl ${theme.bg} ${theme.text} border ${theme.border} p-5 sm:p-6 pb-8 shadow-2xl space-y-4`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                {noteModal.mode === 'edit' ? 'Edit Highlight & Note' : 'Highlight & Personal Note'}
              </h2>
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                aria-label="Close note editor"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <blockquote
              className={`p-3 rounded-lg ${theme.surface} border-l-4 ${HIGHLIGHT_SWATCHES[noteModal.color].borderClass} font-prose text-sm italic line-clamp-4`}
            >
              “{noteModal.quote}”
            </blockquote>

            <div className="space-y-1.5">
              <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Highlight Color</p>
              <div className="flex items-center gap-2">
                {(Object.keys(HIGHLIGHT_SWATCHES) as HighlightColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNoteModal({...noteModal, color: c})}
                    className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border text-xs font-medium ${
                      noteModal.color === c
                        ? 'border-[#1E3A5F] dark:border-[#7BA3D1] ring-1 ring-[#1E3A5F] dark:ring-[#7BA3D1]'
                        : theme.border
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full ${HIGHLIGHT_SWATCHES[c].dotClass}`} />
                    <span>{HIGHLIGHT_SWATCHES[c].label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reader-highlight-note" className={`block text-xs uppercase tracking-wider ${theme.muted}`}>
                Personal Note (Optional)
              </label>
              <textarea
                id="reader-highlight-note"
                rows={3}
                value={noteModal.note}
                onChange={(e) => setNoteModal({...noteModal, note: e.target.value})}
                placeholder="Write a reflection, question, or takeaway to revisit in your Reading Notebook..."
                className={`w-full p-3 rounded-xl bg-transparent border ${theme.border} text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] dark:focus:ring-[#7BA3D1]`}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              {noteModal.mode === 'edit' && noteModal.existingId ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteHighlight(noteModal.existingId!);
                    setNoteModal(null);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#9A3412]/40 text-[#9A3412] dark:text-[#E07A5F] text-xs font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Highlight</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {extractSingleWord(noteModal.quote) && (
                  <button
                    type="button"
                    onClick={() => {
                      const w = extractSingleWord(noteModal.quote)!;
                      setNoteModal(null);
                      void openDictionaryLookup(w);
                    }}
                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border ${theme.border} text-xs font-medium`}
                  >
                    <BookA className="w-4 h-4" />
                    <span>Define</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!currentChapter || !content) return;
                    const now = new Date().toISOString();
                    if (noteModal.mode === 'edit' && noteModal.existingId) {
                      const prev = highlights.find((h) => h.id === noteModal.existingId);
                      if (prev) {
                        onSaveHighlight({
                          ...prev,
                          color: noteModal.color,
                          note: noteModal.note.trim() || undefined,
                          updatedAt: now,
                        });
                      }
                    } else if (noteModal.anchor) {
                      onSaveHighlight({
                        id: `${book.id}-hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        bookId: book.id,
                        editionId: content.editionId,
                        chapterIndex,
                        chapterTitle: currentChapter.title,
                        quote: noteModal.anchor.quote,
                        prefix: noteModal.anchor.prefix,
                        suffix: noteModal.anchor.suffix,
                        startOffset: noteModal.anchor.startOffset,
                        endOffset: noteModal.anchor.endOffset,
                        scrollRatio,
                        color: noteModal.color,
                        note: noteModal.note.trim() || undefined,
                        createdAt: now,
                        updatedAt: now,
                      });
                    }
                    setNoteModal(null);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] text-xs font-medium"
                >
                  <Check className="w-4 h-4" />
                  <span>Save</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table of Contents, Bookmarks & Notes Drawer */}
      {activeDrawer === 'toc' && (
        <div
          className="fixed inset-0 z-40 bg-black/45 flex justify-end"
          onClick={() => setActiveDrawer('none')}
        >
          <div
            className={`w-full max-w-md h-full ${theme.bg} ${theme.text} border-l ${theme.border} flex flex-col shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-4 py-3.5 border-b ${theme.border} flex items-center justify-between gap-2`}>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-black/5 dark:bg-white/5 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setTocTab('chapters')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium min-h-[34px] whitespace-nowrap ${
                    tocTab === 'chapters' ? `${theme.bg} shadow-sm` : theme.muted
                  }`}
                >
                  Chapters ({totalChapters})
                </button>
                <button
                  type="button"
                  onClick={() => setTocTab('highlights')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium min-h-[34px] whitespace-nowrap ${
                    tocTab === 'highlights' ? `${theme.bg} shadow-sm` : theme.muted
                  }`}
                >
                  Highlights ({highlights.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTocTab('bookmarks')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium min-h-[34px] whitespace-nowrap ${
                    tocTab === 'bookmarks' ? `${theme.bg} shadow-sm` : theme.muted
                  }`}
                >
                  Bookmarks ({bookmarks.length})
                </button>
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer('none')}
                aria-label="Close drawer"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-current/10">
              {tocTab === 'chapters' ? (
                content?.chapters.map((ch) => (
                  <button
                    key={ch.index}
                    type="button"
                    onClick={() => goToChapter(ch.index)}
                    className={`w-full text-left px-5 py-3.5 min-h-[52px] flex items-center justify-between gap-4 hover:bg-black/5 dark:hover:bg-white/5 ${
                      ch.index === chapterIndex
                        ? 'font-semibold text-[#1E3A5F] dark:text-[#7BA3D1]'
                        : ''
                    }`}
                  >
                    <span className="text-sm line-clamp-2">{ch.title}</span>
                    <span className={`text-xs tabular-nums shrink-0 ${theme.muted}`}>
                      {Math.max(1, Math.round(ch.wordCount / 220))}m
                    </span>
                  </button>
                ))
              ) : tocTab === 'highlights' ? (
                highlights.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <Highlighter className="w-6 h-6 mx-auto opacity-45" />
                    <p className={`text-sm ${theme.muted}`}>
                      Select any sentence or phrase inside the book to highlight it and attach personal notes.
                    </p>
                  </div>
                ) : (
                  highlights.map((hl) => (
                    <div key={hl.id} className="px-5 py-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => goToChapter(hl.chapterIndex, hl.scrollRatio, hl.id)}
                          className="text-left flex-1 space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${HIGHLIGHT_SWATCHES[hl.color].dotClass}`}
                            />
                            <p className="text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] line-clamp-1">
                              {hl.chapterTitle}
                            </p>
                          </div>
                          <p className="text-sm font-prose line-clamp-3 leading-relaxed">
                            “{hl.quote}”
                          </p>
                          {hl.note && (
                            <p className={`text-xs ${theme.muted} italic`}>
                              Note: {hl.note}
                            </p>
                          )}
                        </button>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setNoteModal({
                                mode: 'edit',
                                existingId: hl.id,
                                quote: hl.quote,
                                color: hl.color,
                                note: hl.note || '',
                              })
                            }
                            aria-label="Edit note"
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center opacity-70 hover:opacity-100"
                          >
                            <MessageSquarePlus className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteHighlight(hl.id)}
                            aria-label="Delete highlight"
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center opacity-60 hover:text-[#9A3412]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )
              ) : bookmarks.length === 0 ? (
                <div className="p-8 text-center">
                  <p className={`text-sm ${theme.muted}`}>
                    No bookmarks yet. Tap the ribbon icon in the top bar to mark your place.
                  </p>
                </div>
              ) : (
                bookmarks.map((bm) => (
                  <div key={bm.id} className="px-5 py-4 flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => goToChapter(bm.chapterIndex, bm.scrollRatio)}
                      className="text-left flex-1 space-y-1"
                    >
                      <p className="text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1]">
                        {bm.chapterTitle}
                      </p>
                      <p className={`text-sm font-prose line-clamp-2 ${theme.muted}`}>
                        “{bm.excerpt}”
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteBookmark(bm.id)}
                      aria-label="Delete bookmark"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-stone-400 hover:text-[#9A3412]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full Personalized Reading Preferences & Presets Sheet */}
      {activeDrawer === 'typography' && (
        <div
          className="fixed inset-0 z-40 bg-black/45 flex items-end sm:items-center justify-center"
          onClick={() => setActiveDrawer('none')}
        >
          <div
            className={`w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl ${theme.bg} ${theme.text} border ${theme.border} p-5 sm:p-6 pb-8 space-y-5 shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Reading Preferences</h2>
                <p className={`text-[11px] ${theme.muted}`}>
                  Active preset:{' '}
                  <span className="font-semibold capitalize">{preferences.preset}</span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onUpdatePreferences({
                      ...DEFAULT_PREFERENCES,
                      appTheme: preferences.appTheme,
                      playbackRate: preferences.playbackRate,
                      preferredVoiceURI: preferences.preferredVoiceURI,
                    });
                  }}
                  className={`inline-flex items-center gap-1 min-h-[38px] px-3 rounded-lg border ${theme.border} text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDrawer('none')}
                  aria-label="Close reading preferences"
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Personal Reading Presets */}
            <div className="space-y-2">
              <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Reading Presets</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESET_CARDS.map((p) => {
                  const active = preferences.preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const applied = applyReaderPreset(preferences, p.id);
                        onUpdatePreferences(applied);
                        if (p.id === 'focus') {
                          setControlsVisible(false);
                          setActiveDrawer('none');
                        }
                      }}
                      className={`min-h-[52px] px-3 py-2 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                          : `${theme.border} hover:bg-black/5 dark:hover:bg-white/5`
                      }`}
                    >
                      <span className="block text-xs font-semibold">{p.label}</span>
                      <span className={`block text-[10px] ${active ? 'opacity-85' : theme.muted}`}>
                        {p.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Screen Theme */}
            <div className="space-y-2">
              <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Screen Theme</p>
              <div className="grid grid-cols-3 gap-2">
                {(['light', 'sepia', 'dark'] as const).map((key) => {
                  const t = READER_THEMES[key];
                  const active = preferences.readerTheme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateCustomPref({readerTheme: key})}
                      className={`min-h-[44px] rounded-lg border text-xs font-medium transition-all ${t.bg} ${t.text} ${
                        active
                          ? 'ring-2 ring-[#1E3A5F] dark:ring-[#7BA3D1] border-transparent'
                          : t.border
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Typeface */}
            <div className="space-y-2">
              <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Font Family</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => updateCustomPref({fontFamily: f.id})}
                    className={`min-h-[42px] px-2.5 rounded-lg border ${theme.border} ${f.className} text-xs sm:text-sm ${
                      preferences.fontFamily === f.id
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size & Line Spacing */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Font Size</p>
                  <span className="text-xs tabular-nums font-medium">{preferences.fontSize}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateCustomPref({fontSize: Math.max(14, preferences.fontSize - 1)})
                    }
                    className={`min-h-[40px] px-3 rounded-lg border ${theme.border} text-xs font-semibold`}
                  >
                    A−
                  </button>
                  <input
                    type="range"
                    min={14}
                    max={28}
                    step={1}
                    value={preferences.fontSize}
                    onChange={(e) => updateCustomPref({fontSize: Number(e.target.value)})}
                    aria-label="Font size"
                    className="flex-1 accent-[#1E3A5F] dark:accent-[#7BA3D1]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateCustomPref({fontSize: Math.min(28, preferences.fontSize + 1)})
                    }
                    className={`min-h-[40px] px-3 rounded-lg border ${theme.border} text-sm font-semibold`}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Line Spacing</p>
                  <span className="text-xs tabular-nums font-medium">
                    {preferences.lineHeight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.4}
                  max={2.1}
                  step={0.05}
                  value={preferences.lineHeight}
                  onChange={(e) => updateCustomPref({lineHeight: Number(e.target.value)})}
                  aria-label="Line spacing"
                  className="w-full h-10 accent-[#1E3A5F] dark:accent-[#7BA3D1]"
                />
              </div>
            </div>

            {/* Letter Spacing & Margins */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Letter Spacing</p>
                  <span className="text-xs tabular-nums font-medium">
                    {preferences.letterSpacing >= 0
                      ? `+${preferences.letterSpacing.toFixed(3)}`
                      : preferences.letterSpacing.toFixed(3)}
                    em
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.02}
                  max={0.06}
                  step={0.005}
                  value={preferences.letterSpacing}
                  onChange={(e) => updateCustomPref({letterSpacing: Number(e.target.value)})}
                  aria-label="Letter spacing"
                  className="w-full h-10 accent-[#1E3A5F] dark:accent-[#7BA3D1]"
                />
              </div>

              <div className="space-y-2">
                <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Reading Margins</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['compact', 'balanced', 'generous'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateCustomPref({marginWidth: m})}
                      className={`min-h-[40px] rounded-lg border ${theme.border} text-xs font-medium ${
                        preferences.marginWidth === m
                          ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                          : ''
                      }`}
                    >
                      {m === 'compact' ? 'Wide' : m === 'balanced' ? 'Balanced' : 'Narrow'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Alignment, Layout Mode, and Progress Visibility */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-2">
                <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Alignment</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateCustomPref({textAlign: 'left'})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} flex items-center justify-center gap-1.5 text-xs font-medium ${
                      preferences.textAlign === 'left'
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                    <span>Left</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCustomPref({textAlign: 'justify'})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} flex items-center justify-center gap-1.5 text-xs font-medium ${
                      preferences.textAlign === 'justify'
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                    <span>Justify</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Layout</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateCustomPref({layoutMode: 'scroll'})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} text-xs font-medium ${
                      preferences.layoutMode === 'scroll'
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    Scroll
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCustomPref({layoutMode: 'paginated'})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} text-xs font-medium ${
                      preferences.layoutMode === 'paginated'
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    Pages
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className={`text-xs uppercase tracking-wider ${theme.muted}`}>Progress Bar</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateCustomPref({showProgress: true})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} text-xs font-medium ${
                      preferences.showProgress
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    Show
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCustomPref({showProgress: false})}
                    className={`min-h-[40px] rounded-lg border ${theme.border} text-xs font-medium ${
                      !preferences.showProgress
                        ? 'bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] border-transparent'
                        : ''
                    }`}
                  >
                    Hide
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
