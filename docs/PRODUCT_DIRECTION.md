# Product direction (November 18, 2026)

## Decision
CrateBridge (working name) is a free/open-source-intended, client-only, GitHub Pages music acquisition utility for **working mobile and event DJs**. Refine the **already-published purchase workflow** before adding new feature families. MIT is preferred **only after** an audit of code, assets, dependencies, and contributor rights; do not add a license prematurely.

**Primary job:** import a song list, identify the requested recording/version, open clearly described legal retailer links, and manually track progress. DJs may use streaming for discovery and noncritical requests. A must-play track may need a verified local file before performance, but CrateBridge does **not** claim current file availability.

## Product boundary
- **CrateBridge web (now):** Spotify/paste/CSV/manual import; deterministic iTunes matching; verified listing vs search-only labeling; track versions and statuses; playlist organization and browser-local persistence; retailer/dj pool link handoff.
- **Future DJ Workspace Prep (research only):** discover actual DJ libraries, validate local file availability/removable drives, reconcile downloads, manage crate order, and potentially write to DJ software after version-specific recovery testing.
- **Experimental Serato branch:** preserve as research; do not merge into web v1 by default. A root.sqlite backup is a historical snapshot, not proof a file exists, and editing a ZIP cannot change the active library. No streaming reference can establish ownership.

## Now / next / later
1. **Now:** user journey audit and mobile-first, Apple-like visual/interaction redesign with desktop parity, without changing matching or storage semantics. Conduct an explicit design review and choose a visual direction before coding.
2. **Next:** improve purchase handoff, recoverability, usability, accessibility and architecture *based on measured friction*. Audit license and dependency notices.
3. **Later:** experimental workspace prep and native synchronization. No account backend, cloud sync, direct Serato writes, or format proliferation without separate approval.

## Design direction (brief, not an approved mock)
Use Apple's design principles as inspiration, **not copied UI or assets**: clear hierarchy, calm surfaces, restrained color, readable typography, polished motion with reduced-motion support, large accessible touch targets, excellent small-screen layout. **Mobile-first** means designed for touch: fast importing, track review, version comparison, returning from retailers, source selection, and purchasing status, not just shrinking desktop rows. Desktop should remain excellent, with keyboard shortcuts and efficient information density.

Candidate mobile information architecture: playlist overview -> focused track review -> retailer handoff -> manual status confirmation; persistent access to remaining items; advanced metadata via disclosure. Keep the experience usable without login, Serato, or provider connections.

## Non-negotiables
- Never call a search page a verified purchase listing; no invented price or entitlement.
- No automatic purchased/owned/downloaded status from clicking a link.
- Preserve version distinctions, deterministic explanations, request pacing, stale-response protection, older saved data, and CSV behavior.
- User data stays browser-local unless the user explicitly initiates export/import.
- Test iOS Safari, Android Chrome and desktop browsers as distinct environments; no mobile release claims before verification.
- No scraping/private retailer endpoints or music downloading.

## Release evidence
Before claiming mobile ready: test import (paste, CSV, Spotify where supported), matching errors, retailer redirects/return, keyboard and touch interactions, storage reload, small and large lists, empty/loading/error states, VoiceOver/TalkBack basics, 320px and larger viewports, and accessibility (focus/contrast/touch).

## Decision log
- Approved: event/mobile DJs primary users; current acquisition flow is viable as a foundation; mobile-first refinement.
- Approved in principle: MIT after audit.
- Undecided: product rename; separate app vs helper architecture for Workspace Prep.
- Deferred: Serato experimental features in public v1, backend/accounts, native library writes.
