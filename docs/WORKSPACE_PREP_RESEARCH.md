# DJ Workspace Prep — preserved research notes (not a CrateBridge web roadmap)

**Status:** research only. Architecture is undecided (separate installed application versus optional local helper). Do not delete the experimental Serato work, treat it as shipped, or merge it into the web release by default.

## Jobs
- Discover present-day Serato libraries and obtain consistent backups.
- Distinguish historical library references from files currently present, including disconnected external disks.
- Reconcile acquired downloads against requested tracks and local records.
- Create/rearrange playlists and crates; preview changes before attempting any write.
- Eventually support additional applications only after format-specific evidence.

## Existing experimental work (not public release)
On a local experimental branch: read Serato root.sqlite ZIP/extracted SQLite; normalize tracks and ordered crate membership in IndexedDB; compare purchase lists against local-file entries; manual confirm/correct/reject/unlink/undo; transfer equivalent confirmations; surface version/duration conflicts; filter missing-from-snapshot; portable JSON restore/recovery. Automated and browser checks exist; real-world acceptance is incomplete.

## Known risks
A Serato backup ZIP is a recovery snapshot, not the active database; editing it does not synchronize Serato. Streaming entries are excluded from ownership matching. Historical local-file records do not prove present-day path accessibility. Direct write support requires version-specific fixtures, consistency handling and tested backup/rollback. Avoid making unverified 'downloaded' promises.

## Research dependencies and spikes
- Serato SQLite adapters (read-only and version-specific), external drive handling, audio metadata, ordered crates.
- Spike 1: compare independent parsers on anonymized 4.x snapshots and edge-case memberships; assess unknown fields.
- Spike 2: scan local music directories, distinguish missing vs offline volume and renamed tracks.
- Spike 3: reconcile safe synthetic download metadata; discriminate remixes/edits and duplicate names.
- Spike 4: round-trip portable playlists to an actual DJ application before investigating writes.
- Spike 5: failure-injected backup and recovery for every supported native writer.

## Repo strategy
For now this file is a public, non-sensitive research pointer. A dedicated **private** repository is preferable for detailed fixtures, proprietary-format findings and experimental implementation. Do not commit genuine user databases, filenames, paths, music recordings, tokens, or third-party proprietary assets. Preserve the current experimental branch pending controlled migration, and record a commit/branch reference before moving anything. Creating a private repo and transferring research requires a separate GitHub action/tool and explicit review; this document is not proof that a second repository already exists.
