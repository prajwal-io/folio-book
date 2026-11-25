import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook, BookKind} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface ObookoCategory {
  url: string;
  genreSlug: string;
  kind: BookKind;
}

const OBOOKO_CATEGORIES: ObookoCategory[] = [
  {url: 'https://www.obooko.com/free-romance-books', genreSlug: 'romance', kind: 'novel'},
  {url: 'https://www.obooko.com/free-crime-thriller-mystery-books', genreSlug: 'thriller', kind: 'novel'},
  {url: 'https://www.obooko.com/free-science-fiction-fantasy-books', genreSlug: 'fantasy', kind: 'novel'},
  {url: 'https://www.obooko.com/free-general-and-literary-fiction-books', genreSlug: 'fiction', kind: 'novel'},
  {url: 'https://www.obooko.com/free-horror-and-supernatural-books', genreSlug: 'horror', kind: 'novel'},
  {url: 'https://www.obooko.com/free-self-help-psychology-books', genreSlug: 'self-development', kind: 'book'},
  {url: 'https://www.obooko.com/free-business-books', genreSlug: 'business', kind: 'book'},
];

interface ObookoLdBook {
  name?: string;
  author?: {name?: string} | Array<{name?: string}>;
  description?: string;
  image?: string | string[];
  inLanguage?: string;
  offers?: {price?: string};
}

async function fetchObookoBookPage(bookUrl: string, cat: ObookoCategory): Promise<CatalogBook | null> {
  const res = await fetch(bookUrl, {
    signal: AbortSignal.timeout(8000),
    headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  let ldBook: ObookoLdBook | null = null;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text()) as Record<string, unknown>;
      if (parsed['@type'] === 'Book') {
        ldBook = parsed as ObookoLdBook;
        break;
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  if (!ldBook || !ldBook.name) return null;
  if (ldBook.offers?.price && Number(ldBook.offers.price) > 0) return null;

  const authorName = Array.isArray(ldBook.author)
    ? ldBook.author[0]?.name?.trim()
    : ldBook.author?.name?.trim();
  if (!authorName) return null;

  const rawImg = Array.isArray(ldBook.image) ? ldBook.image[0] : ldBook.image;
  const rawCoverUrl = rawImg && rawImg.startsWith('https://') ? rawImg.trim() : null;

  // Remove site chrome & scripts so website footer copyright (e.g. "© 2026 Obooko") is never mistaken for book publication year
  $('header, footer, nav, script, style, .footer, #footer').remove();
  const mainText = $('main, .product-info, .book-description, article, body').first().text();

  let pubYear: number | null = null;
  const textYearMatch = mainText.match(
    /(?:First\s+published|Originally\s+published|Publication\s+date|Published\s+in|Release\s+date)\s*[:\s]*(?:[A-Za-z]+\s+\d{1,2},?\s+)?(19\d{2}|20[0-2]\d)/i,
  );
  if (textYearMatch) {
    pubYear = Number(textYearMatch[1]);
  }

  const authors: BookAuthor[] = [{name: authorName, birthYear: null, deathYear: null}];
  const copyrightCheck = evaluateCopyrightForIndia(authors, {isAuthorFreeEdition: true});

  const subjects = [cat.genreSlug, 'Contemporary Indie', 'Authorized Free Edition'];
  const {genres} = classifyGenresAndKind(subjects, ldBook.name, cat.genreSlug);
  const slug = bookUrl.split('/').filter(Boolean).pop() || ldBook.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date().toISOString();

  const edition: BookEdition = {
    editionId: `obooko-${slug}`,
    provider: 'obooko',
    providerLabel: 'Obooko (Free Indie Authors)',
    sourceBookId: slug,
    sourceUrl: bookUrl,
    externalReadUrl: bookUrl,
    formatLabel: 'Authorized Free eBook ($0.00)',
    language: 'EN',
    licenseLabel: 'Free Author Edition',
  };

  return {
    id: `obooko-${slug}`,
    normalizedKey: normalizeBookKey(ldBook.name, authorName),
    title: ldBook.name.trim(),
    authors,
    primaryAuthor: authorName,
    kind: cat.kind,
    genres,
    subjects,
    languages: ['en'],
    coverUrl: rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null,
    rawCoverUrl,
    downloadCount: null,
    publicationYear: pubYear,
    digitalReleaseYear: pubYear,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: copyrightCheck.note,
    summary: ldBook.description ? ldBook.description.replace(/\s+/g, ' ').trim().slice(0, 380) : null,
    isNewArrival: Boolean(pubYear && pubYear >= 2025),
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchObookoContemporaryBooks(): Promise<CatalogBook[]> {
  const results: CatalogBook[] = [];

  for (const cat of OBOOKO_CATEGORIES) {
    try {
      const res = await fetch(cat.url, {
        signal: AbortSignal.timeout(8000),
        headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
      });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      const categoryPrefix = cat.url.replace(/^https?:\/\/www\.obooko\.com/, '');
      const bookLinks = new Set<string>();
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const normalized = href.startsWith('http') ? href : `https://www.obooko.com${href}`;
        if (
          normalized.startsWith(`https://www.obooko.com${categoryPrefix}/`) &&
          !normalized.includes('#')
        ) {
          bookLinks.add(normalized);
        }
      });

      const picks = Array.from(bookLinks).slice(0, 5);
      const settled = await Promise.allSettled(picks.map((u) => fetchObookoBookPage(u, cat)));
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value) results.push(s.value);
      }
    } catch {
      // continue on individual category errors
    }
  }

  return results;
}
