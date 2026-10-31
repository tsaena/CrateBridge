# CrateBridge

**From playlists to your permanent collection.**

CrateBridge turns a streaming playlist into a purchase checklist. Paste a tracklist or upload a CSV, and it finds the matching recording in the iTunes Store for each song, flags anything uncertain, and links you straight to the store listing so you can buy and own the track. It's built for DJs and collectors who discover music on Spotify or Apple Music but play from files they own (for example in Serato DJ Pro).

## The problem

Buying a playlist track by track means opening the playlist, searching the store for each song, picking out the right version from originals, remixes, live cuts, clean edits, and karaoke copies, buying it, and repeating that 50–100 times. CrateBridge does the searching and comparing so you only make the decisions and complete the purchases.

## What it does today

- **Import** a pasted tracklist (hyphens, en/em dashes, tabs, numbered lists, DJ timestamps, Unicode), a CSV export, or tracks typed in by hand. Lines that can't be split confidently are held back for you to fix rather than guessed. A sample playlist is included.
- **Match** each track against Apple's iTunes catalog through the official iTunes Search API, in the background and at a pace that respects Apple's rate limit.
- **Rank versions** with a deterministic, explainable algorithm. Each track is classified as *High confidence*, *Review suggested*, or *No reliable match*, and every candidate shows the reasons for its rating.
- **Compare and choose** among alternative recordings (album, duration, price, clean/explicit, remix/live/extended) inline, without modal dialogs.
- **Open the listing**: a green *iTunes listing* button with a verified badge and price goes to Apple's page for that exact recording. It only appears when Apple reports an individual track price. Listings with no track price are labelled as such, and nothing is ever labelled "Buy".
- **Search elsewhere**: every track also has one-click searches on Amazon Digital Music, Beatport, and Bandcamp, plus Apple Music web search (labelled as a streaming catalog). These keep working when the iTunes API is unreachable.
- **Track progress** with Not Started / Found / Purchased / Skipped statuses, a progress bar, counts, and a known-cost estimate (unknown prices are counted separately, never guessed). When you come back from a store tab, CrateBridge asks whether you bought the track; it never marks anything purchased on its own.
- **Work quickly** with filters, search, sorting (including "needs attention first"), and keyboard shortcuts (`J`/`K` move, `O` open listing, `P` purchased, `S` skip, `F` found, `V` versions, `/` filter, `?` help).
- **Manage the list**: edit or remove tracks (with undo), detect duplicates (removal requires confirmation, and alternate versions are kept), and export the checklist as CSV.
- **Settings**: iTunes storefront (default US), clean/explicit preference, and extra words for external searches (Clean, Extended, Radio Edit, …).
- **Saved locally**: the workspace is stored in your browser's `localStorage` and restored on reload. Corrupted or unreadable data is backed up and replaced with a fresh workspace instead of crashing the app.

## Running locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

No accounts, API keys, or environment variables are needed.

```bash
npm run build      # type-check and build to dist/
npm run preview    # serve the production build
```

## Tests and checks

```bash
npm test           # Vitest unit and component tests (mocked API, no network)
npm run typecheck
npm run lint
```

GitHub Actions runs type checking, linting, tests, and a production build on every pull request and on pushes to `main`.

## Supported import formats

**Pasted text**: one track per line, `Artist - Title` by default (switchable to `Title - Artist`). Recognised separators are ` - `, ` – `, ` — `, tabs, unspaced en/em dashes, ` | `, and `Title by Artist`. Leading numbering (`1.`, `02)`, `#3`, `4 -`), bullets, DJ timestamps (`00:04:10`, `[1:02:33]`), and trailing durations (`(3:57)`) are stripped. Names like `50 Cent` and `Jay-Z` are left alone. Streaming links can't be resolved without signing in to the service, so they are flagged.

**CSV / TSV**: comma, semicolon, or tab delimited, UTF-8 (with or without BOM), quoted fields included. Columns are detected from common headings: `Title`, `Track`, `Song`, `Track Name`, `Name` / `Artist`, `Artist Name`, `Artist Name(s)`, `Artists` / `Album`, `Album Name` / `Duration`, `Duration (ms)`, `Time` / `ISRC`. Exports from tools like Exportify work as-is. If detection fails, you can pick the columns yourself.

## Architecture

A static React + TypeScript single-page app (Vite, Tailwind CSS). There is no backend.

```
src/
  types.ts                    Domain types (Track, CatalogRecording, MatchState…)
  lib/
    normalize.ts              Text normalization, featured-artist and version-tag parsing
    import/                   Tracklist and CSV parsers
    duplicates.ts             Duplicate / alternate-version detection
    matching/rank.ts          Deterministic scoring and confidence classes
    matching/matchTrack.ts    Query building and per-track matching
    providers/types.ts        CatalogProvider interface (one per retailer)
    providers/itunes.ts       iTunes Search API client (fetch, JSONP fallback)
    providers/searchLinks.ts  External store search URLs and storefronts
    catalog/                  Rate limiter, retries, and cache around a provider
  state/
    workspace.ts              Reducer: imports, edits, statuses, match results
    storage.ts                Versioned, validated localStorage persistence
    selectors.ts              Summary, cost, filtering, sorting, CSV export
  hooks/                      Persistence and the background matcher
  components/                 UI
```

- **Retailers** implement `CatalogProvider` (`search(query) → CatalogRecording[]`). Adding Beatport or Bandcamp means another provider plus a `provider` value on recordings, without changing the workspace or ranking.
- **Matching** scores each candidate on title, primary and featured artists, version descriptors (remix, live, extended, radio edit, karaoke/cover, …), clean/explicit metadata and preference, duration, album, ISRC when available, and whether it is sold individually. The point values live in one table (`WEIGHTS`), each rule adds a human-readable reason, and the confidence class comes from explicit conditions (for example, *High* requires an exact title, a matching artist, no version conflict, and no large duration gap). Scores only order candidates and are never shown as probabilities.
- **Requests** go through one queue that starts at most one request every 4 seconds, retries network and server errors with exponential backoff, pauses the entire queue for 30 seconds (then 60) after a rate-limit response (HTTP 403/429) or a failed JSONP request, which hides its status and may be a rate limit, caches results in memory, shares identical in-flight queries, and lets a track you're looking at jump the queue. Results are tagged with a signature of the query, so a response for a track that was since edited, re-queued, or deleted is discarded.
- **Persistence** saves tracks, selections (up to 8 compact candidates per track, enough to re-rank without re-querying), statuses, and settings under a versioned key. Every field is validated on load. Lookups that were in flight are re-queued.

## iTunes Search API notes and limitations

- CrateBridge calls `https://itunes.apple.com/search` with `media=music&entity=song` directly from the browser. If the browser blocks the `fetch` (for example, if CORS headers are missing), it falls back to the API's documented JSONP `callback` parameter for the rest of the session. No proxy or backend is involved.
- Apple asks clients to stay at roughly **20 requests per minute**. CrateBridge paces itself to 15 per minute, leaving headroom in case other devices on the same network are also querying Apple, so matching a 50-track playlist takes about 3½ minutes. Search links and statuses work while matching runs.
- The API does not return ISRCs, so ISRC matching only applies when a future provider supplies them. Imported ISRCs (for example from an Exportify CSV) are kept.
- **There is no reliable cross-platform iTunes Store web search URL.** Apple Music web search (`music.apple.com/…/search`) is a streaming catalog and does not sell tracks, so CrateBridge searches the catalog through the API and shows the results inside the app.
- **Store listing links** use the API's `trackViewUrl`, which now points at Apple Music, with Apple's `app=itunes` link parameter added so the iTunes Store page for that exact recording opens instead. This is confirmed on macOS, where it opens the Music app (turn on *iTunes Store* in Music → Settings → General). iPhone and Windows behavior hasn't been tested yet. Without Apple's apps, the link falls back to Apple Music on the web, which doesn't sell tracks.
- A listing is shown as *verified* only when Apple reports a positive individual track price. Album-only or unavailable tracks are labelled *Listing (no price)*.
- Prices and availability depend on the selected storefront. Totals only include known prices, and mixed currencies are shown separately.
- Audio previews are deliberately not included in the MVP to keep clear of Apple's promotional-content terms (previews must sit next to an official store badge and be credited to iTunes). Artwork is shown next to the listing link, and the footer credits iTunes.

## Known limitations

- Spotify and Apple Music playlist URLs can't be imported directly (that needs OAuth). Paste the tracklist text or use a CSV export.
- Data lives only in this browser's `localStorage`. There is **no cloud backup or cross-device sync**, and clearing site data removes it. Use *Export CSV* to keep a copy.
- Only one workspace (playlist) at a time.
- Matching is heuristic. Unusual titles, classical works, and artists whose catalog credits differ a lot from the playlist may need a manual pick or a refined search.
- The JSONP fallback injects a script from `itunes.apple.com`. It is only used when a direct `fetch` fails.

## Roadmap

Possible future work, roughly in priority order:

- Multiple saved playlists/workspaces
- Spotify / Apple Music playlist import via their official APIs (OAuth)
- More retailers through `CatalogProvider` (Beatport, Bandcamp, Amazon) and multi-store price comparison
- Comparison with an existing Serato library, and detection of tracks already owned or purchased
- Optional preview playback that complies with Apple's badge and attribution requirements

Automated checkout, payment handling, downloading or ripping streams, DRM circumvention, and scraping are out of scope.

## Legal and purchasing disclaimer

CrateBridge does not sell, stream, host, or distribute music, and it never handles payment details. It links to listings and searches on external, authorized retailers, and every purchase happens on the retailer's own site or app under that retailer's terms. Prices shown come from the retailer's public catalog data and may be out of date. Always confirm them in the store.

CrateBridge is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Apple, Spotify, Amazon, Beatport, Bandcamp, Serato, or any other company. iTunes, Apple Music, and other names are trademarks of their respective owners. Catalog data and artwork are provided courtesy of iTunes.

## License

This repository does not have a software license yet. The license decision is pending. Until a license is added, default copyright applies.
