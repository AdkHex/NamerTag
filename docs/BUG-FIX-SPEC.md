# RsKv — Bug & Error Fix Spec

> Single-pass remediation spec. Every item is a confirmed finding from a full read of the
> codebase (137 files, ~14.4k lines) as of 2026-08-18. Each entry states the exact file,
> the defect, the fix, and how to verify it.
>
> **Baseline at time of writing:** `typecheck` ✅ · `eslint` ✅ · `vitest` ✅ 123 passed ·
> `prettier --check` ❌ 2 files · Rust checks **not run** (no cargo toolchain on the dev box).

---

## How to work this spec

1. **Do H-0 first.** Nothing else is safe until there is a commit to roll back to.
2. Items are independent unless a `Depends:` line says otherwise. Within a severity band
   they can be parallelised across agents.
3. **Every fix ships with a test.** The naming engine already has a 543-line test suite and
   a snapshot corpus — extend it, don't bypass it.
4. After each batch run: `pnpm run check:all` (typecheck, lint, format, rust fmt, clippy,
   both test suites). It must be green before the next batch.
5. **Hard rule:** do not change embedded-metadata *output* except where an item explicitly
   says so (H-2, H-3). The snapshot test
   `track-title builders remain unchanged (regression lock)` in
   `src/lib/naming-engine.test.ts` is the guard — if it changes and the item didn't say it
   would, the change is wrong.

### Severity definitions

| Band | Meaning |
|------|---------|
| **HIGH** | Destroys user data, corrupts files, or blocks the refactor. Fix first. |
| **MEDIUM** | Wrong output, broken feature, or an architecture flaw that will fight the refactor. |
| **LOW** | Dead code, config drift, cosmetics. Safe cleanup. |

---

# HIGH

## H-0 — Repository has zero commits

**Files:** repo root
**Evidence:** `git ls-files` → `0`. `git log` → *"your current branch 'main' does not have
any commits yet"*. Only `refs/t3/checkpoints/*` exist (tooling artifacts, not real history).

**Defect:** Every file is untracked. There is no baseline, no diff, no rollback. A
multi-agent refactor against an uncommitted tree is unrecoverable if it goes wrong.

**Fix:**
1. Confirm `.gitignore` covers `node_modules`, `dist`, `src-tauri/target`, `.DS_Store` (it
   does).
2. `git add -A && git commit` — one commit, message `chore: import existing RsKv codebase`.
3. Remove the committed `dist/` directory from the index if it slipped in (`dist` is in
   `.gitignore`, but verify: `git ls-files dist | wc -l` must be `0`).
4. Delete the stray tracked `.DS_Store` files if any (`src-tauri/.DS_Store`,
   `src/components/.DS_Store`, `src-tauri/gen/.DS_Store`).

**Verify:** `git log --oneline` shows one commit; `git status` is clean.

---

## H-1 — Crash during non-MKV retag destroys the original file

**Files:** `src-tauri/src/lib.rs:503-556` (`is_stale_artifact_name`,
`cleanup_stale_artifacts`), `:1932-1969` (retag ffmpeg branch), `:2202-2237`
(`write_general_metadata` ffmpeg branch)

**Defect:** The replace sequence is:

```
rename(original → Movie.rskv.<ts>.backup.mkv)   // original now ONLY at .backup
rename(temp     → original)                     // ← crash here = original is gone
remove_file(backup)
```

If the process dies between those two renames, the user's only copy of the file lives at
`Movie.rskv.<ts>.backup.mkv` and nothing exists at the original path.

`cleanup_stale_artifacts` (called at the *start* of the next retag — `:1839`, `:2060`)
matches `.rskv.` + `.backup` and **deletes** any such file older than 1 hour. The recovery
artifact is destroyed by the recovery routine.

**Failure scenario:** User retags `Movie.mkv` (an MP4/MOV — non-MKV path). App is killed
mid-write. `Movie.mkv` no longer exists; `Movie.rskv.1700000000000.backup.mkv` holds the
data. Two hours later the user retags anything else in that folder → the backup is deleted
→ permanent data loss.

**Fix (do all three):**
1. **Never auto-delete backups.** In `is_stale_artifact_name`, restrict automatic cleanup
   to `.rskv.tmp` only. Backups are recovery data — they must survive.
2. **Add crash recovery.** Before writing, if `original` is missing but a matching
   `*.rskv.*.backup*` exists in the same directory, restore it (rename back) and log a
   warning. Do this in `cleanup_stale_artifacts` (rename it to `recover_and_clean`).
3. **Surface orphaned backups.** Return the list of recovered/remaining backup paths from
   the command so the UI can tell the user a prior run was interrupted.

**Tests (Rust):**
- `cleanup_never_removes_backup_files` — a 2-hour-old `.rskv.*.backup.mkv` still exists
  after cleanup.
- `cleanup_removes_only_stale_tmp` — a 2-hour-old `.rskv.tmp.mkv` is removed.
- `recovers_original_from_backup_when_missing` — given only
  `Movie.rskv.123.backup.mkv` and no `Movie.mkv`, cleanup restores `Movie.mkv`.
- Keep the existing `cleanup_stale_artifacts_preserves_recent_and_unrelated`.

---

## H-2 — Empty titles clobber existing metadata on non-MKV files

**Files:** `src-tauri/src/lib.rs:1905-1923`

**Defect:** `build_mkvpropedit_args` (`:1789`) correctly skips blank titles — its comment
says *"Skip empty titles so a blank generated value never clobbers existing metadata."*
The ffmpeg branch has **no such guard**:

```rust
if let Some(title) = item.container_title.as_deref() {
    args.push("-metadata".to_string());
    args.push(format!("title={}", title.trim()));   // ← emits `title=` when blank
}
for (index, title) in item.video_titles.iter().enumerate() {
    args.push(format!("-metadata:s:v:{index}"));
    args.push(format!("title={}", title.trim()));   // ← same
}
// audio + subtitle loops: same
```

The frontend `hasTitles` guard (`useQueueActions.ts:156-161`) only requires *at least one*
non-empty field, so a file with audio titles but a blank container title reaches this path
and wipes the container title on an MP4/MOV.

Also note the stale comment at `useQueueActions.ts:163-165` — *"Empty titles are dropped
server-side"* — which is true for MKV and false for everything else.

**Fix:** Mirror the mkvpropedit guard. Skip any title whose `.trim()` is empty, for
container / video / audio / subtitle alike. This directly implements plan task **T4.3**.

**Tests (Rust):** Extract the ffmpeg arg construction into
`build_ffmpeg_metadata_args(&RetagRequest) -> Vec<String>` (mirroring
`build_mkvpropedit_args`) so it is unit-testable, then assert:
- blank container title emits no `-metadata title=` pair;
- blank entry at audio index 1 emits no `-metadata:s:a:1` pair, while index 0 and 2 still do;
- **the index of a non-blank title is its position in the original array**, not a
  re-packed index (a blank at index 1 must not shift index 2 down to 1).

> ⚠️ That last point is the trap: `enumerate()` currently supplies the stream index. If you
> `filter()` before `enumerate()`, titles get written to the **wrong streams**. Filter
> inside the loop with `continue`, exactly as `build_mkvpropedit_args` does.

---

## H-3 — One unreadable file fails the entire batch

**Files:** `src-tauri/src/lib.rs:1252-1290` (`list_media_streams`),
`src/store/media-analysis-store.ts:39`, `src/components/upload/useQueueActions.ts:109`

**Defect:** `list_media_streams` returns `Result<Vec<MediaAnalysis>, String>` and does an
early `return Err(...)` when *any single* ffprobe invocation fails or its JSON won't parse.
A 50-file queue with one corrupt file yields **zero** analyses — Generate produces nothing
and the user gets one opaque error.

**Fix:** Make the result per-file. Change the return type to a per-path outcome, e.g.

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisOutcome {
    path: String,
    analysis: Option<MediaAnalysis>,
    error: Option<String>,
}
// -> Result<Vec<AnalysisOutcome>, String>  (Err only for a whole-call failure)
```

Update both TS call sites to keep successful analyses and surface per-file errors (see
M-4 for where those errors should be displayed).

**Keep:** the "ffprobe not found. Install ffmpeg to analyze media files." message — that
one *is* a whole-call failure and should still abort with a clear message.

**Tests:** TS-side test that a mixed success/error response populates the store with the
successes and reports the failures.
**Depends:** coordinate with M-4 (per-file error surfacing) — same UI plumbing.

---

## H-4 — Blocking process calls inside async commands freeze the app

**Files:** `src-tauri/src/lib.rs:1257` (ffprobe), `:1846` / `:1928` (mkvpropedit / ffmpeg),
`:2132` / `:2200`; `src-tauri/Cargo.toml:32`

**Defect:** All three commands are `async fn` but call **blocking**
`std::process::Command::output()` in a sequential loop. This occupies a Tauri async worker
thread for the whole batch; a queue of large files makes the UI unresponsive with no
progress feedback. `tokio` is declared in `Cargo.toml` with the `process` feature and is
**never imported anywhere** in the crate.

**Fix:** Either
- **(a)** switch to `tokio::process::Command` and `.await` the output — the dependency and
  its features are already declared; or
- **(b)** wrap each batch in `tauri::async_runtime::spawn_blocking`.

Prefer **(a)** for ffprobe, and additionally bound concurrency (e.g. probe up to 4 files at
once via `futures::stream::iter(...).buffer_unordered(4)`) — probing is I/O-bound and
parallelises well.

Keep **retag / write_general_metadata sequential** — they mutate files, and concurrent
ffmpeg remuxes on the same directory would thrash disk and complicate the backup logic.
Move them to `spawn_blocking` so they don't stall the runtime.

**Note:** `command_no_window()` returns `std::process::Command`; if you adopt tokio you
need a parallel `tokio_command_no_window()` (or make it generic) that applies the same
`CREATE_NO_WINDOW` flag on Windows and the same Homebrew `PATH` augmentation on Unix. Do
not lose either behaviour — the PATH fix is what makes Finder-launched `.app` bundles find
`ffprobe`.

**Verify:** queue 20+ files, click Generate — the window must stay interactive.

---

## H-5 — `useQueueActions` duplicates its state across 5 components

**Files:** `src/components/upload/useQueueActions.ts:55-61` and its 5 call sites:
`TitleBar.tsx:43`, `MainWindowContent.tsx:30`, `BrowseLocalFiles.tsx:62`,
`GeneratedFilenamesPanel.tsx:53`, `GeneratedNamesPanel.tsx:54`

**Defect:** The hook holds `isBrowsing`, `isRenaming`, `isRetagging`, `retaggingPath`,
`retagStatus` in local `useState`. Each of the 5 components gets an **independent copy**.

Consequences:
- A rename started on the Filenames tab never disables the Rename button anywhere else.
- Both tab panels stay mounted (`MainWindowContent.tsx:133-138` uses `hidden`, not
  unmount), so both hold live, divergent copies simultaneously.
- Nothing prevents two concurrent `handleRenameAll` / `handleRetag` runs from different
  components — a genuine correctness risk given they mutate the filesystem.
- `retaggingPath` drives a spinner in `GeneratedNamesPanel.tsx:437`; it only ever works if
  the retag was started from that exact component.

Related: `BrowseLocalFiles.tsx:50` and `useQueueActions.ts:44` call
`useLocalUploadQueue()` with **no selector**, subscribing to the whole store and
re-rendering on every unrelated change.

**Fix:** Move the operation state into a Zustand store (`useQueueOperationsStore` or extend
`ui-store`) holding `isBrowsing | isRenaming | isRetagging | retaggingPath | retagStatus`.
The hook returns store values plus the action callbacks. Add a guard so a second
rename/retag cannot start while one is in flight, app-wide.

While in here, add selectors to the two unselective `useLocalUploadQueue()` calls.

**Tests:** store test asserting a second `handleRenameAll` is a no-op while
`isRenaming === true`.
**This is the single most important item for the upcoming refactor** — most new UI will
consume this hook.

---

# MEDIUM

## M-1 — Bluray/Web filename templates are a non-functional feature

**Files:** `src/components/preferences/panes/GeneralPane.tsx:76-81, 293-493`;
`src/types/preferences.ts:13-14, 59-62`; `src-tauri/src/lib.rs:124-127, 177-178, 224-230`

**Defect:** `blurayFilenameTemplate` and `webFilenameTemplate` are fully plumbed — Rust
struct field + serde default, TS interface + default, and ~200 lines of editable UI with
detailed `{variable}` documentation — and are **read by nothing**. `naming-engine.ts`
hardcodes the muxed/VOD formats. Verified: the only references are the definitions and the
UI that edits them.

The user edits these inputs, sees "Preferences saved", and no output changes. Silent no-op.

**DECIDED (maintainer, 2026-08-18): implement them.** Do not delete.

**Fix:** Add a template-driven render path to `naming-engine.ts` and select it over the
hardcoded builders.

1. **New renderer** `renderFilenameTemplate(m: ParsedMedia, template: string, ext: string)`
   in `naming-engine.ts`. Reuse the existing `{var}` substitution + cleanup logic from
   `naming.ts` — `applyTemplate` / `normalizeTemplateOutput` (`naming.ts:211-243`) already
   strip empty `[]`, `()`, and dangling ` - ` separators. **Extract those two functions into
   a shared module** (`src/lib/template.ts`) rather than copying them; they encode the
   Wave-1 artifact fixes that the corpus test `Wave 1 invariants` enforces.

2. **Template selection** — in `buildOnDiskName`:
   - source is `WEB-DL` / `WEBRip` → `webFilenameTemplate`
   - otherwise → `blurayFilenameTemplate`
   - a **blank** template falls back to the current hardcoded builder for that mode, so an
     empty preference never yields an empty filename.

3. **Variables** — every one documented in the `GeneralPane` UI must resolve. Map from
   `ParsedMedia`:

   | Variable | Source |
   |---|---|
   | `{title}` `{year}` `{seasonEpisode}` | `m.title` / `m.year` / `m.seasonEpisode` |
   | `{resolution}` `{source}` `{provider}` | `m.resolution` / `m.source` / `m.provider` |
   | `{remux}` | `m.isRemux ? 'REMUX' : ''` |
   | `{bitDepth}` | `m.bitDepth10 ? '10bit' : ''` |
   | `{hdr}` | `m.hdr` (already `''` for SDR — must stay that way) |
   | `{videoCodec}` | `m.isRemux ? m.videoFormat : m.videoFinal` |
   | `{audioList}` | `buildMuxedAudioBlock(m.audio)` |
   | `{codecSuffix}` | `m.videoFinal` |
   | `{encoderName}` | `m.group` |
   | `{filenameTag}` | `m.ionicSuffix` |
   | `{webType}` | `m.source` when WEB-DL/WEBRip, else `''` |
   | `{extension}` | passed in; **normally leave empty** — `buildRenameTargetPath` appends the real extension, so emitting it here double-appends |

4. **Mode interaction** — the existing `namingMode` (auto/muxed/VOD) governs the *hardcoded*
   builders. Decide and document one rule: templates apply to **muxed mode only**, VOD keeps
   its dotted builder (recommended — the documented variables are all muxed-shaped and
   dot-joining a template is ill-defined). State this in the `NamingPane` help text.

5. **UI truth** — add a live preview under each template input in `GeneralPane` showing the
   rendered result for a sample, mirroring the parser preview already in
   `NamingPane.tsx:136-177`. This is what makes the feature visibly real.

**Tests:** for each corpus case, assert the default template reproduces the current
hardcoded muxed output byte-for-byte (proving the migration is behaviour-preserving), plus
a custom-template case, plus blank-template fallback, plus a template referencing every
variable with none left unsubstituted (no stray `{...}` in the output).

> ⚠️ The `Wave 1 invariants` corpus test must keep passing: no `SDR`, no `[]`, no `( - )`
> artifacts, for **every** corpus case rendered through the template path.

---

## M-2 — Codec / language / resolution mapping is implemented three times, inconsistently

**Files:**
- Audio codec: `src-tauri/src/lib.rs:868` (`get_audio_codec_tag`) ·
  `src/lib/naming-engine.ts:131` (`mapAudioCodec`) ·
  `src/lib/naming.ts:133` (`getAudioCodecLabel`)
- Video codec: `lib.rs:1031` (`get_codec_tag`) · `naming-engine.ts:78/102`
  (`mapVideoFormat`/`mapVideoFinal`) · `naming.ts:153` (`getVideoCodecLabel`)
- Language: `lib.rs:817` (`get_language_name`, hardcoded 40-entry table) ·
  `src/lib/language.ts:1` (`getLanguageDisplayName`, `Intl.DisplayNames`) ·
  `naming-engine.ts:205` (`normalizeLanguage`)
- Resolution: `lib.rs:1016` (`get_resolution_tag`) · `naming-engine.ts:310`
  (`resolutionFromFilename`)

**Defect — they disagree:**
- `naming.ts:getAudioCodecLabel` has **no** PCM/Opus/MP3/ALAC/Vorbis/WMA handling, **no**
  DTS profile disambiguation, and **ignores user overrides**. So a DTS-HD MA track renders
  `DTS-HD MA` in the filename and `DTS` in the embedded track title, for the same file.
- Rust `get_resolution_tag` returns only `2160p`/`1080p`/`None`; the TS parser handles
  720p/480p. A 720p file gets no resolution from ffprobe dimensions, only from its filename.
  The TS type `resolution_tag: '2160p' | '1080p' | null` encodes the Rust limitation, so
  720p can never round-trip.
- User overrides (`audioCodecOverrides` etc.) only reach the filename path, never track
  titles.

**DECIDED (maintainer deferred to recommendation, 2026-08-18): TypeScript owns mapping.**

**Fix:** Collapse to **one** implementation per mapping. **TypeScript owns all presentation
mapping; Rust returns raw ffprobe fields only.**

Rationale: the override maps (`videoCodecOverrides` / `audioCodecOverrides` /
`languageOverrides`) already live in TS and are user-editable at runtime — pushing them into
Rust means shipping them across the IPC boundary on every probe for no gain. `naming-engine.ts`
is already pure, override-aware, and covered by 543 lines of tests. The Rust `derived.*`
block is a second source of truth that TS mostly overrides anyway.

**Scope note:** keep the Rust `general.derived.*` fields for now — `toParsedMedia` uses them
as *fallbacks* when filename parsing fails (`naming-engine.ts:331-354`), and removing them is
a larger change than this item. What must go is the **duplicate presentation mapping**, not
the fallback data. Retiring `derived.*` entirely is a follow-up, not part of this pass.

Concretely:
1. Have `naming.ts` import `mapAudioCodec` / `mapVideoFormat` from `naming-engine.ts` and
   delete `getAudioCodecLabel` / `getVideoCodecLabel`.
2. Thread `audioCodecOverrides` / `videoCodecOverrides` / `languageOverrides` into
   `buildAudioTitle` / `buildVideoTitle` so overrides apply to track titles too.
3. Widen resolution handling to 720p/480p in both the Rust tag and the TS type union.
4. Pick one language source — `Intl.DisplayNames` with the override map layered on top —
   and delete the Rust table (or keep Rust returning the raw ISO code only).

> ⚠️ Step 2 **changes embedded-metadata output** and will break the regression-lock
> snapshot. That is expected here. Update the snapshot **in the same commit** and state the
> intended diff in the commit message.

**Tests:** table-driven test asserting `buildGeneratedNameDraft` produces the *same* codec
label in `generatedName` and in `audioTitles[i]` for DTS-HD MA, PCM, Opus, TrueHD Atmos.

---

## M-3 — Generate re-probes every file on every click, ignoring the cache

**Files:** `src/components/upload/useQueueActions.ts:106-136`,
`src/store/media-analysis-store.ts:19-55`

**Defect:** `handleGenerate` invokes `list_media_streams` with **all** queue paths every
time. `media-analysis-store.loadAnalyses` already implements correct cache-aware probing
(*"Only probe paths we don't already have"*, `:32`) — and `handleGenerate` bypasses it
entirely, calling `invoke` directly and then `setAnalyses`.

Result: clicking Generate twice on a 50-file queue runs 100 ffprobe processes. Combined
with H-4 (sequential + blocking) this is the main source of UI freezes.

Compounding: `loadAnalyses` is only reachable from `MediaDetailsPanel`, which is **dead
code** (L-1). So the good cache-aware path is currently unreachable and the wasteful path
is the only one running.

**Fix:** Route `handleGenerate` through `useMediaAnalysisStore.loadAnalyses(paths)`, then
build drafts from `analysesByPath`. Add an explicit "Re-analyze" affordance if a forced
re-probe is wanted.
**Depends:** H-3 (per-file results), H-4 (async).

---

## M-4 — Per-file rename/retag errors are not shown

**Files:** `src/components/upload/useQueueActions.ts:230-240, 318-322`;
`src/store/local-upload-queue-store.ts:11-13`

**Defect:** `handleRetag` collects per-file `results` with individual `error` strings, then
reports only a count: `toast.error(\`Failed to retag ${failed.length} files\`)`. The
individual reasons are discarded. `handleRenameAll` shows only `failedDetails[0]?.error`.

The queue store already has `status` and `message` fields per item (`:11-12`) and
`setItemStatus` is called for rename failures — but **not** for retag failures, and the
queue UI (`BrowseLocalFiles.tsx:212-244`, `variant="queue"`) renders neither field. The
data is captured and thrown away.

This is plan task **T5.4**, marked done but only half-implemented.

**Fix:**
1. Call `setItemStatus(id, 'failed', error)` for each failed retag, as rename already does.
2. Render `status`/`message` in the queue row — an error icon plus the message in a
   tooltip.
3. Extend to per-file analysis errors from H-3.

**Tests:** a 2-of-3 failure batch surfaces both distinct reasons.

---

## M-5 — Removing a file from the queue leaks its generated-names entry

**Files:** `src/components/upload/BrowseLocalFiles.tsx:231-236`,
`src/store/generated-names-store.ts:216` (`removeOriginal`)

**Defect:** The queue row's X button calls `remove(item.path)` on the upload queue only.
`useGeneratedNamesStore.removeOriginal` exists and is **never called from anywhere**. The
entry — generated name, all track titles, and the baseline — stays in the store forever.

Failure scenario: remove `Movie.mkv`, re-add it later. `ensureOriginal`
(`BrowseLocalFiles.tsx:164-168`) sees an existing entry and keeps the **stale** titles from
the previous session, including a baseline that no longer matches the file's actual streams.
The retag stream-count guard (`useQueueActions.ts:166-183`) catches the worst case, but only
if an analysis is cached.

**Fix:** Call `removeOriginal(item.path)` alongside `remove(item.path)`. Also purge the
matching `media-analysis-store` entry (needs a new `removePath` action — `clear` and
`renamePath` exist, single-path removal does not).

**Tests:** store test — remove then re-add a path yields an empty entry, not the old one.

---

## M-6 — Concurrent preference writes can lose updates

**Files:** `src/services/preferences.ts:39-58`;
callers `GeneratedFilenamesPanel.tsx:139-140, 161-162, 188-189`

**Defect:** `useSavePreferences` reads the **entire** current object from the react-query
cache at mutation time, merges the patch, and writes the whole struct to disk. The cache is
only updated in `onSuccess`. Two mutations fired in quick succession both read the same
pre-update snapshot; the second overwrites the first's field.

`GeneratedFilenamesPanel` makes this reachable: each control calls
`savePreferences.mutateAsync({...})` and *immediately* `regenerateFromCache({...})`. Rapidly
toggling naming mode then Remove year can persist only the later one.

Also: `mutateAsync` is called without `await` or `.catch()` in three places — an unhandled
rejection if the write fails.

**Fix:** Use react-query optimistic updates — `onMutate` writes the patch into the cache
immediately and returns a rollback context; `onError` rolls back. Serialise writes by
keying the mutation. Attach `.catch()` (or switch to `mutate`) at the fire-and-forget call
sites.

---

## M-7 — Atmos and REMUX heuristics are silently wrong in common cases

**Files:** `src-tauri/src/lib.rs:1506-1510` (atmos), `:1238-1250` (`get_release_type`)

**Defect A — Atmos:** detection requires a literal `"atmos"` substring in the track title,
profile, or codec long-name. ffprobe frequently reports none of these for a TrueHD Atmos
track. Plan task **T3.4** asked to *"broaden Atmos detection (don't require literal title
substring when codec is truehd/eac3 and channel/object cues present)"* — that was not done;
the code still requires one of the three substrings.

**Defect B — REMUX:** any file with video bitrate ≥ 30 Mbps is labelled `REMUX` even
without a `remux` filename token. A high-bitrate 2160p **encode** is routinely above
30 Mbps, so it gets mislabelled — and `release_type === 'REMUX'` flows into
`toParsedMedia` (`naming-engine.ts:344`), changing the codec token from `x265` to `HEVC`
and inserting a `REMUX` token into the filename. Plan **T3.3** asked to *"treat bitrate-only
REMUX as a weak hint (raise threshold / require corroboration)"* — not done.

**Fix A:** Treat `truehd` + ≥8 channels as probable Atmos when no contrary signal exists,
or add a `TrueHD (assume Atmos)` preference. Document the residual ffprobe limitation in a
comment.
**Fix B:** Require corroboration — bitrate-only REMUX should need both a high bitrate
**and** a lossless audio track / `2160p` disc-source signal, or raise the threshold
substantially (≥60 Mbps for 2160p). Filename `remux` token stays the primary signal.

**Tests (Rust):** a 45 Mbps 2160p HEVC encode with DDP audio and no `remux` token →
`Encode`, not `REMUX`.

---

## M-8 — Two identical `listFilesInFolder` implementations, both unbounded

**Files:** `src/components/upload/useQueueActions.ts:28-41`,
`src/components/upload/BrowseLocalFiles.tsx:26-39`

**Defect:** Byte-identical recursive directory walkers duplicated in two modules. Both
recurse with no depth limit, no file-count cap, and **no media-extension filter** — every
file in the tree is added to the queue, including `.nfo`, `.srt`, `.jpg`. Those then get
handed to ffprobe (H-3: one failure kills the batch).

A `MEDIA_EXTENSIONS` set already exists in `naming.ts:23-32` and is not used for filtering.

**Fix:** Extract one shared `listMediaFilesInFolder(path)` into `src/lib/fs.ts`. Filter by
`MEDIA_EXTENSIONS`. Add a depth cap and a file-count cap with a warning toast on truncation
(*"no silent caps"* — tell the user what was dropped).

---

## M-9 — Window opens smaller than its own minimum size

**Files:** `src-tauri/tauri.conf.json:17-20`

**Defect:** `"width": 800, "height": 600` with `"minWidth": 1000, "minHeight": 700`. The
initial size violates the stated minimum; the OS clamps it, so the declared values are
misleading and the first-run size is undefined-by-config.

**Fix:** Set the initial size to something ≥ the minimum, e.g. `1280 × 800`.

---

# LOW

## L-1 — Dead code (~1,335 lines, ~9% of the codebase)

Verified unreferenced. Delete all of it:

| File | Lines | Note |
|------|-------|------|
| `src/components/media/MediaDetailsPanel.tsx` | 391 | No importers |
| `src/components/kibo-ui/tree/index.tsx` | 446 | Only used by the above; removing it drops the `motion` dep |
| `src/lib/notifications.ts` | 108 | No importers |
| `src/components/ui/popover.tsx` | 87 | Zero importers |
| `src/components/layout/Layout.tsx` | 20 | Exported via `index.ts`, never rendered |
| `src/components/layout/LeftSideBar.tsx` | 18 | Same |
| `src/components/layout/index.ts` | 15 | Only re-exports the two dead components |

Also remove:
- `greet` command — `src-tauri/src/lib.rs:89-99` and its `generate_handler!` entry (`:2432`).
  No frontend caller. Note `tauri.conf.json` sets `"removeUnusedCommands": true`, so it is
  already being stripped from the ACL — the source is pure dead weight.
- `send_native_notification` (`lib.rs:303-338`) — only reachable via the dead
  `notifications.ts`. Remove together, or keep the Rust side if native notifications are
  planned; do not leave the TS half orphaned.
- `loadEmergencyData` — `src/lib/recovery.ts:69-94`, no callers.
- `useIsMobile` / `src/hooks/use-mobile.ts` — only consumed by `ui/sidebar.tsx`, which is
  used solely for the Preferences dialog nav. Keep if you keep `sidebar.tsx`; it is a
  724-line shadcn primitive powering a 4-item static list and is a candidate for
  replacement by a plain flex column.

> ⚠️ **Do not delete `MediaDetailsPanel` before M-3 is done.** It is the only caller of
> `media-analysis-store.loadAnalyses`; M-3 makes `handleGenerate` the new caller. Order:
> M-3 first, then delete.

## L-2 — Unused dependencies

**Files:** `package.json:39-107`, `src-tauri/Cargo.toml:18-36`

npm — zero references in `src/`:
`@radix-ui/react-checkbox`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-radio-group`,
`@radix-ui/react-scroll-area`, `@radix-ui/react-toggle`, `@radix-ui/react-toggle-group`,
`@tanstack/react-table`, `cmdk`, `react-day-picker`.

Also: `@tauri-apps/plugin-clipboard-manager` and `@tauri-apps/plugin-opener` — registered in
Rust and granted in `capabilities/default.json`, but never called from the frontend. Remove
the npm packages, the Rust plugins, and the capability entries together, or wire them up.

`react-resizable-panels` — referenced only by a **comment** in `src/test/setup.ts:4`. Remove
the dep; keep the `ResizeObserver` mock (other libraries need it) and fix the comment.

`motion` — only `kibo-ui/tree`; drops out with L-1.

Rust — `Cargo.toml`: `libc` is never referenced. `tokio` is never imported **but is needed
by H-4** — keep it and actually use it.

## L-3 — `prettier --check` fails

**Files:** `src/components/media/ExtraActionsPanel.tsx`, `docs/IMPLEMENTATION-PLAN.md`
**Fix:** `pnpm run format`. This blocks `check:all` and therefore
`scripts/prepare-release.js`, which aborts on a non-clean tree after running `check:all`.

## L-4 — `package.json` references a script that does not exist

**Files:** `package.json:37`
`"update:test:local": "bash scripts/test-update-local.sh"` — `scripts/` contains only
`prepare-release.js`. Remove the entry or add the script.

## L-5 — Vacuous test

**Files:** `src/App.test.tsx:16-28`
`expect(titleBarButtons.length).toBeGreaterThanOrEqual(0)` is true for any array, including
empty. The test named *"renders title bar with traffic light buttons"* asserts nothing.
**Fix:** assert the actual macOS window controls render (they have accessible labels in
`MacOSWindowControls.tsx`), or delete the test.

## L-6 — Dead data in the preferences UI

**Files:** `src/components/preferences/panes/GeneralPane.tsx:29-41`
`VariableInfo` declares `name`, `description`, `example`, but `VariableList` renders only
`{variable.name}`. Roughly 250 lines of `description`/`example` strings are never displayed.
**Fix:** either render them (a tooltip or a two-column table — they are genuinely useful
documentation) or reduce the data to a `string[]` of names.
**Note:** if M-1(a) is chosen, ~half of this disappears with the deleted template fields.

## L-7 — No Content Security Policy

**Files:** `src-tauri/tauri.conf.json:37-39` — `"csp": null`.
**Fix:** Set a restrictive policy. The app loads no remote content, so
`"default-src 'self'; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'"` is a
reasonable starting point. Verify the dev server and Tailwind's injected styles still work.

## L-8 — Very broad filesystem scope

**Files:** `src-tauri/capabilities/default.json:22-40`
Grants `$HOME/**` plus `?:/**` and `?:\\**` (all Windows drives). Broad for an app that
operates on user-selected files. `tauri-plugin-persisted-scope` is already enabled, which
means dialog-selected paths persist their own scope.
**Fix:** Consider narrowing to `$VIDEO`, `$DOWNLOAD`, `$DESKTOP`, `$DOCUMENT` and relying on
persisted scope for anything else. **Test drag-and-drop carefully** — dropped paths are not
dialog-granted and may need the wider scope. If narrowing breaks drops, document why the
wide scope is required instead of silently reverting.

## L-9 — Stale and misleading comments

- `src/components/upload/useQueueActions.ts:163-165` — *"Empty titles are dropped
  server-side so they never clobber existing metadata."* False for non-MKV (H-2). Update
  after H-2 lands.
- `src/store/ui-store.ts:64` — `updateProgress: downloading ? null : null` — both branches
  are `null`. Simplify to `updateProgress: null`.
- `src-tauri/src/lib.rs:2422-2427` — five log statements labelled *"This is a trace/debug/
  info/warn message"* fire on every startup. Remove.
- `src/lib/logger.ts:74-78, 106-120` — two large commented-out blocks. Remove or implement.
- `src/components/media/GeneratedNamesPanel.tsx:255-257, 339-342, 474, 500` — commented-out
  JSX. Remove.

## L-10 — `.DS_Store` files in the tree

`.DS_Store`, `src-tauri/.DS_Store`, `src-tauri/gen/.DS_Store`, `src/components/.DS_Store`.
`.gitignore` covers them; delete from disk so they never get force-added.

---

# Suggested execution order

| Batch | Items | Parallel? | Gate |
|-------|-------|-----------|------|
| 0 | **H-0** | no | commit exists |
| 1 | H-1, H-2, M-7 (all Rust, all in `lib.rs`) | one agent — same file | `cargo test` + `clippy` |
| 2 | H-3 → H-4 → M-3 (backend contract, then async, then caching) | sequential | `check:all` |
| 3 | H-5, M-4, M-5, M-6 (frontend state) | H-5 first, then M-4/M-5/M-6 in parallel | `check:all` |
| 4 | M-2 (mapping unification) | one agent — touches both languages | snapshot diff reviewed |
| 5 | M-8, M-9 | parallel | `check:all` |
| 6 | **M-1** (implement templates) | one agent — do **after** M-2 | corpus byte-identical |
| 7 | All **LOW** | parallel; L-1 after M-3, L-6 after M-1 | `check:all` |

**Why M-1 moved to last:** it is now a build, not a delete, and it consumes the mapping
functions that M-2 unifies plus the `applyTemplate` helpers it extracts. Doing M-1 first
would mean writing the renderer against three inconsistent codec mappers and then reworking
it. It is also the only item whose acceptance test is "output is byte-identical to today" —
that check is meaningless until M-2 has settled what the correct labels are.

**L-6 note:** with M-1 implemented (not deleted), the `{variable}` documentation in
`GeneralPane` becomes *live* documentation for a real feature. Render the `description` and
`example` fields rather than reducing them to a name list.

**Toolchain note:** Rust is not installed on this machine — `cargo`, `rustc` and
`mkvpropedit` are all absent, and `src-tauri/target/` does not exist. Any agent taking
batch 1, 2 or 4 must install the Rust stable toolchain first, or the Rust half of
`check:all` silently never runs.

## Definition of done

- `pnpm run check:all` green, **including** the Rust half.
- No new `eslint-disable` or `#[allow(...)]` without a comment explaining why.
- Each fix has a test that fails before it and passes after.
- H-1 and H-2 have explicit regression tests — they are the data-loss items.
- The regression-lock snapshot changed **only** in the M-2 commit, with the diff explained
  in the commit message.
