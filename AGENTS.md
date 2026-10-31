# AGENTS.md

CrateBridge is a client-only React + TypeScript app (Vite, Tailwind CSS) that turns a playlist into a checklist of tracks to buy from legitimate retailers. It matches tracks against Apple's iTunes Search API and links to store listings. There is no backend, there are no accounts, and all state lives in the browser's `localStorage`. See `README.md` for the architecture.

## Commands

Requires Node.js 22.

```bash
npm ci
npm run typecheck
npm run lint
npm test          # Vitest; mocked API, no network access
npm run build
```

CI runs all four checks on every pull request. Run them before pushing.

## Conventions

- Keep the app static. Don't add a backend, proxy, or serverless function without discussing it first.
- New retailers implement `CatalogProvider` (`src/lib/providers/types.ts`). Don't special-case a store elsewhere.
- Matching must stay deterministic and explainable. Every scoring rule in `src/lib/matching/rank.ts` adds a human-readable reason, and point values live in `WEIGHTS`. Don't introduce external AI services or opaque scores, and never show scores as probabilities.
- All catalog requests go through `CatalogSearchService` so that pacing, retries, and caching apply.
- Changes to stored data must still load workspaces saved by earlier versions. Validate them in `src/state/storage.ts` and bump `SCHEMA_VERSION` only when a migration is needed.
- Tests: add a test for each behavior change or bug fix, at the lowest layer that covers it. Don't add tests that repeat coverage that already exists at another layer.
- Don't add a software license; that decision is pending with the maintainer.
- Keep documentation to the README unless asked.

## Product rules

- CrateBridge never purchases, downloads, streams, or proxies music, and never handles payment details.
- Don't scrape retailer websites. Use official APIs or plain search URLs only.
- Never label a link "Buy". A verified iTunes listing requires an individual track price from the API. Links to search results or to streaming catalogs (Apple Music web) must be labelled as such.
- Different versions (remix, live, edit, karaoke, clean/explicit) are different recordings and must never be treated as interchangeable.
- Respect Apple's limit of roughly 20 requests per minute. Never send imports as parallel bursts.
- Don't add audio previews without Apple's badge and attribution requirements.

## Review guidelines

Prioritize issues that would make a user buy the wrong recording, mislead them about where a link goes, or lose their saved progress.

- Treat as P1:
  - matching changes that can give *High confidence* to a different version or a different song than the one requested
  - links whose label overstates what they open, for example a "verified" or purchase label on a streaming page or a search
  - changes that can drop or corrupt saved workspaces, or that crash on old or malformed stored data
  - request pacing that can exceed Apple's rate limit or fire requests in parallel
  - any of the security issues listed in `SECURITY.md`
- Check that responses for a track that was edited, re-queued, or deleted are still discarded (the signature checks in `src/state/workspace.ts`).
- Check that unknown or missing catalog metadata degrades to *Review suggested* or *No reliable match*, not to a confident guess.
- Flag missing regression tests for bug fixes. Also flag new tests that only repeat existing coverage.
- Don't flag the absence of a license, backend, or cloud sync. These are deliberate decisions for now.
