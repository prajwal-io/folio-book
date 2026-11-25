import type {
  BookEdition,
  CatalogBook,
  PublicationPeriodCounts,
  PublicationPeriodFilter,
} from '../../src/types/library.ts';

export function normalizeBookKey(title: string, author: string): string {
  const cleanTitle = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:\s*a\s+novel.*$/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const cleanAuthor =
    author
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(-1)[0] || 'unknown';

  return `${cleanTitle}::${cleanAuthor}`;
}

const PROVIDER_PRIORITY: Record<string, number> = {
  'standard-ebooks': 6,
  openstax: 5,
  baen: 5,
  'speculative-press': 4,
  'open-umn': 4,
  gutendex: 4,
  doab: 3,
  openalex: 3,
  wikibooks: 3,
  wikisource: 3,
  obooko: 2,
  librivox: 2,
  'open-library': 1,
};

export function mergeCatalogBooks(existing: CatalogBook, incoming: CatalogBook): CatalogBook {
  const editionMap = new Map<string, BookEdition>();
  for (const ed of existing.editions) {
    editionMap.set(`${ed.provider}:${ed.sourceBookId}`, ed);
  }
  for (const ed of incoming.editions) {
    const key = `${ed.provider}:${ed.sourceBookId}`;
    if (!editionMap.has(key)) {
      editionMap.set(key, ed);
    }
  }

  const editions = Array.from(editionMap.values()).sort(
    (a, b) => (PROVIDER_PRIORITY[b.provider] ?? 0) - (PROVIDER_PRIORITY[a.provider] ?? 0),
  );

  // Merge verified human-narrated audiobook recordings cleanly
  const audiobookMap = new Map<string, NonNullable<CatalogBook['audiobooks']>[number]>();
  for (const ab of existing.audiobooks || []) {
    audiobookMap.set(`${ab.provider}:${ab.audiobookId}`, ab);
  }
  for (const ab of incoming.audiobooks || []) {
    const key = `${ab.provider}:${ab.audiobookId}`;
    if (!audiobookMap.has(key)) {
      audiobookMap.set(key, ab);
    }
  }
  const audiobooks = audiobookMap.size > 0 ? Array.from(audiobookMap.values()).slice(0, 3) : undefined;

  const mergedGenres = Array.from(new Set([...existing.genres, ...incoming.genres])).slice(0, 5);
  const mergedSubjects = Array.from(new Set([...existing.subjects, ...incoming.subjects])).slice(0, 12);
  const mergedLanguages = Array.from(new Set([...existing.languages, ...incoming.languages]));

  const existingPrio = PROVIDER_PRIORITY[existing.editions[0]?.provider ?? ''] ?? 0;
  const incomingPrio = PROVIDER_PRIORITY[incoming.editions[0]?.provider ?? ''] ?? 0;
  const preferIncoming = incomingPrio > existingPrio;

  // Preserve earliest authentic original publicationYear when merging editions
  const years = [existing.publicationYear, incoming.publicationYear].filter(
    (y): y is number => typeof y === 'number' && y !== 0,
  );
  const publicationYear = years.length > 0 ? Math.min(...years) : null;

  const digitalYears = [existing.digitalReleaseYear, incoming.digitalReleaseYear].filter(
    (y): y is number => typeof y === 'number' && y > 0,
  );
  const digitalReleaseYear = digitalYears.length > 0 ? Math.max(...digitalYears) : null;

  return {
    ...existing,
    title: preferIncoming ? incoming.title : existing.title,
    subtitle: existing.subtitle || incoming.subtitle,
    coverUrl: existing.coverUrl || incoming.coverUrl,
    rawCoverUrl: existing.rawCoverUrl || incoming.rawCoverUrl,
    summary: existing.summary || incoming.summary,
    downloadCount: Math.max(existing.downloadCount ?? 0, incoming.downloadCount ?? 0) || null,
    publicationYear,
    digitalReleaseYear,
    genres: mergedGenres,
    subjects: mergedSubjects,
    languages: mergedLanguages,
    isNewArrival: existing.isNewArrival || incoming.isNewArrival,
    updatedAt: new Date().toISOString(),
    editions,
    audiobooks,
  };
}

export function matchesPublicationPeriod(
  book: CatalogBook,
  period: PublicationPeriodFilter,
): boolean {
  if (!period || period === 'all') return true;
  const y = book.publicationYear;

  if (period === 'before-2000') {
    // Public-domain classics without explicit publicationYear are pre-1931 (before 2000)
    if (y === null) return book.freeAccessType === 'public-domain';
    return y < 2000;
  }

  if (y === null) return false;

  switch (period) {
    case '2000-2009':
      return y >= 2000 && y <= 2009;
    case '2010-2019':
      return y >= 2010 && y <= 2019;
    case '2020-2024':
      return y >= 2020 && y <= 2024;
    case '2025':
      return y === 2025;
    case '2026':
      return y === 2026;
    case 'future':
      return y > 2026;
    default:
      return true;
  }
}

export function computePeriodCounts(books: CatalogBook[]): PublicationPeriodCounts {
  const counts: PublicationPeriodCounts = {
    all: books.length,
    future: 0,
    '2026': 0,
    '2025': 0,
    '2020-2024': 0,
    '2010-2019': 0,
    '2000-2009': 0,
    'before-2000': 0,
  };

  for (const b of books) {
    if (matchesPublicationPeriod(b, 'future')) counts.future++;
    if (matchesPublicationPeriod(b, '2026')) counts['2026']++;
    if (matchesPublicationPeriod(b, '2025')) counts['2025']++;
    if (matchesPublicationPeriod(b, '2020-2024')) counts['2020-2024']++;
    if (matchesPublicationPeriod(b, '2010-2019')) counts['2010-2019']++;
    if (matchesPublicationPeriod(b, '2000-2009')) counts['2000-2009']++;
    if (matchesPublicationPeriod(b, 'before-2000')) counts['before-2000']++;
  }

  return counts;
}
