import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface WikibookSeed {
  page: string;
  title: string;
  year: number;
  subjects: string[];
  hintGenre: string;
}

const WIKIBOOK_SEEDS: WikibookSeed[] = [
  {
    page: 'Non-Programmer%27s_Tutorial_for_Python_3',
    title: "Non-Programmer's Tutorial for Python 3",
    year: 2023,
    subjects: ['Technology', 'Programming', 'Education'],
    hintGenre: 'technology',
  },
  {
    page: 'Cognitive_Psychology_and_Cognitive_Neuroscience',
    title: 'Cognitive Psychology and Cognitive Neuroscience',
    year: 2021,
    subjects: ['Psychology', 'Science', 'Neuroscience'],
    hintGenre: 'psychology',
  },
  {
    page: 'Principles_of_Finance',
    title: 'Principles of Finance',
    year: 2020,
    subjects: ['Business', 'Finance', 'Economics'],
    hintGenre: 'business',
  },
  {
    page: 'Getting_Started_as_an_Entrepreneur',
    title: 'Getting Started as an Entrepreneur',
    year: 2019,
    subjects: ['Entrepreneurship', 'Business', 'Self-development'],
    hintGenre: 'entrepreneurship',
  },
  {
    page: 'Introduction_to_Philosophy',
    title: 'Introduction to Philosophy',
    year: 2022,
    subjects: ['Philosophy', 'Ethics', 'Education'],
    hintGenre: 'philosophy',
  },
  {
    page: 'Creative_Writing',
    title: 'Creative Writing',
    year: 2022,
    subjects: ['Literature', 'Writing', 'Education'],
    hintGenre: 'literature',
  },
];

function buildWikibook(seed: WikibookSeed): CatalogBook {
  const decodedPage = decodeURIComponent(seed.page);
  const authors: BookAuthor[] = [{name: 'Wikibooks Contributors', birthYear: null, deathYear: null}];
  const copyrightCheck = evaluateCopyrightForIndia(authors, {
    explicitCCLicense: 'CC BY-SA 4.0',
  });
  const {genres} = classifyGenresAndKind(seed.subjects, seed.title, seed.hintGenre);
  const now = new Date().toISOString();
  const webUrl = `https://en.wikibooks.org/wiki/${decodedPage}`;

  const edition: BookEdition = {
    editionId: `wb-${decodedPage.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    provider: 'wikibooks',
    providerLabel: 'Wikibooks (CC BY-SA)',
    sourceBookId: decodedPage,
    sourceUrl: webUrl,
    readHtmlUrl: `https://en.wikibooks.org/w/api.php?action=parse&page=${encodeURIComponent(decodedPage)}&redirects=1&format=json`,
    externalReadUrl: webUrl,
    formatLabel: 'Open Wiki Book (CC BY-SA)',
    language: 'EN',
    licenseLabel: 'CC BY-SA 4.0',
  };

  return {
    id: `wb-${decodedPage.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    normalizedKey: normalizeBookKey(seed.title, 'Wikibooks Contributors'),
    title: seed.title,
    authors,
    primaryAuthor: 'Wikibooks Contributors',
    kind: 'book',
    genres,
    subjects: seed.subjects,
    languages: ['en'],
    coverUrl: null,
    rawCoverUrl: null,
    downloadCount: null,
    publicationYear: seed.year,
    digitalReleaseYear: seed.year,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: copyrightCheck.note,
    summary: `Openly developed contemporary ${seed.hintGenre} book under Creative Commons BY-SA.`,
    isNewArrival: false,
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchWikibooksCatalog(): Promise<CatalogBook[]> {
  return WIKIBOOK_SEEDS.map((s) => buildWikibook(s));
}

export async function searchWikibooks(query: string): Promise<CatalogBook[]> {
  const qs = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: '6',
    format: 'json',
  });

  const res = await fetch(`https://en.wikibooks.org/w/api.php?${qs.toString()}`, {
    signal: AbortSignal.timeout(8000),
    headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: {search?: Array<{title: string; timestamp?: string}>};
  };

  const results: CatalogBook[] = [];
  for (const hit of data.query?.search || []) {
    if (hit.title.includes('/')) continue; // skip sub-chapters in search results
    const yr = hit.timestamp ? new Date(hit.timestamp).getFullYear() : 2022;
    results.push(
      buildWikibook({
        page: encodeURIComponent(hit.title.replace(/ /g, '_')),
        title: hit.title,
        year: yr >= 2001 ? yr : 2022,
        subjects: ['Open Education', 'Reference'],
        hintGenre: 'education',
      }),
    );
  }
  return results;
}
