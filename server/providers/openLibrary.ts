import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
  language?: string[];
  has_fulltext?: boolean;
  public_scan_b?: boolean;
  ia?: string[];
  edition_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  docs: OpenLibraryDoc[];
}

export async function fetchOpenLibraryPublicDomain(params: {
  q?: string;
  subject?: string;
  limit?: number;
  hintGenre?: string;
}): Promise<CatalogBook[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.subject) qs.set('subject', params.subject);
  qs.set('has_fulltext', 'true');
  qs.set('language', 'eng');
  qs.set('fields', 'key,title,author_name,first_publish_year,cover_i,subject,language,has_fulltext,public_scan_b,ia,edition_count');
  qs.set('limit', String(params.limit || 20));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);

  try {
    const res = await fetch(`https://openlibrary.org/search.json?${qs.toString()}`, {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`Open Library returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as OpenLibrarySearchResponse;
    const now = new Date().toISOString();
    const books: CatalogBook[] = [];

    for (const doc of data.docs || []) {
      // Strictly exclude non-public-scan / borrow-only / preview-only works
      if (!doc.public_scan_b || !doc.has_fulltext || !doc.ia || doc.ia.length === 0) {
        continue;
      }

      // Skip modern works lacking clear pre-1931 PD publication unless explicitly verified
      if (doc.first_publish_year && doc.first_publish_year > 1930) {
        continue;
      }

      if (doc.language && !doc.language.includes('eng')) {
        continue;
      }

      const iaId = doc.ia[0];
      const primaryAuthor = doc.author_name?.[0] || 'Unknown Author';
      const authors: BookAuthor[] = (doc.author_name || [primaryAuthor]).slice(0, 3).map((name) => ({
        name,
        birthYear: null,
        deathYear: null,
      }));

      const copyrightCheck = evaluateCopyrightForIndia(authors, {
        gutenbergCopyright: false,
      });

      const subjects = (doc.subject || []).slice(0, 10);
      const {genres, kind} = classifyGenresAndKind(subjects, doc.title, params.hintGenre);

      const rawCoverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : null;
      const coverUrl = rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null;

      const workId = doc.key.replace(/^\/works\//, '');
      const edition: BookEdition = {
        editionId: `ol-${iaId}`,
        provider: 'open-library',
        providerLabel: 'Open Library / Archive',
        sourceBookId: iaId,
        sourceUrl: `https://openlibrary.org${doc.key}`,
        readTextUrl: `https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(iaId)}_djvu.txt`,
        externalReadUrl: `https://archive.org/details/${encodeURIComponent(iaId)}`,
        formatLabel: 'Open Archive Scan',
        language: 'EN',
        licenseLabel: 'Public Domain Scan',
      };

      books.push({
        id: `ol-${workId}`,
        normalizedKey: normalizeBookKey(doc.title, primaryAuthor),
        title: doc.title,
        authors,
        primaryAuthor,
        kind,
        genres,
        subjects,
        languages: doc.language || ['eng'],
        coverUrl,
        rawCoverUrl,
        downloadCount: doc.edition_count ? doc.edition_count * 100 : null,
        publicationYear: doc.first_publish_year ?? null,
        digitalReleaseYear: null,
        copyrightStatus: copyrightCheck.status,
        freeAccessType: copyrightCheck.freeAccessType,
        copyrightNote: copyrightCheck.note,
        summary: null,
        isNewArrival: false,
        addedAt: now,
        updatedAt: now,
        editions: [edition],
      });
    }

    return books;
  } finally {
    clearTimeout(timer);
  }
}
