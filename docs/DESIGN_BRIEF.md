# Mobile-first UX and visual design brief (planning; no implementation approved)

## Users and context
Working event/mobile DJs often prepare playlists from client requests, purchase unfamiliar music via retailers, and use streaming selectively. Primary context: smartphone between activities or on the go; desktop for large playlist reviews.

## Design intent
Clean, calm, confident and fast; Apple-like in *quality* rather than imitation. Preserve CrateBridge's specific DJ/music workflow and don't introduce a generic dashboard. Explore **three distinguishable visual directions** before selecting one, using screenshots of the current product as the baseline.

## High-priority journeys
1. Brand-new DJ imports pasted list/CSV and identifies remaining tracks.
2. DJ opens correct-version iTunes listing and returns to manually confirm purchase.
3. DJ finds a remix/version conflict and chooses an alternative without accidentally purchasing the wrong recording.
4. DJ with 50-100 tracks filters to unreviewed, returns later with browser progress intact.
5. DJ switches between gig playlists on a phone without losing their place.
6. DJ sees an unavailable API or search-only provider and understands exactly what is known.

## Required patterns
- Progressive disclosure of technical matching evidence; one primary action per screen/track.
- Prominent track title, artist, requested version, review state; distinguish *reviewed*, *purchased*, and *verified listing*.
- Thumb-friendly touch controls; at least ~44x44 CSS px hit targets; visible focus, semantic labels and non-color status communication.
- Responsive hierarchy: phone-oriented detail flow; desktop can display denser side-by-side information. Don't hide critical actions on mobile.
- Empty, loading, errors, confirmation and recovery; dark-mode consideration and reduced-motion support.
- No destructive changes to playlist progress or stored schema in a visual-only redesign.

## Prototype evaluation / success
Use existing screens and 5 representative task scripts. Capture small phone, large phone, tablet and desktop layouts. A first-time DJ should import a playlist and begin reviewing without instructions. Compare taps, ambiguity, errors and completion time to today's UI. Validate on physical devices before calling mobile supported.

## Scope limitations
No new Serato import, cloud accounts, full gig planning or payments. Separate UX exploration from code changes. Codex/Claude implement only after owner selects a direction.
