# Folio — Personal Digital Library & Reading Companion Context

## Objective
A calm, mobile-first Progressive Web App (PWA) for discovering, reading, listening to, annotating, and building consistent daily habits around legally free books and novels across **both contemporary (2000–2026+) and classic** literature at ₹0 operating cost.

## Architecture
- **Frontend (`src/`)**: React 19 + TypeScript + Tailwind CSS v4 + `vite-plugin-pwa`.
  - Mobile-first thumb-zone navigation (56px bottom tab bar on mobile, compact 50px persistent audio mini-player when active, 3-zone top bar on desktop).
  - Pre-hydration inline script in `/index.html` resolves `light`, `dark`, or `system` (`prefers-color-scheme`) from `localStorage` before first paint to eliminate theme flashing (FOUC).
  - Personal continuity stored locally in browser **IndexedDB v3** (`src/lib/storage.ts`): `bookshelf`, `favourites`, `progress`, `listeningProgress`, `lastSession`, `bookmarks`, `highlights`, `history`, `offlineBooks`, `activityDays`, and `preferences` (`reader-prefs`, `reading-goals`).
  - **Personal Reading Companion Features**:
    - **Built-in Reader Dictionary**: Free lookup via `/api/dictionary` (`server/dictionary.ts` using `api.dictionaryapi.dev` + Wiktionary REST fallback) via text selection or optional Tap-to-Define mode in `ReaderView`, displaying definitions, phonetics, pronunciation audio where present, examples, and honest offline/missing-word handling.
    - **Highlights, Notes & Reading Notebook**: Reflow-safe offset + prefix/suffix anchored DOM highlights (`src/lib/highlightsDom.ts`) in 4 editorial colors (`amber`, `sage`, `sky`, `rose`) working across Scroll and Paginated modes, organized by book in `Shelf > Notebook` with live search and direct jump-to-passage.
    - **Recommendations, Moods & Daily/Evening Companion**: Metadata-driven lightweight recommendation engine (`src/lib/recommendations.ts`) drawing on `/api/catalog/discover`, transparent contextual reasons, 8 curated moods, time-aware local greetings, deterministic Daily Pick, and Discover Something Different.
    - **Goals, Insights & Reminders**: Daily time or completion goals tracked via genuine active reading pulses (paused when hidden/idle > 60s) and audio playback ticks; 7-day weekly insights (`Shelf > Insights`); honest local reminders with `Notification.requestPermission()` + `.ics` recurring calendar download (`src/lib/reminders.ts`).
    - **Portable Backup & Improved Offline Manager**: Versioned JSON export/import (`folio-backup-v1.json`) explicitly omitting downloaded book text (`offlineBooks`), schema validation, duplicate counts, Merge/Replace confirmation, explicit download progress, storage quota estimates (`navigator.storage.estimate()`), and graceful `QuotaExceededError` handling.
- **Backend (`server.ts` & `server/`)**: Express + TypeScript (`vite.middlewares` in dev, `dist/` in production), 13 modular providers including LibriVox human-narrated audiobooks, `/api/catalog/discover`, and `/api/dictionary`.

## Known Limitations & Free Deployment
- Static local reminders without a remote Web Push (`VAPID`) server only trigger notifications while Folio is open or resumed; `.ics` calendar export provides guaranteed OS lock-screen reminders at ₹0 cost.
- Unfiltered Internet Archive CC search is excluded due to mislabeled commercial uploads.
- Interactive web textbooks and PDF-only monographs link directly to their verified free publisher reader (`readableInApp: false`) and cannot be parsed for in-app TTS or highlighting.
- **Zero-Cost Hosting**: Deployable on free Node/container tiers using `npm run build` and `npm start` (`node server.ts`).
