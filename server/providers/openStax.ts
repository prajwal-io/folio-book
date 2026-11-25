import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface OpenStaxSubject {
  subject_name?: string;
}

interface OpenStaxAuthor {
  value?: {name?: string};
}

interface OpenStaxBookItem {
  id: number;
  title: string;
  meta: {
    slug: string;
    html_url: string;
    first_published_at?: string;
    locale?: string;
  };
  book_subjects?: OpenStaxSubject[];
  description?: string;
  cover_url?: string;
  publish_date?: string;
  authors?: OpenStaxAuthor[];
  license_name?: string;
  webview_rex_link?: string;
  webview_link?: string;
}

interface OpenStaxApiResponse {
  meta?: {total_count?: number};
  items?: OpenStaxBookItem[];
}

export async function fetchOpenStaxBooks(): Promise<CatalogBook[]> {
  const fields =
    'title,slug,book_subjects,cover_url,webview_rex_link,webview_link,publish_date,authors,description,license_name';

  const pages = await Promise.allSettled([
    fetch(`https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=${fields}&limit=100`, {
      signal: AbortSignal.timeout(12000),
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    }),
    fetch(
      `https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=${fields}&limit=50&offset=100`,
      {
        signal: AbortSignal.timeout(12000),
        headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
      },
    ),
  ]);

  const items: OpenStaxBookItem[] = [];
  for (const p of pages) {
    if (p.status === 'fulfilled' && p.value.ok) {
      const json = (await p.value.json()) as OpenStaxApiResponse;
      if (json.items) items.push(...json.items);
    }
  }

  if (items.length === 0) {
    throw new Error('OpenStax returned no book records');
  }

  const now = new Date().toISOString();
  const books: CatalogBook[] = [];

  for (const item of items) {
    if (!item.title || !item.meta?.slug) continue;
    if (item.meta.locale && item.meta.locale !== 'en') continue;

    const readUrl = item.webview_rex_link || item.webview_link || item.meta.html_url;
    if (!readUrl) continue;

    const rawYearStr = item.publish_date || item.meta.first_published_at || '';
    const parsedYear = rawYearStr ? new Date(rawYearStr).getFullYear() : NaN;
    const publicationYear = !Number.isNaN(parsedYear) && parsedYear >= 2000 ? parsedYear : null;

    const authorNames = (item.authors || [])
      .map((a) => a.value?.name?.trim())
      .filter((n): n is string => Boolean(n));
    const authors: BookAuthor[] =
      authorNames.length > 0
        ? authorNames.slice(0, 4).map((name) => ({name, birthYear: null, deathYear: null}))
        : [{name: 'OpenStax Faculty Authors', birthYear: null, deathYear: null}];
    const primaryAuthor = authors[0].name;

    const subjects = (item.book_subjects || [])
      .map((s) => s.subject_name?.trim())
      .filter((s): s is string => Boolean(s));

    // Map OpenStax disciplines cleanly to our 22 genres
    const lowerTitle = item.title.toLowerCase();
    let hintGenre: string | undefined;
    if (lowerTitle.includes('entrepreneur')) hintGenre = 'entrepreneurship';
    else if (lowerTitle.includes('business') || lowerTitle.includes('management') || lowerTitle.includes('accounting') || lowerTitle.includes('marketing') || lowerTitle.includes('economics')) hintGenre = 'business';
    else if (lowerTitle.includes('psychology')) hintGenre = 'psychology';
    else if (lowerTitle.includes('college success') || lowerTitle.includes('personal finance')) hintGenre = 'self-development';
    else if (lowerTitle.includes('philosophy')) hintGenre = 'philosophy';
    else if (lowerTitle.includes('history')) hintGenre = 'history';
    else if (lowerTitle.includes('python') || lowerTitle.includes('data science') || lowerTitle.includes('manufacturing') || lowerTitle.includes('workplace software')) hintGenre = 'technology';

    const {genres} = classifyGenresAndKind(subjects, item.title, hintGenre);
    const copyrightCheck = evaluateCopyrightForIndia(authors, {
      explicitCCLicense: item.license_name || 'CC BY 4.0',
    });

    const rawCoverUrl =
      item.cover_url && item.cover_url.startsWith('https://assets.openstax.org/')
        ? item.cover_url
        : null;
    const coverUrl = rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null;

    const summary = item.description
      ? cheerio.load(item.description).text().replace(/\s+/g, ' ').trim().slice(0, 420)
      : null;

    const edition: BookEdition = {
      editionId: `openstax-${item.meta.slug}`,
      provider: 'openstax',
      providerLabel: 'OpenStax (Rice University)',
      sourceBookId: item.meta.slug,
      sourceUrl: item.meta.html_url,
      externalReadUrl: readUrl,
      formatLabel: 'Open Web Book (CC BY 4.0)',
      language: 'EN',
      licenseLabel: item.license_name || 'Creative Commons Attribution 4.0',
    };

    books.push({
      id: `openstax-${item.meta.slug}`,
      normalizedKey: normalizeBookKey(item.title, primaryAuthor),
      title: item.title.trim(),
      authors,
      primaryAuthor,
      kind: 'book',
      genres,
      subjects,
      languages: ['en'],
      coverUrl,
      rawCoverUrl,
      downloadCount: null,
      publicationYear,
      digitalReleaseYear: publicationYear,
      copyrightStatus: copyrightCheck.status,
      freeAccessType: copyrightCheck.freeAccessType,
      copyrightNote: copyrightCheck.note,
      summary,
      isNewArrival: Boolean(publicationYear && publicationYear >= 2025),
      addedAt: now,
      updatedAt: now,
      editions: [edition],
    });
  }

  return books;
}
