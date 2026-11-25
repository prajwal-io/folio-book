import type {
  AudiobookEdition,
  AudiobookTrack,
  BookAuthor,
  BookEdition,
  CatalogBook,
} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

interface LibriVoxAuthor {
  id: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  dod?: string;
}

interface LibriVoxSection {
  id: string;
  section_number: string;
  title: string;
  listen_url?: string;
  language?: string;
  playtime?: string | number;
  readers?: Array<{reader_id?: string; display_name?: string}>;
}

interface LibriVoxGenre {
  id: string;
  name: string;
}

interface LibriVoxBookRaw {
  id: string;
  title: string;
  description?: string;
  url_text_source?: string;
  language?: string;
  copyright_year?: string;
  num_sections?: string | number;
  url_rss?: string;
  url_librivox?: string;
  url_iarchive?: string;
  totaltime?: string;
  totaltimesecs?: number;
  authors?: LibriVoxAuthor[];
  sections?: LibriVoxSection[];
  genres?: LibriVoxGenre[];
}

interface LibriVoxResponse {
  books?: LibriVoxBookRaw[];
}

const tracksCache = new Map<string, {expiresAt: number; tracks: AudiobookTrack[]}>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function toHttpsUrl(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice(7)}`;
  }
  return trimmed;
}

function parseYearInt(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!/^\d{4}$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (num < 500 || num > new Date().getFullYear()) return null;
  return num;
}

function stripHtmlTags(raw?: string): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 20 ? text.slice(0, 800) : null;
}

function parseTracks(sections?: LibriVoxSection[]): AudiobookTrack[] {
  if (!Array.isArray(sections)) return [];
  const tracks: AudiobookTrack[] = [];
  for (const sec of sections) {
    const audioUrl = toHttpsUrl(sec.listen_url);
    if (!audioUrl || !audioUrl.startsWith('https://')) continue;
    const dur = Number(sec.playtime) || 0;
    const narrators = Array.from(
      new Set(
        (sec.readers || [])
          .map((r) => r.display_name?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    );
    tracks.push({
      index: tracks.length,
      sectionNumber: String(sec.section_number || tracks.length + 1),
      title: (sec.title || `Section ${tracks.length + 1}`).replace(/\s+/g, ' ').trim(),
      audioUrl,
      durationSeconds: dur,
      narrators,
    });
  }
  return tracks;
}

function buildAudiobookEdition(raw: LibriVoxBookRaw): AudiobookEdition | null {
  const tracks = parseTracks(raw.sections);
  const numSections = Number(raw.num_sections) || tracks.length;
  if (tracks.length === 0 && numSections === 0) return null;

  const narratorSet = new Set<string>();
  for (const t of tracks) {
    for (const n of t.narrators) narratorSet.add(n);
  }
  const narrators = narratorSet.size > 0 ? Array.from(narratorSet).slice(0, 6) : ['LibriVox Volunteers'];

  return {
    audiobookId: String(raw.id),
    provider: 'librivox',
    providerLabel: 'LibriVox · Human Narrated',
    narratorType: 'human',
    narrators,
    language: raw.language || 'English',
    totalTime: raw.totaltime || 'Audiobook',
    totalTimeSecs: Number(raw.totaltimesecs) || tracks.reduce((s, t) => s + t.durationSeconds, 0),
    numSections,
    sourceUrl: toHttpsUrl(raw.url_librivox) || `https://librivox.org/rss/${raw.id}`,
    rssUrl: toHttpsUrl(raw.url_rss) || `https://librivox.org/rss/${raw.id}`,
    tracks: tracks.length > 0 ? tracks : undefined,
  };
}

function isAlternateVersionTitle(title: string): boolean {
  return /\(\s*(version\s*\d+|dramatic reading|solo|group)/i.test(title);
}

function extractGutenbergId(textSourceUrl?: string): string | null {
  if (!textSourceUrl) return null;
  const m = textSourceUrl.match(/gutenberg\.org\/(?:etext|ebooks)\/(\d+)/i);
  return m?.[1] || null;
}

function mapLibriVoxBook(raw: LibriVoxBookRaw): CatalogBook | null {
  if (!raw.title || (raw.language && raw.language.toLowerCase() !== 'english')) {
    return null;
  }
  // Skip noisy multi-version re-recordings in initial catalog discovery so clean primary editions win
  if (isAlternateVersionTitle(raw.title)) {
    return null;
  }

  const abEdition = buildAudiobookEdition(raw);
  if (!abEdition) return null;

  if (abEdition.tracks && abEdition.tracks.length > 0) {
    tracksCache.set(abEdition.audiobookId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tracks: abEdition.tracks,
    });
  }

  const authors: BookAuthor[] = (raw.authors || []).map((a) => {
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || 'Various Authors';
    return {
      name: fullName,
      birthYear: parseYearInt(a.dob),
      deathYear: parseYearInt(a.dod),
    };
  });
  const primaryAuthor = authors[0]?.name || 'Various Authors';

  const pubYear = parseYearInt(raw.copyright_year);
  const copyrightCheck = evaluateCopyrightForIndia(authors, {
    gutenbergCopyright: false,
  });
  if (!copyrightCheck.allowInCatalog) {
    return null;
  }

  const subjects = (raw.genres || [])
    .map((g) => g.name.trim())
    .filter((s) => s && !/^published\s+/i.test(s));
  const {genres, kind} = classifyGenresAndKind(subjects, raw.title);

  const cleanTitle = raw.title.replace(/\s+/g, ' ').trim();
  const gutId = extractGutenbergId(raw.url_text_source);

  const editions: BookEdition[] = [];
  if (gutId) {
    editions.push({
      editionId: `gutendex-${gutId}`,
      provider: 'gutendex',
      providerLabel: 'Project Gutenberg',
      sourceBookId: gutId,
      sourceUrl: `https://www.gutenberg.org/ebooks/${gutId}`,
      readHtmlUrl: `https://gutenberg.pglaf.org/cache/epub/${gutId}/pg${gutId}-images.html`,
      readEpubUrl: `https://gutenberg.pglaf.org/cache/epub/${gutId}/pg${gutId}-images.epub`,
      readTextUrl: `https://gutenberg.pglaf.org/cache/epub/${gutId}/pg${gutId}.txt`,
      externalReadUrl: `https://www.gutenberg.org/ebooks/${gutId}`,
      formatLabel: 'Full HTML & Audiobook',
      language: 'EN',
      licenseLabel: 'Public Domain',
    });
  } else {
    editions.push({
      editionId: `librivox-${raw.id}`,
      provider: 'librivox',
      providerLabel: 'LibriVox Audiobook',
      sourceBookId: String(raw.id),
      sourceUrl: abEdition.sourceUrl,
      externalReadUrl: abEdition.sourceUrl,
      formatLabel: `MP3 Audiobook (${abEdition.numSections} parts)`,
      language: 'EN',
      licenseLabel: 'Public Domain Audio',
    });
  }

  const rawCoverUrl = gutId
    ? `https://gutenberg.pglaf.org/cache/epub/${gutId}/pg${gutId}.cover.medium.jpg`
    : null;
  const coverUrl = rawCoverUrl ? `/api/cover?url=${encodeURIComponent(rawCoverUrl)}` : null;

  const now = new Date().toISOString();

  return {
    id: gutId ? `pg-${gutId}` : `lv-${raw.id}`,
    normalizedKey: normalizeBookKey(cleanTitle, primaryAuthor),
    title: cleanTitle,
    authors,
    primaryAuthor,
    kind,
    genres,
    subjects: subjects.slice(0, 8),
    languages: ['en'],
    coverUrl,
    rawCoverUrl,
    downloadCount: null,
    publicationYear: pubYear,
    digitalReleaseYear: null,
    copyrightStatus: copyrightCheck.status,
    freeAccessType: copyrightCheck.freeAccessType,
    copyrightNote: `${copyrightCheck.note} Human-narrated recording released into the public domain via LibriVox.`,
    summary: stripHtmlTags(raw.description),
    isNewArrival: false,
    addedAt: now,
    updatedAt: now,
    editions,
    audiobooks: [abEdition],
  };
}

async function fetchLibriVoxJson(url: string, timeoutMs = 9500): Promise<LibriVoxBookRaw[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
    });
    if (!res.ok) {
      throw new Error(`LibriVox responded with HTTP ${res.status}`);
    }
    const data = (await res.json()) as LibriVoxResponse;
    return Array.isArray(data.books) ? data.books : [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLibriVoxCatalog(): Promise<CatalogBook[]> {
  const urls = [
    'https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=45&offset=0',
    'https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=45&offset=50',
    'https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=35&offset=150',
  ];

  const settled = await Promise.allSettled(urls.map((u) => fetchLibriVoxJson(u, 11000)));
  const collected: CatalogBook[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const raw of r.value) {
      const mapped = mapLibriVoxBook(raw);
      if (mapped) collected.push(mapped);
    }
  }
  return collected;
}

export async function searchLibriVoxBooks(query: string): Promise<CatalogBook[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const encodedTitle = encodeURIComponent(`^${clean}`);
  const encodedAuthor = encodeURIComponent(clean);

  const settled = await Promise.allSettled([
    fetchLibriVoxJson(
      `https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=12&title=${encodedTitle}`,
      7500,
    ),
    fetchLibriVoxJson(
      `https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=10&author=${encodedAuthor}`,
      7500,
    ),
  ]);

  const books: CatalogBook[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const raw of r.value) {
      const mapped = mapLibriVoxBook(raw);
      if (mapped) books.push(mapped);
    }
  }
  return books;
}

export async function fetchLibriVoxAudiobookTracks(audiobookId: string): Promise<AudiobookTrack[]> {
  const cached = tracksCache.get(audiobookId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tracks;
  }

  const rows = await fetchLibriVoxJson(
    `https://librivox.org/api/feed/audiobooks/?format=json&extended=1&id=${encodeURIComponent(audiobookId)}`,
    9500,
  );
  const first = rows[0];
  if (!first) return [];

  const tracks = parseTracks(first.sections);
  if (tracks.length > 0) {
    tracksCache.set(audiobookId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tracks,
    });
  }
  return tracks;
}

export async function findLibriVoxMatchForBook(
  title: string,
  author: string,
): Promise<AudiobookEdition | null> {
  const shortTitle = title
    .replace(/\([^)]*\)/g, '')
    .replace(/:\s.*$/, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
  if (shortTitle.length < 3) return null;

  const targetKey = normalizeBookKey(title, author);
  const authorSurname = author
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(-1)[0];

  try {
    const candidates = await fetchLibriVoxJson(
      `https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=10&title=${encodeURIComponent(`^${shortTitle}`)}`,
      8000,
    );

    const englishMatches = candidates.filter((raw) => {
      if (raw.language && raw.language.toLowerCase() !== 'english') return false;
      const lvAuthor = raw.authors?.[0]
        ? [raw.authors[0].first_name, raw.authors[0].last_name].filter(Boolean).join(' ')
        : '';
      const candKey = normalizeBookKey(raw.title || '', lvAuthor);
      if (candKey === targetKey) return true;

      const lvLast = raw.authors?.[0]?.last_name?.toLowerCase().trim() || '';
      const cleanCandTitle = (raw.title || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, '')
        .replace(/^(the|a|an)\s+/i, '')
        .trim();
      return (
        Boolean(authorSurname) &&
        lvLast.includes(authorSurname) &&
        cleanCandTitle.startsWith(shortTitle.toLowerCase())
      );
    });

    const preferred =
      englishMatches.find((m) => !isAlternateVersionTitle(m.title || '')) || englishMatches[0];
    if (!preferred) return null;

    const edition = buildAudiobookEdition(preferred);
    if (edition?.tracks && edition.tracks.length > 0) {
      tracksCache.set(edition.audiobookId, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        tracks: edition.tracks,
      });
    }
    return edition;
  } catch {
    return null;
  }
}
