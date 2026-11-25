import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface SpeculativeFeedSpec {
  id: string;
  label: string;
  feedUrl: string;
  defaultGenres: string[];
}

const FEEDS: SpeculativeFeedSpec[] = [
  {
    id: 'clarkesworld',
    label: 'Clarkesworld Magazine',
    feedUrl: 'https://clarkesworldmagazine.com/feed/',
    defaultGenres: ['science-fiction', 'fantasy', 'short-stories'],
  },
  {
    id: 'lightspeed',
    label: 'Lightspeed Magazine',
    feedUrl: 'https://www.lightspeedmagazine.com/feed/',
    defaultGenres: ['science-fiction', 'fantasy', 'short-stories'],
  },
  {
    id: 'uncanny',
    label: 'Uncanny Magazine',
    feedUrl: 'https://www.uncannymagazine.com/feed/',
    defaultGenres: ['fantasy', 'science-fiction', 'short-stories'],
  },
];

function parseTitleAndAuthor(rawTitle: string, dcCreator: string): {title: string; author: string} {
  // Clarkesworld titles often look like "Story Title by Author Name"
  const byMatch = rawTitle.match(/^(.+?)\s+by\s+([^()]+?)(?:\s*\([^)]*\))?$/i);
  if (byMatch) {
    return {
      title: byMatch[1].trim(),
      author: byMatch[2].trim() || dcCreator || 'Staff Author',
    };
  }
  return {
    title: rawTitle.trim(),
    author: dcCreator.trim() || 'Contemporary Author',
  };
}

async function fetchSingleFeed(spec: SpeculativeFeedSpec): Promise<CatalogBook[]> {
  const res = await fetch(spec.feedUrl, {
    signal: AbortSignal.timeout(9000),
    headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
  });
  if (!res.ok) {
    throw new Error(`${spec.label} RSS returned HTTP ${res.status}`);
  }
  const xml = await res.text();
  const $ = cheerio.load(xml, {xmlMode: true});
  const books: CatalogBook[] = [];
  const now = new Date().toISOString();

  $('item').each((_, el) => {
    const rawTitle = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const pubDateStr = $(el).find('pubDate').first().text().trim();
    const creator = $(el).find('dc\\:creator, creator').first().text().trim();
    const description = $(el).find('description').first().text().trim();

    if (!rawTitle || !link) return;
    // Skip podcasts, audio versions, interviews, editorials, and reviews
    if (/\(audio\)|podcast|interview:|editorial|book review|cover art|table of contents/i.test(rawTitle)) {
      return;
    }

    const categories: string[] = [];
    $(el)
      .find('category')
      .each((__, cat) => {
        const c = $(cat).text().trim();
        if (c) categories.push(c);
      });

    // Only keep fiction/story/novella/novelette items when categories are present
    const catJoined = categories.join(' ').toLowerCase();
    if (
      catJoined.includes('interview') ||
      catJoined.includes('non-fiction') ||
      catJoined.includes('review') ||
      catJoined.includes('podcast') ||
      catJoined.includes('editorial')
    ) {
      return;
    }

    const {title, author} = parseTitleAndAuthor(rawTitle, creator);
    const parsedDate = pubDateStr ? new Date(pubDateStr) : null;
    const pubYear =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : null;

    const authors: BookAuthor[] = [{name: author, birthYear: null, deathYear: null}];
    const copyrightCheck = evaluateCopyrightForIndia(authors, {isPublisherFreeLibrary: true});

    const mergedSubjects = Array.from(new Set([...spec.defaultGenres, ...categories]));
    const {genres} = classifyGenresAndKind(mergedSubjects, title, 'science-fiction');
    if (!genres.includes('short-stories')) genres.push('short-stories');

    const slug = link
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 64);

    const edition: BookEdition = {
      editionId: `sp-${spec.id}-${slug}`,
      provider: 'speculative-press',
      providerLabel: spec.label,
      sourceBookId: link,
      sourceUrl: link,
      readHtmlUrl: link,
      externalReadUrl: link,
      formatLabel: 'Full Contemporary Web Edition',
      language: 'EN',
      licenseLabel: 'Free Publisher Web Edition',
    };

    const cleanSummary = description
      ? cheerio.load(description).text().replace(/\s+/g, ' ').trim().slice(0, 360)
      : null;

    books.push({
      id: `sp-${spec.id}-${slug}`,
      normalizedKey: normalizeBookKey(title, author),
      title,
      authors,
      primaryAuthor: author,
      kind: 'novel',
      genres: genres.slice(0, 4),
      subjects: mergedSubjects.slice(0, 8),
      languages: ['en'],
      coverUrl: null,
      rawCoverUrl: null,
      downloadCount: null,
      publicationYear: pubYear,
      digitalReleaseYear: pubYear,
      copyrightStatus: copyrightCheck.status,
      freeAccessType: copyrightCheck.freeAccessType,
      copyrightNote: copyrightCheck.note,
      summary: cleanSummary,
      isNewArrival: Boolean(pubYear && pubYear >= 2025),
      addedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : now,
      updatedAt: now,
      editions: [edition],
    });
  });

  return books.slice(0, 12);
}

export async function fetchSpeculativePressFiction(): Promise<CatalogBook[]> {
  const settled = await Promise.allSettled(FEEDS.map((f) => fetchSingleFeed(f)));
  const all: CatalogBook[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') all.push(...s.value);
  }
  return all;
}
