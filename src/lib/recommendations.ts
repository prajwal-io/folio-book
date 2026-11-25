import type {
  BookshelfEntry,
  CatalogBook,
  HighlightAnnotation,
  ListeningProgress,
  MoodId,
  ReadingHistoryEntry,
  ReadingProgress,
  RecommendedBook,
} from '../types/library';

export interface MoodDefinition {
  id: MoodId;
  label: string;
  subtitle: string;
  genres: string[];
  keywords: string[];
  preferQuick?: boolean;
}

export const MOOD_DEFINITIONS: MoodDefinition[] = [
  {
    id: 'relaxing',
    label: 'Something Relaxing',
    subtitle: 'Gentle classics, pastoral fiction, poetry, and lyrical essays',
    genres: ['romance', 'poetry', 'classics', 'literature', 'fiction'],
    keywords: ['garden', 'pastoral', 'countryside', 'nature', 'poem', 'essays', 'calm', 'gentle'],
  },
  {
    id: 'inspiring',
    label: 'Something Inspiring',
    subtitle: 'Personal mastery, biographies, resilience, and purposeful thinking',
    genres: ['self-development', 'biography', 'philosophy', 'entrepreneurship'],
    keywords: ['courage', 'purpose', 'growth', 'wisdom', 'leader', 'success', 'character', 'meditations'],
  },
  {
    id: 'mysterious',
    label: 'Something Mysterious',
    subtitle: 'Detective cases, psychological suspense, gothic intrigue, and puzzles',
    genres: ['mystery', 'thriller', 'horror'],
    keywords: ['detective', 'mystery', 'sherlock', 'murder', 'shadow', 'ghost', 'crime', 'secret'],
  },
  {
    id: 'romantic',
    label: 'Something Romantic',
    subtitle: 'Love stories, Austen wit, emotional bonds, and contemporary romance',
    genres: ['romance', 'drama'],
    keywords: ['love', 'heart', 'marriage', 'pride', 'jane eyre', 'passion', 'courtship'],
  },
  {
    id: 'adventurous',
    label: 'Something Adventurous',
    subtitle: 'Voyages, space operas, mythic fantasy quests, and daring expeditions',
    genres: ['adventure', 'science-fiction', 'fantasy', 'action'],
    keywords: ['voyage', 'quest', 'expedition', 'star', 'galaxy', 'island', 'empire', 'space', 'dragon'],
  },
  {
    id: 'thought-provoking',
    label: 'Thought-Provoking',
    subtitle: 'Philosophy, psychology, human nature, and big civilizational questions',
    genres: ['philosophy', 'psychology', 'science', 'history'],
    keywords: ['mind', 'consciousness', 'ethics', 'logic', 'society', 'psychology', 'reason', 'future'],
  },
  {
    id: 'educational',
    label: 'Learn & Explore',
    subtitle: 'Open textbooks, computing, mathematics, economics, and structured guides',
    genres: ['education', 'technology', 'science', 'business'],
    keywords: ['introduction', 'principles', 'programming', 'calculus', 'physics', 'economics', 'guide'],
  },
  {
    id: 'quick-read',
    label: 'Quick Evening Read',
    subtitle: 'Concise short fiction, modern speculative stories, and single-sitting essays',
    genres: ['short-stories', 'poetry', 'philosophy', 'science-fiction', 'fantasy'],
    keywords: ['short', 'story', 'stories', 'clarkesworld', 'lightspeed', 'uncanny', 'essays', 'poems'],
    preferQuick: true,
  },
];

function formatGenreName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Computes an honest, catalog-grounded duration estimate ONLY when reliable
 * catalog metadata exists (LibriVox track seconds or known short-fiction periodicals).
 */
export function estimateReadingMinutes(book: CatalogBook): number | undefined {
  if (book.audiobooks && book.audiobooks[0] && book.audiobooks[0].totalTimeSecs > 0) {
    return Math.max(5, Math.round(book.audiobooks[0].totalTimeSecs / 60));
  }
  const prov = book.editions[0]?.provider;
  if (prov === 'speculative-press') {
    return 25; // Contemporary short fiction / novelettes (~4k–7k words)
  }
  if (book.genres.includes('short-stories') || book.genres.includes('poetry')) {
    return 30;
  }
  return undefined;
}

export interface UserTasteProfile {
  genreWeights: Map<string, number>;
  authorWeights: Map<string, number>;
  seenBookIds: Set<string>;
  finishedBookIds: Set<string>;
  prefersNovelsRatio: number;
  topGenre: string | null;
  topAuthor: string | null;
  hasHistory: boolean;
}

export function buildUserTasteProfile(params: {
  shelf: BookshelfEntry[];
  progressList: ReadingProgress[];
  listeningList: ListeningProgress[];
  history: ReadingHistoryEntry[];
  highlights: HighlightAnnotation[];
  preferredInterests: string[];
}): UserTasteProfile {
  const {shelf, progressList, listeningList, history, highlights, preferredInterests} = params;
  const genreWeights = new Map<string, number>();
  const authorWeights = new Map<string, number>();
  const seenBookIds = new Set<string>();
  const finishedBookIds = new Set<string>();

  let novelCount = 0;
  let bookCount = 0;

  const bumpBook = (book: CatalogBook, weight: number) => {
    seenBookIds.add(book.id);
    if (book.kind === 'novel') novelCount++;
    else bookCount++;
    for (const g of book.genres) {
      genreWeights.set(g, (genreWeights.get(g) || 0) + weight);
    }
    if (book.primaryAuthor && book.primaryAuthor !== 'Unknown Author') {
      authorWeights.set(
        book.primaryAuthor,
        (authorWeights.get(book.primaryAuthor) || 0) + weight,
      );
    }
  };

  for (const s of shelf) {
    const w = s.isFavourite ? 5 : s.shelfStatus === 'finished' ? 4 : 3;
    if (s.shelfStatus === 'finished') finishedBookIds.add(s.bookId);
    bumpBook(s.book, w);
  }
  for (const p of progressList) {
    if (p.percentComplete >= 95) finishedBookIds.add(p.bookId);
    bumpBook(p.book, p.percentComplete > 15 ? 4 : 2);
  }
  for (const l of listeningList) {
    if (l.percentComplete >= 95) finishedBookIds.add(l.bookId);
    bumpBook(l.book, l.percentComplete > 15 ? 4 : 2);
  }
  for (const h of history) {
    bumpBook(h.book, 1.5);
  }
  for (const interest of preferredInterests) {
    genreWeights.set(interest, (genreWeights.get(interest) || 0) + 4.5);
  }

  // Extra affinity boost if the user actively takes highlights/notes in a book
  const highlightedBookIds = new Set(highlights.map((h) => h.bookId));
  for (const s of shelf) {
    if (highlightedBookIds.has(s.bookId)) {
      for (const g of s.book.genres) {
        genreWeights.set(g, (genreWeights.get(g) || 0) + 2);
      }
    }
  }

  let topGenre: string | null = null;
  let maxG = 0;
  for (const [g, score] of genreWeights.entries()) {
    if (score > maxG) {
      maxG = score;
      topGenre = g;
    }
  }

  let topAuthor: string | null = null;
  let maxA = 0;
  for (const [a, score] of authorWeights.entries()) {
    if (score > maxA) {
      maxA = score;
      topAuthor = a;
    }
  }

  const totalKind = novelCount + bookCount;
  return {
    genreWeights,
    authorWeights,
    seenBookIds,
    finishedBookIds,
    prefersNovelsRatio: totalKind > 0 ? novelCount / totalKind : 0.5,
    topGenre,
    topAuthor,
    hasHistory: genreWeights.size > 0 || seenBookIds.size > 0,
  };
}

export function getPersonalizedRecommendations(
  pool: CatalogBook[],
  profile: UserTasteProfile,
  limit = 12,
): RecommendedBook[] {
  const candidates = pool.filter(
    (b) =>
      b.editions.length > 0 &&
      !profile.finishedBookIds.has(b.id) &&
      !profile.seenBookIds.has(b.id),
  );

  if (!profile.hasHistory) {
    // Thoughtful cold-start curation spanning contemporary, narrative, philosophy, and audio
    const curated = [...candidates].sort((a, b) => {
      const aModern = (a.publicationYear ?? 0) >= 2015 ? 1 : 0;
      const bModern = (b.publicationYear ?? 0) >= 2015 ? 1 : 0;
      const aCover = a.coverUrl ? 1 : 0;
      const bCover = b.coverUrl ? 1 : 0;
      const scoreA = aCover * 3 + aModern * 2 + ((a.audiobooks?.length ?? 0) > 0 ? 1.5 : 0);
      const scoreB = bCover * 3 + bModern * 2 + ((b.audiobooks?.length ?? 0) > 0 ? 1.5 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
    });

    const diverse: RecommendedBook[] = [];
    const seenGenres = new Set<string>();
    for (const book of curated) {
      if (diverse.length >= limit) break;
      const leadGenre = book.genres[0] || 'literature';
      if (diverse.length < 6 && seenGenres.has(leadGenre)) continue;
      seenGenres.add(leadGenre);
      const reason =
        (book.publicationYear ?? 0) >= 2020
          ? `Curated · Contemporary ${formatGenreName(leadGenre)}`
          : (book.audiobooks?.length ?? 0) > 0
            ? `Curated · Read & Listen ${formatGenreName(leadGenre)}`
            : `Curated Essential · ${formatGenreName(leadGenre)}`;
      diverse.push({
        book,
        reason,
        estimatedMinutes: estimateReadingMinutes(book),
      });
    }
    return diverse;
  }

  const scored = candidates.map((book) => {
    let score = 0;
    let bestGenre: string | null = null;
    let bestGenreScore = 0;

    for (const g of book.genres) {
      const gw = profile.genreWeights.get(g) || 0;
      score += gw * 2.2;
      if (gw > bestGenreScore) {
        bestGenreScore = gw;
        bestGenre = g;
      }
    }

    const authorMatch = profile.authorWeights.get(book.primaryAuthor) || 0;
    score += authorMatch * 3.5;

    if (book.kind === 'novel' && profile.prefersNovelsRatio > 0.6) score += 1.5;
    if (book.kind === 'book' && profile.prefersNovelsRatio < 0.4) score += 1.5;
    if (book.coverUrl) score += 1.2;
    if ((book.publicationYear ?? 0) >= 2015) score += 1.0;
    if ((book.downloadCount ?? 0) > 2000) score += 0.8;

    let reason = 'Recommended from your reading taste';
    if (authorMatch > 0) {
      reason = `By ${book.primaryAuthor}, an author you follow`;
    } else if (bestGenre) {
      reason = `Because you enjoy ${formatGenreName(bestGenre)}`;
    } else if ((book.publicationYear ?? 0) >= 2024) {
      reason = 'Fresh 2024–2026 Open Release';
    }

    return {
      book,
      score,
      reason,
      estimatedMinutes: estimateReadingMinutes(book),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({book, reason, estimatedMinutes}) => ({
    book,
    reason,
    estimatedMinutes,
  }));
}

export function getDiscoverDifferentRecommendations(
  pool: CatalogBook[],
  profile: UserTasteProfile,
  limit = 6,
): RecommendedBook[] {
  const candidates = pool.filter(
    (b) =>
      b.editions.length > 0 &&
      !profile.seenBookIds.has(b.id) &&
      !profile.finishedBookIds.has(b.id),
  );

  // Pick genres not yet strongly represented in the user's history
  const unfamiliar = candidates.filter((b) =>
    b.genres.every((g) => (profile.genreWeights.get(g) || 0) === 0),
  );
  const source = unfamiliar.length >= limit ? unfamiliar : candidates;

  const picked: RecommendedBook[] = [];
  const usedGenres = new Set<string>();
  const sorted = [...source].sort((a, b) => {
    const scoreA = (a.coverUrl ? 3 : 0) + ((a.publicationYear ?? 0) >= 2018 ? 2 : 0);
    const scoreB = (b.coverUrl ? 3 : 0) + ((b.publicationYear ?? 0) >= 2018 ? 2 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
  });

  for (const book of sorted) {
    if (picked.length >= limit) break;
    const g = book.genres[0] || 'literature';
    if (usedGenres.has(g) && source.length > limit * 2) continue;
    usedGenres.add(g);
    picked.push({
      book,
      reason: `Explore ${formatGenreName(g)}`,
      estimatedMinutes: estimateReadingMinutes(book),
    });
  }
  return picked;
}

export function filterBooksByMood(pool: CatalogBook[], moodId: MoodId): RecommendedBook[] {
  const def = MOOD_DEFINITIONS.find((m) => m.id === moodId);
  if (!def) return [];

  const scored = pool
    .filter((b) => b.editions.length > 0)
    .map((book) => {
      let score = 0;
      const matchedGenres = book.genres.filter((g) => def.genres.includes(g));
      score += matchedGenres.length * 4;

      const haystack = `${book.title} ${book.summary || ''} ${book.subjects.join(' ')}`.toLowerCase();
      for (const kw of def.keywords) {
        if (haystack.includes(kw)) score += 2.5;
      }

      const estMins = estimateReadingMinutes(book);
      if (def.preferQuick && estMins !== undefined && estMins <= 45) {
        score += 5;
      }
      if (def.preferQuick && book.editions.some((e) => e.provider === 'speculative-press')) {
        score += 4;
      }

      if (book.coverUrl) score += 1;

      return {
        book,
        score,
        reason: def.label,
        estimatedMinutes: estMins,
      };
    })
    .filter((item) => item.score >= 3.5);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 24).map(({book, reason, estimatedMinutes}) => ({
    book,
    reason,
    estimatedMinutes,
  }));
}

export function getTimeOfDayGreeting(now: Date = new Date()): {
  greeting: string;
  selectionHeading: string;
  selectionSubtitle: string;
  preferredMood: MoodId;
} {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) {
    return {
      greeting: 'Good morning',
      selectionHeading: 'Morning Curiosity & Ideas',
      selectionSubtitle: 'Clear, energizing reads and contemporary non-fiction to start your day.',
      preferredMood: 'inspiring',
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      greeting: 'Good afternoon',
      selectionHeading: 'Afternoon Discovery',
      selectionSubtitle: 'Engaging stories, deep essays, and open-access knowledge.',
      preferredMood: 'thought-provoking',
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      greeting: 'Good evening',
      selectionHeading: 'Evening Selection',
      selectionSubtitle: 'Calming stories, atmospheric novels, and concise evening reads.',
      preferredMood: 'quick-read',
    };
  }
  return {
    greeting: 'Quiet late hours',
    selectionHeading: 'Late-Night Companion',
    selectionSubtitle: 'Contemplative essays, poetry, and calm audiobooks for the night.',
    preferredMood: 'relaxing',
  };
}

/**
 * Deterministic daily seed based on local YYYY-MM-DD so Daily Book Recommendation
 * remains consistent throughout the day and refreshes cleanly next calendar day.
 */
export function pickDailyBookRecommendation(
  pool: CatalogBook[],
  recommended: RecommendedBook[],
  dateKey: string,
): RecommendedBook | null {
  const candidates =
    recommended.length >= 4
      ? recommended
      : pool
          .filter((b) => b.coverUrl && b.editions.length > 0)
          .slice(0, 20)
          .map((book) => ({
            book,
            reason: `Daily Pick · ${formatGenreName(book.genres[0] || 'literature')}`,
            estimatedMinutes: estimateReadingMinutes(book),
          }));

  if (candidates.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return candidates[hash % candidates.length] || candidates[0];
}
