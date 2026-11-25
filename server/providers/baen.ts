import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

async function fetchBaenBookDetail(bookPageUrl: string): Promise<CatalogBook | null> {
  const res = await fetch(bookPageUrl, {
    signal: AbortSignal.timeout(9000),
    headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
  });
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  const rawTitle = $('span.product-title, h1.page-title').first().text().trim();
  const authorName = $('a.author-name-link').first().text().trim();
  if (!rawTitle || !authorName) return null;

  // Find Baen free Read Online link (/Chapters/<isbn>/<isbn>.htm)
  const chapterHref = $('a[href*="/Chapters/"]').first().attr('href');
  if (!chapterHref) return null;

  const chapterBaseUrl = chapterHref.startsWith('http')
    ? chapterHref
    : `https://www.baen.com${chapterHref.startsWith('/') ? '' : '/'}${chapterHref}`;

  // Mobile/flat HTML full-text variant used by Baen reader
  const flatHtmlUrl = chapterBaseUrl.replace(/\.htm$/i, '__c_.htm');

  // Parse Published date (e.g., "Published: 2/1/2000")
  let pubYear: number | null = null;
  const pubMatch = html.match(/Published:\s*\d{1,2}\/\d{1,2}\/(\d{4})/i);
  if (pubMatch) {
    pubYear = Number(pubMatch[1]);
  }

  // Cover image
  const imgSrc =
    $('.product.media img').first().attr('src') ||
    $('img[src*="/media/catalog/product/"]').first().attr('src') ||
    null;
  const rawCoverUrl =
    imgSrc && imgSrc.startsWith('http')
      ? imgSrc
      : imgSrc
        ? `https://www.baen.com${imgSrc.startsWith('/') ? '' : '/'}${imgSrc}`
        : null;

  const summary =
    $('div.product.attribute.description .value, meta[name="description"]')
      .first()
      .text()
      .trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    null;

  const slug = bookPageUrl.replace(/^https?:\/\/www\.baen\.com\//, '').replace(/\.html$/, '');
  const authors: BookAuthor[] = [{name: authorName, birthYear: null, deathYear: null}];
  const copyrightCheck = evaluateCopyrightForIndia(authors, {isPublisherFreeLibrary: true});

  const subjects = ['Science Fiction', 'Fantasy', 'Fiction', 'Baen Free Library'];
  const {genres} = classifyGenresAndKind(subjects, rawTitle, 'science-fiction');
  const now = new Date().toISOString();

  const edition: BookEdition = {
    editionId: `baen-${slug}`,
    provider: 'baen',
    providerLabel: 'Baen Free Library',
    sourceBookId: slug,
    sourceUrl: bookPageUrl,
    readHtmlUrl: flatHtmlUrl,
    externalReadUrl: chapterBaseUrl,
    formatLabel: 'Full Novel (Publisher Free Edition)',
    language: 'EN',
    licenseLabel: 'Free Publisher Edition',
  };

  return {
    id: `baen-${slug}`,
    normalizedKey: normalizeBookKey(rawTitle, authorName),
    title: rawTitle,
    authors,
    primaryAuthor: authorName,
    kind: 'novel',
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
    summary: summary ? summary.slice(0, 420) : null,
    isNewArrival: false,
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchBaenFreeLibrary(): Promise<CatalogBook[]> {
  const listUrls = [
    'https://www.baen.com/categories/free-library.html',
    'https://www.baen.com/categories/free-library.html?p=2',
  ];

  const bookUrls = new Set<string>();
  for (const listUrl of listUrls) {
    try {
      const res = await fetch(listUrl, {
        signal: AbortSignal.timeout(9000),
        headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
      });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      $('a.product-item-link, .product-item-info a[href$=".html"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('https://www.baen.com/') && !href.includes('/categories/')) {
          bookUrls.add(href);
        }
      });
    } catch {
      // continue
    }
  }

  const urls = Array.from(bookUrls).slice(0, 20);
  const results: CatalogBook[] = [];
  for (let i = 0; i < urls.length; i += 4) {
    const batch = urls.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map((u) => fetchBaenBookDetail(u)));
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) results.push(s.value);
    }
  }

  return results;
}
