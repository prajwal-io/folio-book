import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface WikisourceCuratedSeed {
  page: string;
  title: string;
  author: string;
  deathYear: number | null;
  subjects: string[];
  year: number | null;
}

// Verified canonical Wikisource pages (public domain in India & worldwide)
const WIKISOURCE_SEEDS: WikisourceCuratedSeed[] = [
  {
    page: 'Gitanjali',
    title: 'Gitanjali (Song Offerings)',
    author: 'Rabindranath Tagore',
    deathYear: 1941,
    subjects: ['Poetry', 'Literature', 'Philosophy', 'Indian Literature'],
    year: 1912,
  },
  {
    page: 'The_Home_and_the_World',
    title: 'The Home and the World',
    author: 'Rabindranath Tagore',
    deathYear: 1941,
    subjects: ['Fiction', 'Classics', 'Literature', 'Indian Literature'],
    year: 1919,
  },
  {
    page: 'Sadhana:_The_Realisation_of_Life',
    title: 'Sadhana: The Realisation of Life',
    author: 'Rabindranath Tagore',
    deathYear: 1941,
    subjects: ['Philosophy', 'Self-development', 'Literature'],
    year: 1913,
  },
  {
    page: 'The_Complete_Works_of_Swami_Vivekananda/Volume_1/Karma-Yoga',
    title: 'Karma-Yoga',
    author: 'Swami Vivekananda',
    deathYear: 1902,
    subjects: ['Philosophy', 'Self-development', 'Education'],
    year: 1896,
  },
  {
    page: 'Indian_Home_Rule',
    title: 'Hind Swaraj or Indian Home Rule',
    author: 'Mahatma Gandhi',
    deathYear: 1948,
    subjects: ['History', 'Philosophy', 'Literature'],
    year: 1909,
  },
  {
    page: 'The_Golden_Threshold',
    title: 'The Golden Threshold',
    author: 'Sarojini Naidu',
    deathYear: 1949,
    subjects: ['Poetry', 'Literature'],
    year: 1905,
  },
  {
    page: 'Self-Reliance',
    title: 'Self-Reliance',
    author: 'Ralph Waldo Emerson',
    deathYear: 1882,
    subjects: ['Philosophy', 'Self-development', 'Literature', 'Essays'],
    year: 1841,
  },
  {
    page: 'The_Art_of_War_(Sun)',
    title: 'The Art of War',
    author: 'Sun Tzu',
    deathYear: -496,
    subjects: ['Philosophy', 'History', 'Business', 'Self-development'],
    year: -500,
  },
];

function buildWikisourceBook(seed: {
  page: string;
  title: string;
  author: string;
  deathYear: number | null;
  subjects: string[];
  year: number | null;
  snippet?: string;
}): CatalogBook {
  const authors: BookAuthor[] = [{name: seed.author, birthYear: null, deathYear: seed.deathYear}];
  const copyrightCheck = evaluateCopyrightForIndia(authors, {isCCBySa: true});
  const {genres, kind} = classifyGenresAndKind(seed.subjects, seed.title);
  const now = new Date().toISOString();
  const cleanPageUrl = `https://en.wikisource.org/wiki/${encodeURIComponent(seed.page.replace(/ /g, '_'))}`;

  const edition: BookEdition = {
    editionId: `ws-${seed.page}`,
    provider: 'wikisource',
    providerLabel: 'Wikisource',
    sourceBookId: seed.page,
    sourceUrl: cleanPageUrl,
    readHtmlUrl: `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(seed.page)}&format=json&origin=*`,
    externalReadUrl: cleanPageUrl,
    formatLabel: 'Structured Wiki Edition',
    language: 'EN',
    licenseLabel: 'Public Domain / CC BY-SA',
  };

  return {
    id: `ws-${seed.page.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    normalizedKey: normalizeBookKey(seed.title, seed.author),
    title: seed.title,
    authors,
    primaryAuthor: seed.author,
    kind,
    genres,
    subjects: seed.subjects,
    languages: ['en'],
    coverUrl: null,
    rawCoverUrl: null,
    downloadCount: null,
    publicationYear: seed.year,
    digitalReleaseYear: null,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: copyrightCheck.note,
    summary: seed.snippet || null,
    isNewArrival: false,
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchWikisourceSeeds(): Promise<CatalogBook[]> {
  return WIKISOURCE_SEEDS.map((s) => buildWikisourceBook(s));
}

export async function searchWikisource(query: string, hintGenre?: string): Promise<CatalogBook[]> {
  const qs = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: '10',
    format: 'json',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(`https://en.wikisource.org/w/api.php?${qs.toString()}`, {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`Wikisource API returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      query?: {search?: Array<{title: string; snippet?: string}>};
    };

    const results: CatalogBook[] = [];
    for (const hit of data.query?.search || []) {
      // Skip disambiguation/translation index clutter with slash-heavy sub-chapters unless it's a root work
      if (hit.title.includes('/Chapter') || hit.title.includes('(disambiguation)')) continue;
      const cleanSnippet = hit.snippet ? cheerio.load(hit.snippet).text().trim() : undefined;
      const book = buildWikisourceBook({
        page: hit.title.replace(/ /g, '_'),
        title: hit.title.replace(/\([^)]*\)/g, '').trim() || hit.title,
        author: 'Wikisource Archive',
        deathYear: null,
        subjects: hintGenre ? [hintGenre, 'Literature'] : ['Literature'],
        year: null,
        snippet: cleanSnippet,
      });
      results.push(book);
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}
