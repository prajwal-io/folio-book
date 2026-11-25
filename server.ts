import express from 'express';
import fs from 'fs';
import path from 'path';
import {createServer as createViteServer} from 'vite';
import type {BookKind} from './src/types/library.ts';
import {lookupDictionaryWord} from './server/dictionary.ts';
import {fetchLibriVoxAudiobookTracks} from './server/providers/librivox.ts';
import {fetchReadableBookContent} from './server/reader/contentFetcher.ts';
import {syncManager} from './server/sync/syncManager.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const ALLOWED_COVER_HOSTS = new Set([
  'gutenberg.pglaf.org',
  'www.gutenberg.org',
  'gutendex.com',
  'standardebooks.org',
  'covers.openlibrary.org',
  'upload.wikimedia.org',
  'assets.openstax.org',
  'www.baen.com',
  'baen.com',
  'www.obooko.com',
  'obooko.com',
  'open.umn.edu',
  'clarkesworldmagazine.com',
  'www.lightspeedmagazine.com',
  'www.uncannymagazine.com',
]);

function validateCoverUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_COVER_HOSTS.has(parsed.hostname)) return null;
    // Rewrite blocked www.gutenberg.org cover paths to PGLAF mirror
    if (parsed.hostname === 'www.gutenberg.org' && parsed.pathname.startsWith('/cache/epub/')) {
      parsed.hostname = 'gutenberg.pglaf.org';
    }
    return parsed;
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '1mb'}));

  // Start automated daily catalog synchronization & initial warm-up
  syncManager.start();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      sync: syncManager.getSyncStatus(),
    });
  });

  app.get('/api/catalog/home', async (_req, res) => {
    try {
      const data = await syncManager.getHomeCollections();
      res.json(data);
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load home catalogue'});
    }
  });

  app.get('/api/catalog/genres', async (_req, res) => {
    await syncManager.ensureReady();
    res.json({
      genres: syncManager.getGenreCounts(),
      syncStatus: syncManager.getSyncStatus(),
    });
  });

  app.get('/api/catalog/books', async (req, res) => {
    try {
      const kindParam = typeof req.query.kind === 'string' ? req.query.kind : 'all';
      const kind: BookKind | 'all' = kindParam === 'book' || kindParam === 'novel' ? kindParam : 'all';
      const genre = typeof req.query.genre === 'string' ? req.query.genre : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const period = typeof req.query.period === 'string' ? req.query.period : 'all';
      const sortParam = typeof req.query.sort === 'string' ? req.query.sort : 'popular';
      const sort =
        sortParam === 'newest' || sortParam === 'title' || sortParam === 'year-desc'
          ? sortParam
          : 'popular';
      const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 18;

      const data = await syncManager.queryCatalog({kind, genre, q, period, sort, page, limit});
      res.json(data);
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to query catalogue'});
    }
  });

  app.get('/api/catalog/book/:id', async (req, res) => {
    await syncManager.ensureReady();
    const book = await syncManager.attachAudiobookOnDemand(req.params.id);
    if (!book) {
      res.status(404).json({error: 'Book not found in active catalogue'});
      return;
    }
    res.json({book});
  });

  app.get('/api/catalog/discover', async (_req, res) => {
    try {
      const items = await syncManager.getDiscoveryPool(180);
      res.json({
        items,
        syncStatus: syncManager.getSyncStatus(),
      });
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to build discovery pool'});
    }
  });

  app.get('/api/dictionary', async (req, res) => {
    const word = typeof req.query.word === 'string' ? req.query.word : '';
    const result = await lookupDictionaryWord(word);
    if (!result.found || !result.entry) {
      res.status(404).json({error: result.error || 'Definition unavailable.'});
      return;
    }
    res.json({entry: result.entry});
  });

  app.get('/api/catalog/sync-status', (_req, res) => {
    res.json(syncManager.getSyncStatus());
  });

  app.post('/api/catalog/sync', async (_req, res) => {
    const result = await syncManager.runSync('manual');
    res.json({
      ...result,
      syncStatus: syncManager.getSyncStatus(),
    });
  });

  app.get('/api/reader/content', async (req, res) => {
    const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : '';
    const editionId = typeof req.query.editionId === 'string' ? req.query.editionId : undefined;
    if (!bookId) {
      res.status(400).json({error: 'Missing bookId parameter'});
      return;
    }

    await syncManager.ensureReady();
    const book = syncManager.getBookById(bookId);
    if (!book) {
      res.status(404).json({error: 'Book not found'});
      return;
    }

    const content = await fetchReadableBookContent(book, editionId);
    res.json(content);
  });

  app.get('/api/audiobook/tracks', async (req, res) => {
    const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : '';
    const audiobookId = typeof req.query.audiobookId === 'string' ? req.query.audiobookId : '';

    if (!bookId && !audiobookId) {
      res.status(400).json({error: 'Missing bookId or audiobookId parameter'});
      return;
    }

    await syncManager.ensureReady();
    let targetAudiobookId = audiobookId;
    let matchedAudiobook = null;

    if (bookId) {
      const book = await syncManager.attachAudiobookOnDemand(bookId);
      if (book?.audiobooks && book.audiobooks.length > 0) {
        matchedAudiobook =
          (audiobookId ? book.audiobooks.find((a) => a.audiobookId === audiobookId) : null) ||
          book.audiobooks[0];
        targetAudiobookId = matchedAudiobook.audiobookId;
      }
    }

    if (!targetAudiobookId) {
      res.json({audiobook: null, tracks: []});
      return;
    }

    try {
      const tracks =
        matchedAudiobook?.tracks && matchedAudiobook.tracks.length > 0
          ? matchedAudiobook.tracks
          : await fetchLibriVoxAudiobookTracks(targetAudiobookId);
      res.json({
        audiobook: matchedAudiobook ? {...matchedAudiobook, tracks} : null,
        tracks,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to load LibriVox audiobook tracks',
      });
    }
  });

  app.get('/api/cover', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const target = validateCoverUrl(rawUrl);
    if (!target) {
      res.status(400).end();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const upstream = await fetch(target.toString(), {
        signal: controller.signal,
        headers: {'User-Agent': 'FolioDigitalLibrary/1.0 (+https://folio.local)'},
      });
      if (!upstream.ok) {
        res.status(404).end();
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        res.status(404).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(buf);
    } catch {
      res.status(404).end();
    } finally {
      clearTimeout(timer);
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({error: 'Not found'});
        return;
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio Digital Library server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
