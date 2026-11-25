import type {DictionaryEntry, DictionaryMeaning} from '../src/types/library.ts';

interface CachedLookup {
  found: boolean;
  entry?: DictionaryEntry;
  error?: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dictionaryCache = new Map<string, CachedLookup>();

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeWordQuery(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '')
    .toLowerCase();
  if (!cleaned || cleaned.length > 42 || !/^[a-z][a-z'-]*$/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

async function fetchFromDictionaryApi(word: string): Promise<DictionaryEntry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      {
        signal: controller.signal,
        headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
      },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as Array<{
      word?: string;
      phonetic?: string;
      phonetics?: Array<{text?: string; audio?: string}>;
      meanings?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{
          definition?: string;
          example?: string;
          synonyms?: string[];
        }>;
      }>;
      sourceUrls?: string[];
    }>;

    const first = Array.isArray(payload) ? payload[0] : null;
    if (!first || !Array.isArray(first.meanings) || first.meanings.length === 0) {
      return null;
    }

    const phonetic =
      first.phonetic ||
      first.phonetics?.find((p) => typeof p.text === 'string' && p.text.trim())?.text;
    const rawAudio = first.phonetics?.find(
      (p) => typeof p.audio === 'string' && p.audio.trim().startsWith('https://'),
    )?.audio;

    const meanings: DictionaryMeaning[] = [];
    for (const m of first.meanings) {
      if (!m.partOfSpeech || !Array.isArray(m.definitions)) continue;
      const defs = m.definitions
        .filter((d) => typeof d.definition === 'string' && d.definition.trim())
        .slice(0, 3)
        .map((d) => ({
          definition: d.definition!.trim(),
          example: typeof d.example === 'string' && d.example.trim() ? d.example.trim() : undefined,
          synonyms:
            Array.isArray(d.synonyms) && d.synonyms.length > 0
              ? d.synonyms.slice(0, 5)
              : undefined,
        }));
      if (defs.length > 0) {
        meanings.push({
          partOfSpeech: m.partOfSpeech,
          definitions: defs,
        });
      }
    }

    if (meanings.length === 0) return null;

    return {
      word: first.word || word,
      phonetic: phonetic?.trim() || undefined,
      audioUrl: rawAudio?.trim() || undefined,
      meanings: meanings.slice(0, 4),
      sourceLabel: 'Free Dictionary API (Wiktionary CC BY-SA)',
      sourceUrl:
        first.sourceUrls?.[0] || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromWiktionary(word: string): Promise<DictionaryEntry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
      {
        signal: controller.signal,
        headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
      },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      en?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{
          definition?: string;
          examples?: string[];
        }>;
      }>;
    };

    if (!Array.isArray(payload.en) || payload.en.length === 0) {
      return null;
    }

    const meanings: DictionaryMeaning[] = [];
    for (const item of payload.en) {
      if (!item.partOfSpeech || !Array.isArray(item.definitions)) continue;
      const defs = item.definitions
        .map((d) => ({
          definition: stripHtml(d.definition || ''),
          example:
            Array.isArray(d.examples) && d.examples[0]
              ? stripHtml(d.examples[0])
              : undefined,
        }))
        .filter((d) => d.definition.length > 0)
        .slice(0, 3);
      if (defs.length > 0) {
        meanings.push({
          partOfSpeech: item.partOfSpeech.toLowerCase(),
          definitions: defs,
        });
      }
    }

    if (meanings.length === 0) return null;

    return {
      word,
      meanings: meanings.slice(0, 4),
      sourceLabel: 'Wiktionary (CC BY-SA)',
      sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupDictionaryWord(rawWord: string): Promise<{
  found: boolean;
  entry?: DictionaryEntry;
  error?: string;
}> {
  const word = sanitizeWordQuery(rawWord);
  if (!word) {
    return {found: false, error: 'Select a single alphabetic word to look up.'};
  }

  const cached = dictionaryCache.get(word);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  let entry = await fetchFromDictionaryApi(word);
  if (!entry) {
    entry = await fetchFromWiktionary(word);
  }

  // Fallback check on simple plural/inflected suffix stripping when inflected word fails directly
  if (!entry && word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) {
    const stem = word.slice(0, -1);
    entry = (await fetchFromDictionaryApi(stem)) || (await fetchFromWiktionary(stem));
  }

  const result: CachedLookup = entry
    ? {found: true, entry, expiresAt: Date.now() + CACHE_TTL_MS}
    : {
        found: false,
        error: `No dictionary definition found for "${word}".`,
        expiresAt: Date.now() + 60 * 60 * 1000,
      };

  if (dictionaryCache.size >= 1000) {
    const firstKey = dictionaryCache.keys().next().value;
    if (firstKey) dictionaryCache.delete(firstKey);
  }
  dictionaryCache.set(word, result);
  return result;
}
