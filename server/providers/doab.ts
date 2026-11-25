import * as cheerio from 'cheerio';
import type {BookAuthor, BookEdition, CatalogBook} from '../../src/types/library.ts';
import {evaluateCopyrightForIndia} from '../catalog/copyright.ts';
import {normalizeBookKey} from '../catalog/dedupe.ts';
import {classifyGenresAndKind} from '../catalog/genres.ts';

export async function fetchDoabOaiBooks(fromDate = '2023-01-01'): Promise<CatalogBook[]> {
  const qs = new URLSearchParams({
    verb: 'ListRecords',
    metadataPrefix: 'oai_dc',
    from: fromDate,
  });

  const res = await fetch(`https://directory.doabooks.org/oai/request?${qs.toString()}`, {
    signal: AbortSignal.timeout(12000),
    headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
  });
  if (!res.ok) {
    throw new Error(`DOAB OAI-PMH returned HTTP ${res.status}`);
  }

  const xml = await res.text();
  const $ = cheerio.load(xml, {xmlMode: true});
  const now = new Date().toISOString();
  const books: CatalogBook[] = [];

  $('record').each((_, el) => {
    const rec = $(el);
    const title = rec.find('dc\\:title, title').first().text().trim();
    if (!title) return;

    const langs = rec
      .find('dc\\:language, language')
      .map((__, l) => $(l).text().trim().toLowerCase())
      .get();
    if (langs.length > 0 && !langs.some((l) => l === 'en' || l === 'eng' || l === 'english')) {
      return;
    }

    const creators = rec
      .find('dc\\:creator, creator')
      .map((__, c) => $(c).text().trim())
      .get()
      .filter(Boolean);
    if (creators.length === 0) return;

    const authors: BookAuthor[] = creators.slice(0, 4).map((name) => ({
      name,
      birthYear: null,
      deathYear: null,
    }));
    const primaryAuthor = authors[0].name;

    const dateStr = rec.find('dc\\:date, date').first().text().trim();
    const yearMatch = dateStr.match(/\b(20\d{2})\b/);
    const pubYear = yearMatch ? Number(yearMatch[1]) : null;
    if (!pubYear || pubYear < 2000) return;

    const identifiers = rec
      .find('dc\\:identifier, identifier')
      .map((__, idEl) => $(idEl).text().trim())
      .get();
    const readUrl =
      identifiers.find((u) => u.startsWith('https://library.oapen.org/')) ||
      identifiers.find((u) => u.startsWith('https://directory.doabooks.org/')) ||
      identifiers.find((u) => u.startsWith('https://'));
    if (!readUrl) return;

    const subjects = rec
      .find('dc\\:subject, subject')
      .map((__, s) => $(s).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, 8);

    const rights = rec
      .find('dc\\:rights, rights')
      .map((__, r) => $(r).text().trim())
      .get()
      .join(' ');
    const licenseMatch = rights.match(/CC\s*BY[^,;)\s]*/i);
    const licenseLabel = licenseMatch ? licenseMatch[0].toUpperCase() : 'Open Access';

    const description = rec.find('dc\\:description, description').first().text().trim();
    const oaiId = rec.find('header > identifier').first().text().trim();
    const shortId = oaiId.split(':').pop()?.replace(/[^a-z0-9]+/gi, '-') || title.slice(0, 24);

    const {genres} = classifyGenresAndKind(subjects, title);
    const copyrightCheck = evaluateCopyrightForIndia(authors, {
      explicitCCLicense: licenseLabel,
    });

    const edition: BookEdition = {
      editionId: `doab-${shortId}`,
      provider: 'doab',
      providerLabel: 'DOAB (Open Access Books)',
      sourceBookId: oaiId,
      sourceUrl: readUrl,
      externalReadUrl: readUrl,
      formatLabel: `Peer-Reviewed OA (${licenseLabel})`,
      language: 'EN',
      licenseLabel,
    };

    books.push({
      id: `doab-${shortId}`,
      normalizedKey: normalizeBookKey(title, primaryAuthor),
      title,
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
      summary: description ? description.slice(0, 420) : null,
      isNewArrival: pubYear >= 2025,
      addedAt: now,
      updatedAt: now,
      editions: [edition],
    });
  });

  return books.slice(0, 40);
}
