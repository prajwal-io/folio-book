import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

function parseStandardEbooksRss(xml: string): CatalogBook[] {
  const $ = cheerio.load(xml, {xmlMode: true});
  const books: CatalogBook[] = [];
  const now = new Date().toISOString();

  $('item').each((_, el) => {
    const rawTitle = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    const description = $(el).find('description').first().text().trim();
    const categories: string[] = [];
    $(el)
      .find('category')
      .each((__, catEl) => {
        const c = $(catEl).text().trim();
        if (c) categories.push(c);
      });

    if (!rawTitle || !link) return;

    // RSS titles follow "Book Title, by Author Name"
    let title = rawTitle;
    let authorName = 'Various Authors';
    const byMatch = rawTitle.match(/^(.+?),\s+by\s+(.+)$/i);
    if (byMatch) {
      title = byMatch[1].trim();
      authorName = byMatch[2].trim();
    }

    const authors: BookAuthor[] = [{name: authorName, birthYear: null, deathYear: null}];
    const copyrightCheck = evaluateCopyrightForIndia(authors, {isCC0OrPublicDomain: true});
    const {genres, kind} = classifyGenresAndKind(categories, title);

    // Build Standard Ebooks URLs from canonical ebook path
    const cleanPath = link.replace(/^https?:\/\/standardebooks\.org/, '').replace(/\/$/, '');
    const slugParts = cleanPath.split('/').filter(Boolean); // ['ebooks', author, title, ...translator]
    const seSlug = slugParts.slice(1).join('_');
    const singlePageUrl = `https://standardebooks.org${cleanPath}/text/single-page`;
    const epubUrl = seSlug ? `https://standardebooks.org${cleanPath}/downloads/${seSlug}.epub` : undefined;
    const rawCoverUrl = `https://standardebooks.org${cleanPath}/downloads/cover.jpg`;

    const edition: BookEdition = {
      editionId: `se-${slugParts.slice(1).join('-')}`,
      provider: 'standard-ebooks',
      providerLabel: 'Standard Ebooks',
      sourceBookId: cleanPath,
      sourceUrl: link,
      readHtmlUrl: singlePageUrl,
      readEpubUrl: epubUrl,
      externalReadUrl: link,
      formatLabel: 'Curated XHTML & EPUB',
      language: 'EN',
      licenseLabel: 'Public Domain (CC0 Typography)',
    };

    const parsedDate = pubDate ? new Date(pubDate) : null;
    const digitalReleaseYear = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : null;

    books.push({
      id: `se-${slugParts.slice(1).join('-')}`,
      normalizedKey: normalizeBookKey(title, authorName),
      title,
      authors,
      primaryAuthor: authorName,
      kind,
      genres,
      subjects: categories,
      languages: ['en'],
      coverUrl: `/api/cover?url=${encodeURIComponent(rawCoverUrl)}`,
      rawCoverUrl,
      downloadCount: null,
      publicationYear: null,
      digitalReleaseYear,
      copyrightStatus: copyrightCheck.status,
      freeAccessType: copyrightCheck.freeAccessType,
      copyrightNote: copyrightCheck.note,
      summary: description ? cheerio.load(description).text().slice(0, 420).trim() : null,
      isNewArrival: true,
      addedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : now,
      updatedAt: now,
      editions: [edition],
    });
  });

  return books;
}

function parseStandardEbooksHtmlListing(html: string): CatalogBook[] {
  const $ = cheerio.load(html);
  const books: CatalogBook[] = [];
  const now = new Date().toISOString();

  $('ol.ebooks-list > li, li[typeof="schema:Book"]').each((_, el) => {
    const item = $(el);
    const titleEl = item.find('p a[property="schema:url"], p > a').first();
    const title = titleEl.text().trim();
    const href = titleEl.attr('href');
    if (!title || !href) return;

    const authorName = item.find('p.author a, [property="schema:author"] a').first().text().trim() || 'Various Authors';
    const imgSrc = item.find('img').first().attr('src') || '';
    const rawCoverUrl = imgSrc
      ? imgSrc.startsWith('http')
        ? imgSrc
        : `https://standardebooks.org${imgSrc}`
      : null;

    const tags: string[] = [];
    item.find('ul.tags li, .tags a').each((__, t) => {
      const val = $(t).text().trim();
      if (val) tags.push(val);
    });

    const cleanPath = href.replace(/^https?:\/\/standardebooks\.org/, '').replace(/\/$/, '');
    const slugParts = cleanPath.split('/').filter(Boolean);
    const seSlug = slugParts.slice(1).join('_');
    const authors: BookAuthor[] = [{name: authorName, birthYear: null, deathYear: null}];
    const copyrightCheck = evaluateCopyrightForIndia(authors, {isCC0OrPublicDomain: true});
    const {genres, kind} = classifyGenresAndKind(tags, title);

    const edition: BookEdition = {
      editionId: `se-${slugParts.slice(1).join('-')}`,
      provider: 'standard-ebooks',
      providerLabel: 'Standard Ebooks',
      sourceBookId: cleanPath,
      sourceUrl: `https://standardebooks.org${cleanPath}`,
      readHtmlUrl: `https://standardebooks.org${cleanPath}/text/single-page`,
      readEpubUrl: seSlug ? `https://standardebooks.org${cleanPath}/downloads/${seSlug}.epub` : undefined,
      externalReadUrl: `https://standardebooks.org${cleanPath}`,
      formatLabel: 'Curated XHTML & EPUB',
      language: 'EN',
      licenseLabel: 'Public Domain (CC0 Typography)',
    };

    books.push({
      id: `se-${slugParts.slice(1).join('-')}`,
      normalizedKey: normalizeBookKey(title, authorName),
      title,
      authors,
      primaryAuthor: authorName,
      kind,
      genres,
      subjects: tags,
      languages: ['en'],
      coverUrl: rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null,
      rawCoverUrl,
      downloadCount: null,
      publicationYear: null,
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
  });

  return books;
}

export async function fetchStandardEbooksNewReleases(): Promise<CatalogBook[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://standardebooks.org/feeds/rss/new-releases', {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`Standard Ebooks RSS returned HTTP ${res.status}`);
    }
    const xml = await res.text();
    return parseStandardEbooksRss(xml);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStandardEbooksCatalog(params?: {query?: string; page?: number}): Promise<CatalogBook[]> {
  const qs = new URLSearchParams();
  qs.set('per-page', '24');
  if (params?.page) qs.set('page', String(params.page));
  if (params?.query) qs.set('query', params.query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://standardebooks.org/ebooks?${qs.toString()}`, {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`Standard Ebooks catalog returned HTTP ${res.status}`);
    }
    const html = await res.text();
    return parseStandardEbooksHtmlListing(html);
  } finally {
    clearTimeout(timer);
  }
}
