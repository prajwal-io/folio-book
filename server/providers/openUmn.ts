import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface OpenUmnContributor {
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  contribution?: string;
}

interface OpenUmnFormat {
  type?: string;
  url?: string;
  price?: {cents?: number};
}

interface OpenUmnSubject {
  name?: string;
}

interface OpenUmnBook {
  id: number;
  title: string;
  copyright_year: number | null;
  license?: string | null;
  language?: string | null;
  description?: string | null;
  contributors?: OpenUmnContributor[];
  subjects?: OpenUmnSubject[];
  formats?: OpenUmnFormat[];
}

interface OpenUmnResponse {
  data?: OpenUmnBook[];
}

function mapOpenUmnBook(item: OpenUmnBook): CatalogBook | null {
  if (!item.title) return null;
  if (item.language && item.language !== 'eng' && item.language !== 'en') return null;

  const freeFormats = (item.formats || []).filter(
    (f) => f.url && (!f.price || (f.price.cents ?? 0) === 0),
  );
  if (freeFormats.length === 0) return null;

  const onlineFmt =
    freeFormats.find((f) => f.type === 'Online' || f.type === 'eBook') || freeFormats[0];
  if (!onlineFmt?.url) return null;

  const authors: BookAuthor[] = (item.contributors || [])
    .map((c): BookAuthor | null => {
      const full = [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim();
      return full ? {name: full, birthYear: null, deathYear: null} : null;
    })
    .filter((a): a is BookAuthor => Boolean(a))
    .slice(0, 4);

  if (authors.length === 0) {
    authors.push({name: 'Open Education Contributors', birthYear: null, deathYear: null});
  }
  const primaryAuthor = authors[0].name;

  const subjects = (item.subjects || [])
    .map((s) => s.name?.trim())
    .filter((s): s is string => Boolean(s));

  const lower = `${item.title} ${subjects.join(' ')}`.toLowerCase();
  let hintGenre: string | undefined;
  if (lower.includes('entrepreneur') || lower.includes('startup')) hintGenre = 'entrepreneurship';
  else if (lower.includes('business') || lower.includes('marketing') || lower.includes('finance') || lower.includes('management')) hintGenre = 'business';
  else if (lower.includes('psychology') || lower.includes('mental')) hintGenre = 'psychology';
  else if (lower.includes('computer') || lower.includes('programming') || lower.includes('software') || lower.includes('technology') || lower.includes('engineering')) hintGenre = 'technology';
  else if (lower.includes('success') || lower.includes('leadership') || lower.includes('communication')) hintGenre = 'self-development';
  else if (lower.includes('literature') || lower.includes('writing') || lower.includes('fiction')) hintGenre = 'literature';

  const {genres} = classifyGenresAndKind(subjects, item.title, hintGenre);
  const licenseText = item.license ? `CC ${item.license}` : 'Creative Commons Open License';
  const copyrightCheck = evaluateCopyrightForIndia(authors, {
    explicitCCLicense: licenseText,
  });

  const pubYear =
    typeof item.copyright_year === 'number' && item.copyright_year >= 1995 && item.copyright_year <= 2030
      ? item.copyright_year
      : null;

  const now = new Date().toISOString();
  const isPressbooksOrLibre =
    onlineFmt.url.includes('pressbooks') ||
    onlineFmt.url.includes('open.lib.umn.edu') ||
    onlineFmt.url.includes('libretexts.org');

  const edition: BookEdition = {
    editionId: `umn-${item.id}`,
    provider: 'open-umn',
    providerLabel: 'Open Textbook Library',
    sourceBookId: String(item.id),
    sourceUrl: `https://open.umn.edu/opentextbooks/textbooks/${item.id}`,
    readHtmlUrl: isPressbooksOrLibre ? onlineFmt.url : undefined,
    externalReadUrl: onlineFmt.url,
    formatLabel: `${onlineFmt.type || 'Open'} Edition`,
    language: 'EN',
    licenseLabel: licenseText,
  };

  return {
    id: `umn-${item.id}`,
    normalizedKey: normalizeBookKey(item.title, primaryAuthor),
    title: item.title.trim(),
    authors,
    primaryAuthor,
    kind: 'book',
    genres,
    subjects,
    languages: ['en'],
    coverUrl: null,
    rawCoverUrl: null,
    downloadCount: null,
    publicationYear: pubYear,
    digitalReleaseYear: pubYear,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: copyrightCheck.note,
    summary: item.description ? item.description.replace(/\s+/g, ' ').trim().slice(0, 420) : null,
    isNewArrival: Boolean(pubYear && pubYear >= 2025),
    addedAt: now,
    updatedAt: now,
    editions: [edition],
  };
}

export async function fetchOpenUmnBooks(params: {page?: number; q?: string}): Promise<CatalogBook[]> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.q) qs.set('q', params.q);

  const res = await fetch(`https://open.umn.edu/opentextbooks/textbooks.json?${qs.toString()}`, {
    signal: AbortSignal.timeout(10000),
    headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
  });
  if (!res.ok) {
    throw new Error(`Open Textbook Library returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as OpenUmnResponse;
  const books: CatalogBook[] = [];
  for (const item of json.data || []) {
    const mapped = mapOpenUmnBook(item);
    if (mapped) books.push(mapped);
  }
  return books;
}
