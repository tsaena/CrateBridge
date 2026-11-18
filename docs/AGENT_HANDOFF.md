# Codex / Claude planning and engineering contract

You are collaborating on CrateBridge, a client-only React/TypeScript/Vite/Tailwind application deployed via GitHub Pages. Product owner: working mobile/event DJ. Start by reading README.md, AGENTS.md, docs/PRODUCT_DIRECTION.md and docs/DESIGN_BRIEF.md. Inspect the **actual repository**, issues, working UI and tests before suggesting modifications.

## Mission
Polish the existing music acquisition workflow to be intuitive, premium-feeling, mobile-first and equally effective on desktop. Do not expand into a DJ library organizer. CrateBridge is a working name. Preserve live functionality and users' browser-local progress.

## Operating procedure
1. Establish baseline with npm ci, npm run typecheck, npm run lint, npm test, npm run build. Report existing failures, don't misattribute them to your work.
2. Audit UI at phone/tablet/desktop breakpoints and inspect actual interactions: import, listing/version review, retailer handoff, manually marking acquired, switching playlists, recovery.
3. Before implementation, propose 3 distinct high-fidelity design approaches with phone + desktop examples, interaction maps, accessibility and migration risks. Await owner direction. Don't assume 'Apple-like' means copy Apple interfaces.
4. After design selection, break implementation into small, independently reviewable PRs. Specify scope, acceptance criteria, risks, fixture coverage and manual checks.
5. Preserve catalog evidence labeling, matching explainability, version conflicts, Apple request pacing, stale-response guards, older storage migrations and keyboard navigation.
6. For mobile claims, test real iOS Safari and Android Chrome (including auth/retailer handoffs) or explicitly mark unverified. Simulator-only verification is not device proof.
7. Any feature outside purchase-prep scope, change to backend/accounts, Serato integration, license addition or rename must be a proposal, not an implementation.

## First deliverables
- UX audit prioritized by impact, with screenshots/specific steps.
- Proposed navigation and track detail hierarchy for phone and desktop.
- Three visual directions and a lightweight design token draft, then an owner decision.
- Small engineering backlog with acceptance criteria and regression test plan.
- Explicit list of tasks not proposed now.

## Definition of done for a redesign PR
- Current inputs/statuses/persistence, export and retailer links behave unchanged unless explicitly scoped.
- Touch targets, focus states, labels and status semantics accessible; responsive layouts at 320px and wider.
- Tests/checks pass; regressions in old stored playlists are covered.
- Screenshots and manual verification notes for phone/tablet/desktop, including unsupported-device caveats.
- No experimental Serato code merged.
