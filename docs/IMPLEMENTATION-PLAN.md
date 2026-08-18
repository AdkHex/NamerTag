# RSKV Implementation Plan — Naming Engine, Bug Fixes & Features

> **Status (2026-06-17):** Waves 0–5 ✅ + Wave 6 (core subset) ✅ landed and verified —
> 88 JS tests + 14 Rust tests passing, tsc/eslint/prettier/clippy clean.
> - **D1 decided:** embedded container title = clean `Title (Year)` (movies) / `Title (Year) SxxExx`
>   (series); legacy `… - Downloaded from` behavior available via `legacyContainerTitle` pref.
> - **Wave 4 note:** mkv retag intentionally kept in-place (mkvpropedit is safe-by-design;
>   full-copy-per-edit would be a UX regression). The Critical batch-rename data-loss path
>   (B23) is fixed via the `safe_rename` no-clobber Rust command + in-batch dedup.
> - **Wave 6 implemented:** Naming mode (Auto/Muxed/VOD) + Suffix-tag UI controls, validation
>   warnings per row.
> - **Wave 6b implemented:** undo/rollback rename log (`safe_rename` in reverse + `Undo`
>   button), parsed-token preview chips per row, test-case runner + legacy-title toggle +
>   codec mapping reference in a new Preferences → Naming pane.
> - **Wave 6c implemented:** editable codec/language *mapping overrides* — `videoCodecOverrides`
>   / `audioCodecOverrides` / `languageOverrides` prefs (TS + Rust HashMaps), threaded through
>   the engine mappers, with a row-based editor in Preferences → Naming. Overrides flow into
>   both the generated filename and the live preview.
> - **Still deferred (rationale):** log export — logs already persist to the app log dir via
>   tauri-plugin-log; a "reveal log" button is low value.


> Source of truth: the verified audit (36 confirmed bugs, 5 partial, 10 flow bugs). Each
> task cites the bug IDs (B1–B35) and exact files. Execute waves in order; tasks within a
> wave are mostly parallelizable. **Hard rule: never change embedded-metadata writing
> except in Wave 4, and only behind the decisions in §Decisions.**

## Guiding constraints

- Keep **filename generation** and **metadata writing** isolated (they already are:
  `buildFilename` vs `buildVideoTitleText`/`buildAudioTitle`). New filename modes touch
  only the filename path.
- The app uses **ffprobe** (not MediaInfo) and **mkvpropedit/ffmpeg**. Do not claim data
  ffprobe can't provide; fall back to filename/override.
- Every behavioral change ships with a test (Wave 0 builds the harness first).
- Small, reversible commits per task.

---

## Decisions needed (defaults chosen so work is not blocked)

| # | Question | Default used by this plan | Tasks gated |
|---|----------|---------------------------|-------------|
| D1 | Embedded container title: keep `… - Downloaded from <tag>` or clean `Title (Year)`? | **Clean `Title (Year)`**, old behavior available via a "legacy container title" toggle | T4.1 |
| D2 | DV label style | **`DoVi HDR`** default, toggle for `DV HDR` | T3.6 |
| D3 | `-Ionicboy` suffix scope | **Muxed only**; no original group → `(Ionicboy)`; VOD keeps `-OrigGroup`, no Ionicboy | T2.4 |
| D4 | Missing audio language | **Keep track, label `Unknown`** (configurable); never silently drop | T3.1 |
| D5 | HDR10+/DV profile-5 deep detection (`-show_frames`, slower) | **Opt-in setting, default off**; filename-token fallback otherwise | T3.7 |

> Confirm or override these before/at Wave 4. Waves 0–3 are safe under any choice.

---

## Wave 0 — Test harness & fixtures (foundation, no behavior change)

**T0.1 — Build naming test fixtures + corpus.**
- Files: `src/lib/__fixtures__/media-analysis.ts` (factory for `MediaAnalysis`),
  `src/lib/naming.fixtures.test.ts`.
- Steps: add a `makeAnalysis(partial)` builder; encode the 13 cases from the audit test
  plan (Inception muxed/VOD, 10bit HEVC, 2160p HDR10, DV+HDR, Up, Her, Blade Runner 2049,
  no-group, SDR, DTS-HD MA, untagged-language).
- Acceptance: fixtures compile; one smoke test asserting current (buggy) output is
  snapshotted so Wave 1–3 changes are visible as intended diffs.
- Risk: none.

**T0.2 — Rust unit-test scaffolding.**
- Files: `src-tauri/src/lib.rs` (`#[cfg(test)] mod tests`).
- Steps: add tests for `parse_title_year`, `get_release_group`, `get_audio_codec_tag`,
  `get_channel_layout`, `get_resolution_tag` against representative inputs.
- Acceptance: `pnpm run rust:test` green (documents current behavior, including bugs).

---

## Wave 1 — Immediate zero-risk filename fixes (quick wins)

**T1.1 — Stop the SDR leak (B1/B10/B18). Critical visible bug.**
- Files: `src-tauri/src/lib.rs:1336-1337`.
- Steps: change the `else if primary_video_transfer.is_some() { Some("SDR") }` branch to
  `else { None }`. SDR = absence of an HDR tag.
- Acceptance: a bt709 1080p BluRay file no longer emits `SDR` in the filename;
  `Inception…` → `Inception (2018) 1080p BluRay [English DDP 5.1] x264 (RaZoR - )`.
- Risk: low (also removes "SDR" from video-track titles, which is desired).

**T1.2 — Strip empty bracket/paren artifacts (B2/B3).**
- Files: `src/lib/naming.ts` (`normalizeTemplateOutput` ~182-197, or new post-pass).
- Steps: after rendering, remove empty `[]`, empty `()`, and dangling separators:
  `\[\s*\]`, `\(\s*\)`, `\(\s*-\s*\)`, and collapse `(\s*-\s*X)`→`(X)` / `(X\s*-\s*)`→`(X)`.
- Acceptance: untagged-audio file no longer shows `[]`; empty filenameTag no longer shows
  `( - )`.
- Risk: low. (Superseded structurally by Wave 2's parts-join, but valuable immediately.)

---

## Wave 2 — New naming engine (core; filename path only)

**T2.1 — `ParsedMedia` model + adapter.**
- Files: `src/lib/naming-engine.ts` (new), `src/lib/naming-engine.test.ts` (new).
- Steps: define `ParsedMedia`/`AudioPart` (per audit §E); write
  `toParsedMedia(analysis, preferences)` that centralizes title/year/source/group/HDR/
  codec/audio derivation, applying the §E fallback priority (ffprobe → metadata → filename
  → override).
- Acceptance: adapter unit-tested against fixtures; pure (no I/O).
- Depends: T0.1.

**T2.2 — Codec/audio/channel/language mappers (B4/B10/B11/B12/B19).**
- Files: `src/lib/naming-engine.ts`.
- Steps: implement `mapVideoToFinal` (AVC→x264, HEVC→x265, AV1, VP9, MPEG-4→XviD),
  `mapAudioCodec` (DDP/DD/DTS + DTS-HD MA/HRA/DTS:X via profile, TrueHD, AAC, FLAC, Opus,
  MP3, PCM — never return empty), `normalizeChannels` (8→7.1,7→6.1,6→5.1,4→4.0,2→2.0,1→1.0),
  `normalizeLanguage` (extend table; default per D4).
- Acceptance: table-driven tests for every mapping incl. DTS profile + PCM.
- Depends: T2.1.

**T2.3 — Title/year + release-group parsers (B5/B6).**
- Files: `src/lib/naming-engine.ts`.
- Steps: `parseTitleYear` picks the **last** plausible year; `parseReleaseGroup` returns
  `''` unless a hyphen-delimited token exists and it's not a tech token (denylist).
- Acceptance: `Blade.Runner.2049.2017…`→title `Blade Runner 2049`/year `2017`;
  `Inception.2018.1080p.BluRay.mkv`→group `''`.
- Depends: T2.1.

**T2.4 — Muxed + VOD builders (B4/B7/B8/B3 + Ionicboy per D3).**
- Files: `src/lib/naming-engine.ts`.
- Steps: implement `buildMuxedFilename` (parts-array join, `[lang codec ch + …]`, x264/x265,
  `10bit HEVC` descriptor, `(Group-Ionicboy)`) and `buildVodFilename` (dotted, language
  before codec, `-OrigGroup`). Add `orderAudio(parts, languagePriority)` (Hindi-first
  default, configurable).
- Acceptance: all 13 fixture cases match the audit's expected outputs (Cases 1–8 + 9–13).
- Depends: T2.2, T2.3.

**T2.5 — Mode toggle + Ionicboy/language-order settings.**
- Files: `src/types/preferences.ts`, `src-tauri/src/lib.rs` (AppPreferences struct +
  defaults, `#[serde(default)]`), `src/components/media/GeneratedFilenamesPanel.tsx`.
- Steps: add `namingMode: 'auto'|'muxed'|'vod'`, `ionicSuffix: string` (default
  `'Ionicboy'`), `languagePriority: string[]` (default `['hin','eng']`). Auto-detect:
  `audio.length <= 1` → VOD else muxed. Add a Select next to Print type.
- Acceptance: switching modes re-renders the generated name; auto picks correctly.
- Depends: T2.4.

**T2.6 — Wire engine into `buildFilename` (swap body, keep signature).**
- Files: `src/lib/naming.ts` (`buildFilename`, `buildGeneratedNameDraft`).
- Steps: replace `buildFilename` internals with
  `buildOnDiskName(toParsedMedia(analysis, prefs), mode)`. **Do not touch**
  `buildVideoTitleText`/`buildVideoTitle`/`buildAudioTitle`/`buildSubtitleTitle`.
- Acceptance: regression test asserts metadata-builder outputs are byte-identical
  pre/post; filename now matches targets.
- Depends: T2.5. **Gate: metadata-unchanged regression test must pass.**

---

## Wave 3 — Rust ffprobe / derived-field fixes

**T3.1 — `display_name` never drops a track (B9/D4).**
- Files: `src-tauri/src/lib.rs:1254-1263`.
- Steps: build `display_name` from whatever parts exist; missing language → `Unknown`
  (or configured default); missing codec → mapped fallback, never `None` that hides a track.
- Acceptance: untagged-language/PCM track still appears.

**T3.2 — Audio codec tags incl. DTS profile, PCM, Opus, MP3 (B10/B11/B12).**
- Files: `src-tauri/src/lib.rs:737-749` (`get_audio_codec_tag`).
- Steps: add `pcm_*→PCM`, `opus→Opus`, `mp3→MP3`, `mlp→TrueHD`; for `dts` read `profile`
  → DTS-HD MA / HRA / DTS:X / DTS.
- Acceptance: DTS-HD MA fixture labels correctly; PCM not dropped.

**T3.3 — Video bitrate BPS fallback + REMUX heuristic (B13).**
- Files: `src-tauri/src/lib.rs` (video branch ~1101, `get_release_type` 983-995).
- Steps: read `tags.BPS`/`BPS-eng` for video like audio does; keep filename `remux` token
  as primary signal; treat bitrate-only REMUX as a weak hint (raise threshold / require
  corroboration).
- Acceptance: MKV remux with `remux` in name → REMUX; high-bitrate encode not misflagged.

**T3.4 — Atmos / DTS:X detection (B14).**
- Files: `src-tauri/src/lib.rs:1231-1247`.
- Steps: broaden Atmos detection (don't require literal title substring when codec is
  truehd/eac3 and channel/object cues present); label DTS:X from profile.
- Acceptance: TrueHD Atmos with empty title still flagged (document residual ffprobe limits).

**T3.5 — Channel layouts beyond 1/2/6/8 (B18).**
- Files: `src-tauri/src/lib.rs:751-775`.
- Steps: map 3→3.0, 4→4.0, 7→6.1; strip parenthetical for any leaked raw layout.
- Acceptance: 6.1 track renders `6.1`, not `6.1(back)`.

**T3.6 — HDR/DV labels + DV-vs-DoVi toggle (B17/D2).**
- Files: `src-tauri/src/lib.rs:1330-1335`, preferences.
- Steps: emit `HDR10`/`HDR10+`/`HLG`/`DV HDR`|`DoVi HDR` distinctly; never `SDR` (already
  removed in T1.1). DV style from preference (default DoVi).
- Acceptance: HLG ≠ HDR10; DV+HDR10 hybrid shows DV style.

**T3.7 — (Opt-in, D5) Deep HDR10+/DV-RPU detection.**
- Files: `src-tauri/src/lib.rs:1002-1011` (conditional `-show_frames -read_intervals %+#5`).
- Steps: behind a setting; parse per-frame ST 2094-40 (HDR10+) and DOVI RPU for profile 5/8.
- Acceptance: HDR10+ sample labeled `HDR10+`; off by default (perf).

---

## Wave 4 — Metadata & data-safety (touches writing — honor §Decisions)

**T4.1 — Decouple embedded container title (B20/D1).**
- Files: `src/lib/naming.ts` (add `containerTitle` to draft), `generated-names-store.ts`,
  `useQueueActions.ts:155-161`.
- Steps: derive a clean `Title (Year)` `containerTitle`; send that as `containerTitle`.
  Add `legacyContainerTitle` toggle to restore the `… - Downloaded from` behavior.
- Acceptance: retagged MKV `info title` reads `Inception (2018)` (or legacy if toggled).
- Risk: changes written metadata — gated by D1.

**T4.2 — Retag stream mapping by `stream_index` + length validation (B21).**
- Files: `useQueueActions.ts:146-163`, `src-tauri/src/lib.rs:1445-1464,1543-1556`.
- Steps: carry `stream_index` with each title; map metadata by index, validate array
  length vs current probe; refuse/realign on mismatch instead of positional guesswork.
- Acceptance: editing/reordering can't mislabel a track; mismatch surfaces an error.

**T4.3 — Don't clobber existing track names with empty titles (B22).**
- Files: `src-tauri/src/lib.rs` (skip empty), or filter before invoke.
- Steps: skip whitespace-only title args in both mkvpropedit and ffmpeg arg builders.
- Acceptance: a blank generated title leaves the existing track name intact.

**T4.4 — Safe batch rename: dedup targets + cycle handling + rollback (B23/B24).**
- Files: `useQueueActions.ts:225-256`, new Rust `safe_rename` command (atomic no-clobber).
- Steps: pre-compute all targets, detect duplicate/case-insensitive collisions and cycles
  up front; stage via temp names when needed; rename through a Rust command that refuses to
  overwrite (open `O_EXCL`/`hard_link`+unlink); collect per-file results.
- Acceptance: same-target batch is blocked before any write; swap (A↔B) succeeds; no clobber.
- Risk: medium (data-safety critical — thorough tests required).

**T4.5 — MKV retag backup parity (B25).**
- Files: `src-tauri/src/lib.rs:1475-1523`.
- Steps: copy → backup → mkvpropedit on copy → swap → cleanup, mirroring the ffmpeg path;
  or document/accept in-place and add an explicit "create backup" option.
- Acceptance: interrupted MKV retag leaves a recoverable original.

**T4.6 — Backend rename validation + byte-length limit (B31/B34).**
- Files: `src-tauri/src/lib.rs` (new `safe_rename` from T4.4), `src/lib/naming.ts:117-119`.
- Steps: validate destination (reserved names, trailing dot/space, **UTF-8 byte** length
  ≤ 255) server-side; change JS guard to byte length.
- Acceptance: CJK 200-char title is rejected with a clear message, not an OS ENAMETOOLONG.

---

## Wave 5 — UI / state correctness

**T5.1 — Single analysis source; stop double-probe & overwrite (B27).**
- Files: `MediaDetailsPanel.tsx:118-122`, `media-analysis-store.ts`.
- Steps: `loadAnalyses` merges (probe only missing paths), never full-replaces what
  Generate stored; dedupe the two invocation sites.
- Acceptance: ffprobe runs once per file; derived fields survive adding a new file.

**T5.2 — Dirty/baseline survives rename & remount (B29).**
- Files: `GeneratedNamesPanel.tsx:75-111`, `generated-names-store.ts`.
- Steps: move baseline into the store (capture at generation), re-key on rename.
- Acceptance: Modified badge/Clear work after a rename.

**T5.3 — Generated-name edit doesn't eat extensions (B28).**
- Files: `GeneratedFilenamesPanel.tsx:199-205`.
- Steps: strip extension only on blur/commit, and only the exact current extension.
- Acceptance: typing `Episode.ts` keeps `.ts`.

**T5.4 — Surface per-file rename/retag errors (B26).**
- Files: `useQueueActions.ts:278-282`, queue store (per-item error field).
- Steps: store and render each failure with its reason.
- Acceptance: a 2-of-3 failure batch shows both reasons.

**T5.5 — Preserve item id across rename (B30).**
- Files: `local-upload-queue-store.ts:140-155`.
- Steps: change only `path` on rename; keep `id`.
- Acceptance: status updates after rename still target the item.

**T5.6 — Tool preflight + PATH fix (B32).**
- Files: `src-tauri/src/lib.rs` (setup), settings/about pane.
- Steps: detect ffprobe/ffmpeg/mkvpropedit at startup; augment PATH with common Homebrew
  dirs for Finder launches; add remediation hints to ffmpeg NotFound branch.
- Acceptance: launching the `.app` from Finder finds Homebrew tools; missing tools shown in UI.

---

## Wave 6 — Features (post-correctness)

| Task | Feature (audit §G) | Files | Notes |
|------|--------------------|-------|-------|
| T6.1 | Parsed-token preview panel | new panel, reuse tree | shows `ParsedMedia` + warnings before rename |
| T6.2 | Manual override fields (source/year/group/lang order) | preferences, panel | fallback layer (4) |
| T6.3 | Batch dry-run + duplicate-target report | useQueueActions | builds on T4.4 |
| T6.4 | Undo/rollback rename log | new store + Rust log | reverse a batch |
| T6.5 | Validation warnings surfaced in UI | engine returns `warnings[]` | empty audio, dropped track, dup name |
| T6.6 | Codec/language/channel mapping settings | preferences pane | exposes mappers |
| T6.7 | Title test-runner (paste filename → muxed+VOD) | dev panel | uses naming-engine directly |
| T6.8 | Export logs/report | logger | auditing |

---

## Execution notes

- **Dependency spine:** W0 → W1 (independent quick wins) → W2 (engine) → W3 (Rust data) →
  W4 (safety/metadata, gated) → W5 (UI) → W6 (features).
- W1 can ship immediately and independently of W2.
- W2 and W3 are parallelizable (TS engine vs Rust parsing) but W2's outputs improve once
  W3 lands (e.g. DTS-HD MA, untagged tracks); keep fixtures as the contract.
- After each wave: `pnpm run check:all` (typecheck, lint, format, clippy, tests).
- Regression guard for the "don't break metadata" rule: T2.6 must keep metadata-builder
  output byte-identical; only T4.1 may change it, behind D1.
