import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface OpenAlexWork {
  id: string;
  title: string;
  publication_year?: number;
  language?: string;
  cited_by_count?: number;
  authorships?: Array<{author?: {display_name?: string}}>;
  topics?: Array<{display_name?: string; field?: {display_name?: string}}>;
  open_access?: {is_oa?: boolean; oa_url?: string | null};
  primary_location?: {
    landing_page_url?: string | null;
    license?: string | null;
    source?: {display_name?: string | null} | null;
  } | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

// Exclude raw repository re-uploads that often contain older public-domain reprints with 2020s timestamps
const NOISY_REPRINT_SOURCES = ['zenodo', 'internet archive', 'wikisource', 'project gutenberg'];

export async function fetchOpenAlexContemporaryBooks(params: {
  yearRange?: string;
  search?: string;
  perPage?: number;
  hintGenre?: string;
}): Promise<CatalogBook[]> {
  const yearFilter = params.yearRange || '2000-2026';
  const filters = [
    'type:book',
    'is_oa:true',
    'language:en',
    `publication_year:${yearFilter}`,
    'primary_location.license:cc-by|cc-by-nc|cc-by-sa|cc-by-nc-sa|cc-by-nc-nd|cc0',
  ].join(',');

  const qs = new URLSearchParams({
    filter: filters,
    sort: params.search ? 'relevance_score:desc' : 'cited_by_count:desc',
    'per-page': String(params.perPage || 20),
    select: 'id,title,publication_year,language,cited_by_count,authorships,topics,open_access,primary_location',
  });
  if (params.search) {
    qs.set('search', params.search);
  }

  const res = await fetch(`https://api.openalex.org/works?${qs.toString()}`, {
    signal: AbortSignal.timeout(11000),
    headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (mailto:hello@folio.local)'},
  });
  if (!res.ok) {
    throw new Error(`OpenAlex API returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as OpenAlexResponse;
  const now = new Date().toISOString();
  const books: CatalogBook[] = [];

  for (const w of data.results || []) {
    if (!w.title || !w.open_access?.oa_url) continue;

    const sourceName = w.primary_location?.source?.display_name || '';
    if (NOISY_REPRINT_SOURCES.some((s) => sourceName.toLowerCase().includes(s))) {
      continue;
    }

    // Skip single-article/test-guideline fragments
    if (/^test no\.\s*\d+/i.test(w.title)) continue;

    const authors: BookAuthor[] = (w.authorships || [])
      .map((a) => a.author?.display_name?.trim())
      .filter((n): n is string => Boolean(n))
      .slice(0, 4)
      .map((name) => ({name, birthYear: null, deathYear: null}));

    if (authors.length === 0) continue;
    const primaryAuthor = authors[0].name;

    const subjects = (w.topics || [])
      .flatMap((t) => [t.display_name, t.field?.display_name])
      .filter((s): s is string => Boolean(s))
      .slice(0, 8);

    const {genres} = classifyGenresAndKind(subjects, w.title, params.hintGenre);
    const licenseRaw = (w.primary_location?.license || 'cc-by').toUpperCase();
    const copyrightCheck = evaluateCopyrightForIndia(authors, {
      explicitCCLicense: licenseRaw,
    });

    const workSlug = w.id.replace(/^https?:\/\/openalex\.org\//, '');
    const landingUrl = w.primary_location?.landing_page_url || w.open_access.oa_url;

    const edition: BookEdition = {
      editionId: `oa-${workSlug}`,
      provider: 'openalex',
      providerLabel: sourceName ? `OpenAlex · ${sourceName}` : 'OpenAlex OA Books',
      sourceBookId: workSlug,
      sourceUrl: landingUrl,
      externalReadUrl: w.open_access.oa_url,
      formatLabel: `Open Access (${licenseRaw})`,
      language: 'EN',
      licenseLabel: licenseRaw,
    };

    const pubYear = typeof w.publication_year === 'number' ? w.publication_year : null;

    books.push({
      id: `oa-${workSlug}`,
      normalizedKey: normalizeBookKey(w.title, primaryAuthor),
      title: w.title.replace(/\s+/g, ' ').trim(),
      authors,
      primaryAuthor,
      kind: 'book',
      genres,
      subjects,
      languages: ['en'],
      coverUrl: null,
      rawCoverUrl: null,
      downloadCount: w.cited_by_count ?? null,
      publicationYear: pubYear,
      digitalReleaseYear: pubYear,
      copyrightStatus: copyrightCheck.status,
      freeAccessType: copyrightCheck.freeAccessType,
      copyrightNote: copyrightCheck.note,
      summary: sourceName ? `Open-access book published via ${sourceName}.` : null,
      isNewArrival: Boolean(pubYear && pubYear >= 2025),
      addedAt: now,
      updatedAt: now,
      editions: [edition],
    });
  }

  return books;
}
