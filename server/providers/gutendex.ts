import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface GutendexAuthor {
  name: string;
  birth_year: number | null;
  death_year: number | null;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  summaries?: string[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  results: GutendexBook[];
}

function flipAuthorName(name: string): string {
  const parts = name.split(',').map((s) => s.trim());
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name.trim();
}

function mapGutendexBook(raw: GutendexBook, isNewArrival = false, hintGenre?: string): CatalogBook | null {
  if (raw.media_type && raw.media_type !== 'Text') {
    return null;
  }

  const authors: BookAuthor[] = (raw.authors || []).map((a) => ({
    name: flipAuthorName(a.name),
    birthYear: a.birth_year ?? null,
    deathYear: a.death_year ?? null,
  }));

  const primaryAuthor = authors[0]?.name || 'Various Authors';
  const copyrightCheck = evaluateCopyrightForIndia(authors, {
    gutenbergCopyright: raw.copyright,
  });

  if (!copyrightCheck.allowInCatalog) {
    return null;
  }

  const subjects = [...(raw.subjects || []), ...(raw.bookshelves || [])]
    .map((s) => s.replace(/^Category:\s*/i, '').trim())
    .filter(Boolean);

  const {genres, kind} = classifyGenresAndKind(subjects, raw.title, hintGenre);

  // Use reliable PGLAF mirror URLs for Project Gutenberg content & covers
  const pglafHtml = `https://gutenberg.pglaf.org/cache/epub/${raw.id}/pg${raw.id}-images.html`;
  const pglafEpub = `https://gutenberg.pglaf.org/cache/epub/${raw.id}/pg${raw.id}-images.epub`;
  const pglafTxt = `https://gutenberg.pglaf.org/cache/epub/${raw.id}/pg${raw.id}.txt`;
  const pglafCover = `https://gutenberg.pglaf.org/cache/epub/${raw.id}/pg${raw.id}.cover.medium.jpg`;

  const rawCoverUrl = raw.formats['image/jpeg'] ? pglafCover : null;
  const coverUrl = rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null;

  const edition: BookEdition = {
    editionId: `gutendex-${raw.id}`,
    provider: 'gutendex',
    providerLabel: 'Project Gutenberg',
    sourceBookId: String(raw.id),
    sourceUrl: `https://www.gutenberg.org/ebooks/${raw.id}`,
    readHtmlUrl: raw.formats['text/html'] || raw.formats['text/html; charset=utf-8'] ? pglafHtml : pglafHtml,
    readEpubUrl: raw.formats['application/epub+zip'] ? pglafEpub : undefined,
    readTextUrl: raw.formats['text/plain; charset=utf-8'] || raw.formats['text/plain; charset=us-ascii'] ? pglafTxt : pglafTxt,
    externalReadUrl: `https://www.gutenberg.org/ebooks/${raw.id}`,
    formatLabel: 'Full HTML & EPUB',
    language: (raw.languages?.[0] || 'en').toUpperCase(),
    licenseLabel: 'Public Domain',
  };

  const now = new Date().toISOString();
  const cleanTitle = raw.title.replace(/\s+/g, ' ').trim();
  const summary = raw.summaries?.[0]?.trim() || null;

  return {
    id: `pg-${raw.id}`,
    normalizedKey: normalizeBookKey(cleanTitle, primaryAuthor),
    title: cleanTitle,
    authors,
    primaryAuthor,
    kind,
    genres,
    subjects: subjects.slice(0, 10),
    languages: raw.languages || ['en'],
    coverUrl,
    rawCoverUrl,
    downloadCount: raw.download_count ?? null,
    publicationYear: null,
    digitalReleaseYear: null,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: copyrightCheck.note,
    summary,
    isNewArrival,
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchGutendexBooks(params: {
  sort?: 'popular' | 'descending' | 'ascending';
  topic?: string;
  search?: string;
  page?: number;
  languages?: string;
  isNewArrival?: boolean;
  hintGenre?: string;
}): Promise<CatalogBook[]> {
  const qs = new URLSearchParams();
  if (params.sort) qs.set('sort', params.sort);
  if (params.topic) qs.set('topic', params.topic);
  if (params.search) qs.set('search', params.search);
  if (params.page && params.page > 1) qs.set('page', String(params.page));

  const url = `https://gutendex.com/books/?${qs.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`Gutendex responded with HTTP ${res.status}`);
    }
    const data = (await res.json()) as GutendexResponse;
    const targetLang = params.languages || 'en';
    const books: CatalogBook[] = [];
    for (const item of data.results || []) {
      if (item.copyright === true) continue;
      if (targetLang && item.languages && !item.languages.includes(targetLang)) continue;
      const mapped = mapGutendexBook(item, Boolean(params.isNewArrival), params.hintGenre);
      if (mapped) books.push(mapped);
    }
    return books;
  } finally {
    clearTimeout(timer);
  }
}
