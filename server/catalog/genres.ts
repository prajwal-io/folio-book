import type {BookKind, GenreDefinition} from '../../src/types/library.ts';

export const GENRES: GenreDefinition[] = [
  {slug: 'fiction', name: 'Fiction', kindAffinity: 'novel', description: 'Literary and general works of imagination.'},
  {slug: 'romance', name: 'Romance', kindAffinity: 'novel', description: 'Stories centered on love, courtship, and human connection.'},
  {slug: 'mystery', name: 'Mystery', kindAffinity: 'novel', description: 'Detective fiction, whodunits, and investigative puzzles.'},
  {slug: 'thriller', name: 'Thriller', kindAffinity: 'novel', description: 'Suspenseful tales of espionage, intrigue, and tension.'},
  {slug: 'fantasy', name: 'Fantasy', kindAffinity: 'novel', description: 'Mythic worlds, folklore, magic, and fables.'},
  {slug: 'science-fiction', name: 'Science fiction', kindAffinity: 'novel', description: 'Speculative futures, voyages, and scientific imagination.'},
  {slug: 'horror', name: 'Horror', kindAffinity: 'novel', description: 'Gothic tales, ghost stories, and the uncanny.'},
  {slug: 'adventure', name: 'Adventure', kindAffinity: 'novel', description: 'Maritime expeditions, journeys, and heroic quests.'},
  {slug: 'classics', name: 'Classics', kindAffinity: 'both', description: 'Enduring literary touchstones across centuries.'},
  {slug: 'literature', name: 'Literature', kindAffinity: 'both', description: 'World letters, essays, drama, and canonical prose.'},
  {slug: 'short-stories', name: 'Short stories', kindAffinity: 'novel', description: 'Compact tales, anthologies, and short fiction.'},
  {slug: 'poetry', name: 'Poetry', kindAffinity: 'book', description: 'Verse, lyrical collections, and epic poems.'},
  {slug: 'philosophy', name: 'Philosophy', kindAffinity: 'book', description: 'Ethics, metaphysics, stoicism, and Eastern & Western thought.'},
  {slug: 'psychology', name: 'Psychology', kindAffinity: 'book', description: 'Mind, perception, habit, and human behavior.'},
  {slug: 'business', name: 'Business', kindAffinity: 'book', description: 'Commerce, management, economics, and trade history.'},
  {slug: 'entrepreneurship', name: 'Entrepreneurship', kindAffinity: 'book', description: 'Founding craft, enterprise, industry, and self-reliance.'},
  {slug: 'self-development', name: 'Self-development', kindAffinity: 'book', description: 'Character, discipline, rhetoric, and practical wisdom.'},
  {slug: 'technology', name: 'Technology', kindAffinity: 'book', description: 'Engineering, invention, computing history, and craft.'},
  {slug: 'history', name: 'History', kindAffinity: 'book', description: 'Chronicles, civilizations, and historical accounts.'},
  {slug: 'biography', name: 'Biography', kindAffinity: 'book', description: 'Lives, memoirs, autobiographies, and letters.'},
  {slug: 'science', name: 'Science', kindAffinity: 'book', description: 'Natural philosophy, physics, biology, and astronomy.'},
  {slug: 'education', name: 'Education', kindAffinity: 'book', description: 'Pedagogy, primers, rhetoric, and lifelong study.'},
];

export const GENRE_MAP = new Map(GENRES.map((g) => [g.slug, g]));

const KEYWORD_RULES: Array<{slug: string; patterns: RegExp[]}> = [
  {slug: 'romance', patterns: [/\bromance\b/i, /\blove stories\b/i, /\bcourtship\b/i, /\bmarriage\b/i]},
  {slug: 'mystery', patterns: [/\bmystery\b/i, /\bdetective\b/i, /\bsherlock\b/i, /\bcrime\b/i, /\bwhodunit\b/i]},
  {slug: 'thriller', patterns: [/\bthriller\b/i, /\bespionage\b/i, /\bsuspense\b/i, /\bspy\b/i, /\bintrigue\b/i]},
  {slug: 'fantasy', patterns: [/\bfantasy\b/i, /\bfairy tales?\b/i, /\bmythology\b/i, /\bfolklore\b/i, /\blegends?\b/i, /\bmagic\b/i]},
  {slug: 'science-fiction', patterns: [/\bscience fiction\b/i, /\bsci-fi\b/i, /\btime travel\b/i, /\bspace\b/i, /\butopia\b/i, /\bdystopia\b/i]},
  {slug: 'horror', patterns: [/\bhorror\b/i, /\bgothic\b/i, /\bghost\b/i, /\bsupernatural\b/i, /\bvampire\b/i, /\bmacabre\b/i]},
  {slug: 'adventure', patterns: [/\badventure\b/i, /\bsea stories\b/i, /\bvoyages?\b/i, /\bpirates?\b/i, /\bexpedition\b/i]},
  {slug: 'short-stories', patterns: [/\bshort stories\b/i, /\bshort fiction\b/i, /\btales\b/i]},
  {slug: 'poetry', patterns: [/\bpoetry\b/i, /\bpoems?\b/i, /\bverse\b/i, /\bsonnet/i, /\bgitanjali\b/i]},
  {slug: 'philosophy', patterns: [/\bphilosophy\b/i, /\bethics\b/i, /\bstoic/i, /\bmetaphysics\b/i, /\bvedanta\b/i, /\bupanishad/i, /\blogic\b/i]},
  {slug: 'psychology', patterns: [/\bpsychology\b/i, /\bpsychoanalysis\b/i, /\bmind\b/i, /\bconsciousness\b/i, /\bmental\b/i]},
  {slug: 'entrepreneurship', patterns: [/\bentrepreneur/i, /\benterprise\b/i, /\bstartup\b/i, /\bindustr(y|ial)\b/i, /\bself-made\b/i]},
  {slug: 'business', patterns: [/\bbusiness\b/i, /\beconomics\b/i, /\bcommerce\b/i, /\bfinance\b/i, /\btrade\b/i, /\bmanagement\b/i, /\bwealth\b/i]},
  {slug: 'self-development', patterns: [/\bself[- ]?(development|help|improvement|culture)\b/i, /\bconduct of life\b/i, /\bsuccess\b/i, /\bcharacter\b/i, /\bmeditations\b/i, /\bhabits?\b/i]},
  {slug: 'technology', patterns: [/\btechnology\b/i, /\bengineering\b/i, /\binvention\b/i, /\btelegraph\b/i, /\bmachinery\b/i, /\bcomputing\b/i, /\belectricity\b/i]},
  {slug: 'history', patterns: [/\bhistory\b/i, /\bhistorical\b/i, /\bancient\b/i, /\bcivilization\b/i, /\bempire\b/i, /\brevolution\b/i]},
  {slug: 'biography', patterns: [/\bbiograph/i, /\bautobiograph/i, /\bmemoir/i, /\bdiaries\b/i, /\bletters\b/i]},
  {slug: 'science', patterns: [/\bscience\b/i, /\bphysics\b/i, /\bbiology\b/i, /\bastronomy\b/i, /\bevolution\b/i, /\bnatural history\b/i, /\bmathematics\b/i, /\bchemistry\b/i]},
  {slug: 'education', patterns: [/\beducation\b/i, /\bpedagog/i, /\bteaching\b/i, /\brhetoric\b/i, /\bschool\b/i, /\buniversity\b/i]},
  {slug: 'classics', patterns: [/\bclassics?\b/i, /\bharvard classics\b/i, /\bbest books\b/i, /\bgreat books\b/i]},
  {slug: 'literature', patterns: [/\bliterature\b/i, /\bessays?\b/i, /\bdrama\b/i, /\bplays?\b/i, /\bcriticism\b/i]},
  {slug: 'fiction', patterns: [/\bfiction\b/i, /\bnovels?\b/i, /\bsatire\b/i, /\bhumorous\b/i]},
];

const NOVEL_SLUGS = new Set([
  'fiction',
  'romance',
  'mystery',
  'thriller',
  'fantasy',
  'science-fiction',
  'horror',
  'adventure',
  'short-stories',
]);

const NON_FICTION_BOOK_SLUGS = new Set([
  'philosophy',
  'psychology',
  'business',
  'entrepreneurship',
  'self-development',
  'technology',
  'history',
  'biography',
  'science',
  'education',
  'poetry',
]);

export function classifyGenresAndKind(
  subjects: string[],
  title: string,
  hintGenre?: string,
): {genres: string[]; kind: BookKind} {
  const haystack = `${title} | ${subjects.join(' | ')}`;
  const matched = new Set<string>();

  if (hintGenre && GENRE_MAP.has(hintGenre)) {
    matched.add(hintGenre);
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((rx) => rx.test(haystack))) {
      matched.add(rule.slug);
    }
  }

  // Ensure fiction novels also carry 'fiction' or 'classics' if appropriate
  if (matched.size === 0) {
    matched.add('literature');
  }

  const genres = Array.from(matched).slice(0, 4);

  // Determine Book vs Novel cleanly
  const hasNovelSignal =
    genres.some((g) => NOVEL_SLUGS.has(g)) || /\bnovel\b|\bfiction\b/i.test(haystack);
  const hasBookSignal = genres.some((g) => NON_FICTION_BOOK_SLUGS.has(g));

  let kind: BookKind = 'book';
  if (hasNovelSignal && !hasBookSignal) {
    kind = 'novel';
  } else if (hasNovelSignal && hasBookSignal) {
    // e.g. historical fiction -> novel; biography of a novelist -> book
    kind = /\bfiction\b|\bnovel\b|\bstories\b/i.test(haystack) ? 'novel' : 'book';
  } else if (genres.includes('classics') || genres.includes('literature')) {
    kind = /\bdrama\b|\bessays?\b|\bpoetry\b/i.test(haystack) ? 'book' : 'novel';
  }

  return {genres, kind};
}

export function getProviderSearchTermsForGenre(slug: string): {
  gutendexTopic: string;
  openLibrarySubject: string;
  wikisourceQuery: string;
} {
  switch (slug) {
    case 'fiction':
      return {gutendexTopic: 'fiction', openLibrarySubject: 'fiction', wikisourceQuery: 'novel'};
    case 'romance':
      return {gutendexTopic: 'romance', openLibrarySubject: 'romance', wikisourceQuery: 'romance'};
    case 'mystery':
      return {gutendexTopic: 'detective', openLibrarySubject: 'mystery', wikisourceQuery: 'detective'};
    case 'thriller':
      return {gutendexTopic: 'adventure', openLibrarySubject: 'thriller', wikisourceQuery: 'espionage'};
    case 'fantasy':
      return {gutendexTopic: 'fantasy', openLibrarySubject: 'fantasy', wikisourceQuery: 'fairy tales'};
    case 'science-fiction':
      return {gutendexTopic: 'science fiction', openLibrarySubject: 'science_fiction', wikisourceQuery: 'science fiction'};
    case 'horror':
      return {gutendexTopic: 'horror', openLibrarySubject: 'horror', wikisourceQuery: 'ghost stories'};
    case 'adventure':
      return {gutendexTopic: 'adventure', openLibrarySubject: 'adventure', wikisourceQuery: 'voyages'};
    case 'classics':
      return {gutendexTopic: 'best books', openLibrarySubject: 'classics', wikisourceQuery: 'classic literature'};
    case 'philosophy':
      return {gutendexTopic: 'philosophy', openLibrarySubject: 'philosophy', wikisourceQuery: 'philosophy'};
    case 'psychology':
      return {gutendexTopic: 'psychology', openLibrarySubject: 'psychology', wikisourceQuery: 'psychology'};
    case 'business':
      return {gutendexTopic: 'economics', openLibrarySubject: 'business', wikisourceQuery: 'economics'};
    case 'entrepreneurship':
      return {gutendexTopic: 'commerce', openLibrarySubject: 'entrepreneurship', wikisourceQuery: 'industry commerce'};
    case 'self-development':
      return {gutendexTopic: 'conduct of life', openLibrarySubject: 'self-improvement', wikisourceQuery: 'self-reliance'};
    case 'technology':
      return {gutendexTopic: 'technology', openLibrarySubject: 'technology', wikisourceQuery: 'engineering'};
    case 'history':
      return {gutendexTopic: 'history', openLibrarySubject: 'history', wikisourceQuery: 'history'};
    case 'biography':
      return {gutendexTopic: 'biography', openLibrarySubject: 'biography', wikisourceQuery: 'autobiography'};
    case 'science':
      return {gutendexTopic: 'science', openLibrarySubject: 'science', wikisourceQuery: 'natural philosophy'};
    case 'education':
      return {gutendexTopic: 'education', openLibrarySubject: 'education', wikisourceQuery: 'education'};
    case 'poetry':
      return {gutendexTopic: 'poetry', openLibrarySubject: 'poetry', wikisourceQuery: 'poems'};
    case 'literature':
      return {gutendexTopic: 'literature', openLibrarySubject: 'literature', wikisourceQuery: 'essays'};
    case 'short-stories':
      return {gutendexTopic: 'short stories', openLibrarySubject: 'short_stories', wikisourceQuery: 'short stories'};
    default:
      return {gutendexTopic: slug, openLibrarySubject: slug, wikisourceQuery: slug};
  }
}
