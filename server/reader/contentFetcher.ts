import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import sanitizeHtml from 'sanitize-html';
import type {BookEdition, CatalogBook, ReaderChapter, ReaderContentResponse} from '../../src/types/library.ts';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'em',
    'strong',
    'i',
    'b',
    'ul',
    'ol',
    'li',
    'hr',
    'br',
    'span',
    'div',
    'sub',
    'sup',
    'figure',
    'figcaption',
  ],
  allowedAttributes: {
    span: ['class'],
    div: ['class'],
  },
  disallowedTagsMode: 'discard',
};

const contentCache = new Map<string, {expiresAt: number; payload: ReaderContentResponse}>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function countWords(html: string): number {
  const text = cheerio.load(html).text();
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function cleanSanitizedHtml(rawHtml: string): string {
  const clean = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
  return clean.replace(/<p>\s*<\/p>/g, '').trim();
}

function stripGutenbergBoilerplate(htmlOrText: string): string {
  let out = htmlOrText;
  const startMatch = out.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (startMatch && startMatch.index !== undefined) {
    out = out.slice(startMatch.index + startMatch[0].length);
  }
  const endMatch = out.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (endMatch && endMatch.index !== undefined) {
    out = out.slice(0, endMatch.index);
  }
  return out;
}

function chunkTextIntoChapters(plainText: string, bookTitle: string): ReaderChapter[] {
  const stripped = stripGutenbergBoilerplate(plainText).replace(/\r\n/g, '\n');
  const paragraphs = stripped
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chapterHeadingRegex = /^(chapter|book|part|act|canto|letter|section)\s+([ivxlcdm0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
  const chapters: ReaderChapter[] = [];
  let currentTitle = bookTitle;
  let currentParas: string[] = [];
  let wordAcc = 0;

  const flush = () => {
    if (currentParas.length === 0) return;
    const html = cleanSanitizedHtml(
      currentParas
        .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, ' ')}</p>`)
        .join('\n'),
    );
    const wc = countWords(html);
    if (wc > 10) {
      chapters.push({
        index: chapters.length,
        title: currentTitle,
        html,
        wordCount: wc,
      });
    }
    currentParas = [];
    wordAcc = 0;
  };

  for (const para of paragraphs) {
    if (para.length < 90 && chapterHeadingRegex.test(para)) {
      flush();
      currentTitle = para.replace(/\s+/g, ' ').trim();
      continue;
    }
    currentParas.push(para);
    wordAcc += para.split(/\s+/).length;
    // Fallback chunking if a book has no explicit chapter headings
    if (wordAcc >= 3400) {
      flush();
      currentTitle = `Section ${chapters.length + 1}`;
    }
  }
  flush();

  return chapters;
}

function splitHtmlIntoChapters(rawHtml: string, fallbackTitle: string): ReaderChapter[] {
  const stripped = stripGutenbergBoilerplate(rawHtml);
  const $ = cheerio.load(stripped);

  // Remove Gutenberg boilerplate divs/pre/tables and scripts/styles
  $('script, style, nav, .pgheader, .pgfooter, #pg-header, #pg-footer, .toc, #toc').remove();

  // Check if Standard Ebooks semantic <section epub:type="chapter"> or <section> blocks exist
  const sections = $('body > section[id], main > section[id], section[data-epub-type*="chapter"], div.chapter');
  const chapters: ReaderChapter[] = [];

  if (sections.length >= 2) {
    sections.each((_, el) => {
      const sec = $(el);
      const heading = sec.find('h1, h2, h3').first().text().trim();
      const title = heading || `Section ${chapters.length + 1}`;
      const html = cleanSanitizedHtml(sec.html() || '');
      const wc = countWords(html);
      if (wc > 25) {
        chapters.push({index: chapters.length, title, html, wordCount: wc});
      }
    });
    if (chapters.length > 0) return chapters;
  }

  // Otherwise split body content cleanly by h2 / h3 chapter boundaries
  const bodyEl = $('body').first();
  let rootContainer = bodyEl;

  // Unwrap nested single wrapper divs (common in Baen / CMS HTML) so paragraph chunking works cleanly
  while (rootContainer.length && rootContainer.children().length === 1) {
    const only = rootContainer.children().first();
    const tag = (only.get(0) as {tagName?: string} | undefined)?.tagName?.toLowerCase();
    if (tag && ['div', 'main', 'article', 'section'].includes(tag)) {
      rootContainer = only;
    } else {
      break;
    }
  }

  const children = rootContainer.length
    ? rootContainer.children().toArray()
    : $.root().children().toArray();
  let currentTitle = fallbackTitle;
  let bufferHtml: string[] = [];
  let bufferWords = 0;

  const pushBuffer = () => {
    const joined = cleanSanitizedHtml(bufferHtml.join('\n'));
    const wc = countWords(joined);
    if (wc > 25) {
      chapters.push({
        index: chapters.length,
        title: currentTitle,
        html: joined,
        wordCount: wc,
      });
    }
    bufferHtml = [];
    bufferWords = 0;
  };

  for (const node of children) {
    const el = $(node);
    const tagName = (node as {tagName?: string}).tagName?.toLowerCase() || '';
    const isHeading = tagName === 'h1' || tagName === 'h2' || (tagName === 'h3' && el.text().trim().length < 90);
    const text = el.text().trim();

    if (isHeading && text.length > 0 && text.length < 120 && bufferWords > 120) {
      pushBuffer();
      currentTitle = text;
    }

    const outer = $.html(node);
    bufferHtml.push(outer);
    bufferWords += text.split(/\s+/).filter(Boolean).length;

    if (bufferWords >= 3800) {
      pushBuffer();
      currentTitle = `Section ${chapters.length + 1}`;
    }
  }
  pushBuffer();

  if (chapters.length === 0) {
    const rawFallback = rootContainer.length ? rootContainer.html() : $.root().html();
    const fallbackHtml = cleanSanitizedHtml(rawFallback || '');
    const wc = countWords(fallbackHtml);
    if (wc > 10) {
      return [{index: 0, title: fallbackTitle, html: fallbackHtml, wordCount: wc}];
    }
  }

  return chapters;
}

async function parseEpubBuffer(buf: ArrayBuffer, fallbackTitle: string): Promise<ReaderChapter[]> {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Invalid EPUB container');

  const $container = cheerio.load(containerXml, {xmlMode: true});
  const opfPath = $container('rootfile').first().attr('full-path');
  if (!opfPath) throw new Error('Missing OPF path');

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('Missing OPF manifest');

  const $opf = cheerio.load(opfXml, {xmlMode: true});
  const manifest = new Map<string, string>();
  $opf('manifest > item').each((_, el) => {
    const id = $opf(el).attr('id');
    const href = $opf(el).attr('href');
    if (id && href) manifest.set(id, decodeURIComponent(href));
  });

  const spineIds: string[] = [];
  $opf('spine > itemref').each((_, el) => {
    const idref = $opf(el).attr('idref');
    if (idref) spineIds.push(idref);
  });

  const chapters: ReaderChapter[] = [];
  for (const idref of spineIds) {
    const relHref = manifest.get(idref);
    if (!relHref) continue;
    const fullPath = `${opfDir}${relHref}`.replace(/^\//, '');
    const xhtml = await zip.file(fullPath)?.async('string');
    if (!xhtml) continue;

    const $doc = cheerio.load(xhtml);
    $doc('script, style, nav').remove();
    const bodyHtml = $doc('body').html() || '';
    const cleaned = cleanSanitizedHtml(bodyHtml);
    const wc = countWords(cleaned);
    if (wc < 40) continue; // skip cover/colophon/titlepage micro-files

    const heading = $doc('h1, h2, h3').first().text().trim() || $doc('title').text().trim();
    const title = heading && heading.length < 100 ? heading : `${fallbackTitle} · Part ${chapters.length + 1}`;
    chapters.push({
      index: chapters.length,
      title,
      html: cleaned,
      wordCount: wc,
    });
  }

  return chapters;
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {'User-Agent': 'Mozilla/5.0 (compatible; FolioDigitalLibrary/1.0)'},
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMediaWikiChapters(
  apiBase: string,
  page: string,
  bookTitle: string,
): Promise<ReaderChapter[]> {
  const parseUrl = `${apiBase}?action=parse&page=${encodeURIComponent(page)}&redirects=1&prop=text|links&format=json`;
  const res = await fetchWithTimeout(parseUrl, 12000);
  if (!res.ok) throw new Error(`Wiki parse failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    parse?: {title?: string; text?: {'*': string}; links?: Array<{ns: number; '*': string; exists?: string}>};
  };

  const resolvedTitle = data.parse?.title || page.replace(/_/g, ' ');
  const rootHtml = data.parse?.text?.['*'] || '';
  const $ = cheerio.load(rootHtml);
  $('.ws-noexport, .noprint, .mw-editsection, #toc, .toc, table.headertemplate, .header_notes, script, style').remove();

  // Check if this page is an index page linking to sub-chapters (e.g. "Page/Chapter 1")
  const subLinks = (data.parse?.links || [])
    .filter((l) => l.ns === 0 && l.exists !== undefined && l['*'].startsWith(`${resolvedTitle}/`))
    .map((l) => l['*'])
    .slice(0, 28);

  const rootTextWords = countWords($.html());

  if (subLinks.length >= 2 && rootTextWords < 900) {
    const chapters: ReaderChapter[] = [];
    for (let i = 0; i < subLinks.length; i += 4) {
      const batch = subLinks.slice(i, i + 4);
      const settled = await Promise.allSettled(
        batch.map(async (subTitle) => {
          const subRes = await fetchWithTimeout(
            `${apiBase}?action=parse&page=${encodeURIComponent(subTitle.replace(/ /g, '_'))}&prop=text&format=json`,
            10000,
          );
          if (!subRes.ok) return null;
          const subJson = (await subRes.json()) as {parse?: {text?: {'*': string}}};
          const subRaw = subJson.parse?.text?.['*'] || '';
          const $sub = cheerio.load(subRaw);
          $sub('.ws-noexport, .noprint, .mw-editsection, table.headertemplate, .noprint, script, style').remove();
          const cleaned = cleanSanitizedHtml($sub('body').html() || $sub.html() || '');
          const wc = countWords(cleaned);
          if (wc < 20) return null;
          const shortTitle = subTitle.split('/').slice(1).join(' — ') || subTitle;
          return {title: shortTitle, html: cleaned, wordCount: wc};
        }),
      );
      for (const item of settled) {
        if (item.status === 'fulfilled' && item.value) {
          chapters.push({
            index: chapters.length,
            title: item.value.title,
            html: item.value.html,
            wordCount: item.value.wordCount,
          });
        }
      }
    }
    if (chapters.length > 0) return chapters;
  }

  return splitHtmlIntoChapters($.html(), bookTitle);
}

async function fetchSpeculativeStoryChapters(url: string, title: string): Promise<ReaderChapter[]> {
  const res = await fetchWithTimeout(url, 14000);
  if (!res.ok) throw new Error(`Publisher returned HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  $(
    'script, style, nav, header, footer, aside, .sharedaddy, .jp-relatedposts, .post-navigation, .about-author, .author-bio, .podcast-player, .audio-player, .comments-area, #comments, form',
  ).remove();

  // Select prose container used by Clarkesworld, Lightspeed, and Uncanny
  const candidate =
    $('.story-text, .story-body, article .entry-content, .entry-content, main article').first();
  const rawBody = candidate.length ? candidate.html() || '' : $('article, main, body').first().html() || '';

  const cleaned = cleanSanitizedHtml(rawBody);
  const wc = countWords(cleaned);
  if (wc < 120) return [];

  if (wc > 4500) {
    return splitHtmlIntoChapters(rawBody, title);
  }
  return [{index: 0, title, html: cleaned, wordCount: wc}];
}

async function fetchBaenChapters(edition: BookEdition, title: string): Promise<ReaderChapter[]> {
  const chapters: ReaderChapter[] = [];
  const startUrl = edition.readHtmlUrl || edition.externalReadUrl;
  if (!startUrl) return [];

  // Derive WebScriptions numbered section pattern: /Chapters/<isbn>/<isbn>___N.htm
  const baseMatch = startUrl.match(/^(https:\/\/www\.baen\.com\/Chapters\/[^/]+\/[^_./]+)(?:__c_|_toc)?\.htm/i);
  if (baseMatch) {
    const prefix = `${baseMatch[1]}___`;
    for (let batchStart = 1; batchStart <= 25; batchStart += 5) {
      const nums = Array.from({length: 5}, (_, idx) => batchStart + idx);
      const settled = await Promise.allSettled(
        nums.map(async (n) => {
          const res = await fetchWithTimeout(`${prefix}${n}.htm`, 10000);
          if (!res.ok) return null;
          const html = await res.text();
          const $ = cheerio.load(html);
          $('script, style, nav').remove();
          // Strip Baen Back / Next nav paragraphs
          $('p').each((_, el) => {
            const pText = $(el).text().trim();
            if (/^(Back|Next|Back\s*\|\s*Next|\|\s*Next)$/i.test(pText) || $(el).find('a[href*="__"]').length > 0) {
              if (pText.length < 30) $(el).remove();
            }
          });
          const bodyHtml = cleanSanitizedHtml($('body').html() || '');
          const wc = countWords(bodyHtml);
          if (wc < 40) return null;
          const heading = $('h1, h2, h3, b').first().text().replace(/\s+/g, ' ').trim();
          const chTitle =
            heading && heading.length > 2 && heading.length < 90
              ? heading
              : `${title} · Section ${n}`;
          return {num: n, title: chTitle, html: bodyHtml, wordCount: wc};
        }),
      );

      let anyHit = false;
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value) {
          anyHit = true;
          chapters.push({
            index: chapters.length,
            title: s.value.title,
            html: s.value.html,
            wordCount: s.value.wordCount,
          });
        }
      }
      if (!anyHit && batchStart > 1) break;
    }
    if (chapters.length > 0) return chapters;
  }

  // Fallback to single flat URL if chapter pattern differs
  if (edition.readHtmlUrl) {
    const res = await fetchWithTimeout(edition.readHtmlUrl, 16000);
    if (res.ok) {
      const html = await res.text();
      return splitHtmlIntoChapters(html, title);
    }
  }
  return [];
}

async function fetchPressbooksChapters(url: string, title: string): Promise<ReaderChapter[]> {
  if (!url.includes('pressbooks') && !url.includes('open.lib.umn.edu')) return [];
  const res = await fetchWithTimeout(url, 12000);
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);

  const chapterLinks: Array<{href: string; title: string}> = [];
  $('a[href*="/chapter/"]').each((_, el) => {
    const href = $(el).attr('href');
    const linkTitle = $(el).text().replace(/\s+/g, ' ').trim();
    if (href && linkTitle && !chapterLinks.some((c) => c.href === href)) {
      const absUrl = href.startsWith('http') ? href : new URL(href, url).toString();
      chapterLinks.push({href: absUrl, title: linkTitle});
    }
  });

  if (chapterLinks.length === 0) return [];
  const picks = chapterLinks.slice(0, 18);
  const chapters: ReaderChapter[] = [];

  for (let i = 0; i < picks.length; i += 3) {
    const batch = picks.slice(i, i + 3);
    const settled = await Promise.allSettled(
      batch.map(async (item) => {
        const cRes = await fetchWithTimeout(item.href, 10000);
        if (!cRes.ok) return null;
        const cHtml = await cRes.text();
        const $c = cheerio.load(cHtml);
        $c('script, style, nav, .nav-reading, .block-reading-meta, .license-attribution').remove();
        const raw = $c('.entry-content, section.chapter, main .chapter').first().html() || '';
        const cleaned = cleanSanitizedHtml(raw);
        const wc = countWords(cleaned);
        if (wc < 30) return null;
        return {title: item.title, html: cleaned, wordCount: wc};
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        chapters.push({
          index: chapters.length,
          title: s.value.title,
          html: s.value.html,
          wordCount: s.value.wordCount,
        });
      }
    }
  }
  if (chapters.length > 0) return chapters;
  return [{index: 0, title, html: '', wordCount: 0}].filter((c) => c.wordCount > 0);
}

export async function fetchReadableBookContent(
  book: CatalogBook,
  editionId?: string,
): Promise<ReaderContentResponse> {
  const edition: BookEdition =
    (editionId ? book.editions.find((e) => e.editionId === editionId) : undefined) || book.editions[0];

  if (!edition) {
    return {
      bookId: book.id,
      editionId: 'none',
      title: book.title,
      author: book.primaryAuthor,
      provider: 'gutendex',
      providerLabel: 'External Source',
      sourceUrl: '',
      externalReadUrl: '',
      readableInApp: false,
      unavailableReason: 'No readable edition metadata was provided for this title.',
      chapters: [],
      totalWords: 0,
    };
  }

  const cacheKey = `${book.id}::${edition.editionId}`;
  const cached = contentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  let chapters: ReaderChapter[] = [];
  let unavailableReason: string | undefined;

  try {
    if (edition.provider === 'wikisource') {
      chapters = await fetchMediaWikiChapters(
        'https://en.wikisource.org/w/api.php',
        edition.sourceBookId,
        book.title,
      );
    } else if (edition.provider === 'wikibooks') {
      chapters = await fetchMediaWikiChapters(
        'https://en.wikibooks.org/w/api.php',
        edition.sourceBookId,
        book.title,
      );
    } else if (edition.provider === 'baen') {
      chapters = await fetchBaenChapters(edition, book.title);
    } else if (edition.provider === 'speculative-press') {
      if (edition.readHtmlUrl) {
        chapters = await fetchSpeculativeStoryChapters(edition.readHtmlUrl, book.title);
      }
    } else if (edition.provider === 'open-umn') {
      if (edition.readHtmlUrl) {
        chapters = await fetchPressbooksChapters(edition.readHtmlUrl, book.title);
      }
      if (chapters.length === 0) {
        unavailableReason =
          'This Creative Commons textbook uses interactive modules or an official PDF hosted by its university publisher. Use the verified link below to read it free in full.';
      }
    } else if (edition.provider === 'openstax') {
      unavailableReason =
        'OpenStax textbooks are presented through Rice University’s interactive web reader with math formulas, figures, and exercises. Open the verified OpenStax link below to read the complete book free.';
    } else if (edition.provider === 'openalex' || edition.provider === 'doab') {
      unavailableReason =
        'This peer-reviewed open-access book is hosted by the academic publisher or repository (HTML/PDF). Open the official open-access link below to read the complete work free.';
    } else if (edition.provider === 'obooko') {
      unavailableReason =
        'Obooko distributes authorized free author editions directly from their official download/reading portal. Open the Obooko source link below to read free at ₹0.';
    } else if (edition.provider === 'standard-ebooks') {
      if (edition.readHtmlUrl) {
        const res = await fetchWithTimeout(edition.readHtmlUrl, 16000);
        if (res.ok) {
          const html = await res.text();
          chapters = splitHtmlIntoChapters(html, book.title);
        }
      }
      if (chapters.length === 0 && edition.readEpubUrl) {
        const res = await fetchWithTimeout(edition.readEpubUrl, 20000);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          chapters = await parseEpubBuffer(buf, book.title);
        }
      }
    } else if (edition.provider === 'gutendex') {
      const id = edition.sourceBookId;
      const htmlCandidates = [
        edition.readHtmlUrl,
        `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}-images.html`,
        `https://www.mirrorservice.org/sites/ftp.ibiblio.org/pub/docs/books/gutenberg/${id.slice(0, -1).split('').join('/')}/${id}/${id}-h/${id}-h.htm`,
      ].filter((u): u is string => Boolean(u));

      for (const candidate of htmlCandidates) {
        try {
          const res = await fetchWithTimeout(candidate, 14000);
          if (res.ok) {
            const html = await res.text();
            const parsed = splitHtmlIntoChapters(html, book.title);
            if (parsed.length > 0) {
              chapters = parsed;
              break;
            }
          }
        } catch {
          // Try next mirror
        }
      }

      if (chapters.length === 0 && edition.readEpubUrl) {
        try {
          const res = await fetchWithTimeout(edition.readEpubUrl, 18000);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            chapters = await parseEpubBuffer(buf, book.title);
          }
        } catch {
          // Try plain text fallback
        }
      }

      if (chapters.length === 0 && edition.readTextUrl) {
        try {
          const res = await fetchWithTimeout(edition.readTextUrl, 14000);
          if (res.ok) {
            const txt = await res.text();
            chapters = chunkTextIntoChapters(txt, book.title);
          }
        } catch {
          // Handled below
        }
      }
    } else if (edition.provider === 'open-library') {
      if (edition.readTextUrl) {
        try {
          const res = await fetchWithTimeout(edition.readTextUrl, 12000);
          if (res.ok) {
            const txt = await res.text();
            if (txt.length > 400 && !txt.includes('<html')) {
              chapters = chunkTextIntoChapters(txt, book.title);
            }
          }
        } catch {
          // Archive OCR text may be rate-limited or scan-only
        }
      }
      if (chapters.length === 0) {
        unavailableReason =
          'This Open Library volume is hosted as a scanned archival book on Internet Archive without clean reflowable text. You can read the complete free scan directly at the verified source.';
      }
    } else if (edition.provider === 'librivox') {
      unavailableReason =
        'This catalog entry is a human-narrated LibriVox audiobook edition without linked reflowable text. Tap Listen to play the audio chapters or visit LibriVox.';
    }
  } catch (err) {
    unavailableReason =
      err instanceof Error
        ? `Could not load full text directly (${err.message}). Open the legitimate source link below to read.`
        : 'Could not load full text directly from the provider.';
  }

  if (chapters.length === 0 && !unavailableReason) {
    unavailableReason =
      'The upstream provider did not return reflowable text for this edition at the moment. You can open the official source page directly.';
  }

  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const payload: ReaderContentResponse = {
    bookId: book.id,
    editionId: edition.editionId,
    title: book.title,
    author: book.primaryAuthor,
    provider: edition.provider,
    providerLabel: edition.providerLabel,
    sourceUrl: edition.sourceUrl,
    externalReadUrl: edition.externalReadUrl,
    readableInApp: chapters.length > 0,
    unavailableReason,
    chapters,
    totalWords,
  };

  if (payload.readableInApp) {
    if (contentCache.size >= 15) {
      const oldestKey = contentCache.keys().next().value;
      if (oldestKey) contentCache.delete(oldestKey);
    }
    contentCache.set(cacheKey, {expiresAt: Date.now() + CACHE_TTL_MS, payload});
  }

  return payload;
}
