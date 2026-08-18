# RsKv Desktop Layout Plan

## Theme Palette (Resolve-style Neutral)

**Backgrounds & Surfaces**

- App Background: `#1C1D20`
- Primary Panels (Workspace): `#232529`
- Secondary Panels (Inspectors/Sidebars): `#2A2D31`
- Raised Surfaces (Rows/Inputs): `#31353A`
- Dividers: `#3B4046`

**Text**

- Primary Text: `#E6E8EB`
- Secondary Text: `#A8AFB7`
- Muted Text: `#737A84`
- Disabled: `#5A616B`

**Accent & Status**

- Primary Accent: `#3D7EFF`
- Success/OK: `#4BAA66`
- Warning: `#D7A646`
- Error: `#D55C5C`
- Edited/Modified: `#3D7EFF`

**Layer Brightness Steps**

- Background: 0
- Panel: +4%
- Subpanel: +6%
- Row hover: +8%
- Selected row: Accent tint

---

## Layout Model (Updated)

### Window Shell

- Single top bar with app name, queue status, action buttons, settings.
- No stacked headers below the title bar.

### Split Layout

- Left panel = File Queue only (navigation).
- Right panel = Workspace (results/inspectors).
- Fixed left width: 280–320px.
- Clear vertical divider between panels.
- Left panel contains only file list + add actions. No tags/settings.

---

## Left Panel — File Queue (Navigation Only)

**Purpose**

- Persistent project-style navigation for all imported files.

**Visuals**

- Background: Secondary Panel color.
- Rows feel selectable and dense.
- Light hover state.
- No edit/status indicators in the queue.

**Row Content**

- Icon (video/media).
- Primary: filename only.
- No metadata line in queue.

**Actions**

- Top bar inside queue: “Add Files” + “Add Folder”.

---

## Right Panel — Workspace (Contextual Controls)

**Structure**

- Vertical stack, not columns.
- Two tabs at the top: Filenames | Track Titles.
- Tabs are flat, text-only, with subtle active underline.
- Controls live inside their respective tabs (no global controls).

### Tab: Filenames

- Section header: “Generated Filenames”.
- Controls: filename tag, encoder name, print type.
- List of files with editable filename inputs.
- Edited state indicated with subtle accent.

### Tab: Track Titles

- Section header: “Track Title Results”.
- Controls: track title tag.
- Collapsible groups:
  - Video Titles
  - Audio Titles
  - Subtitle Titles

**Grouping Rules**

- If a title is used by 2+ files:
  - Show grouped result with “Used by X files”.
  - Expand/collapse to show per-file overrides.
  - Provide “Edit All”.
- If used by 1 file:
  - Show file name directly under title.
  - No “Used by” line.
  - No chevron or grouping chrome.

---

## Visual Hierarchy & Density

- Section headers: medium weight, slightly larger padding.
- Row titles: regular weight, primary text.
- Metadata: smaller, muted.
- Labels: uppercase, small, muted.
- Dividers: 1px in `#3B4046`.
- Inputs: raised surface with subtle border.
- Section headers in the workspace should sit on Secondary Panel color.
- Prefer divider-based structure over card containers. Avoid large vertical gaps between rows.

---

## Interaction States

- Hover: slight panel lighten (+8%).
- Active tab: accent underline.
- Focus: thin accent outline.
- Edited: accent dot or subtle highlight.
- Selected state overrides hover state.
- Edited indicator must remain visible even when row is selected.

---

## Panel Containment Rule

All major areas (File Queue, Workspace, Sections) must feel containerized through surface contrast and divider boundaries. Avoid floating sections.

---

## Interaction Philosophy

Prefer inline editing and inspector-style adjustments over modal dialogs whenever possible.

---

## Context Separation (New)

| Area             | Purpose                                |
| ---------------- | -------------------------------------- |
| Left panel       | File navigation                        |
| Filenames tab    | Filename controls + edits              |
| Track titles tab | Stream title controls + edits          |
| Preferences      | System configuration (tags, templates) |

---

## Phased Implementation (Refactor Plan)

### Phase 1 — Move Controls to Contextual Tabs

1. Remove tags/settings from left panel.
2. Add “Add Files” + “Add Folder” actions at top of queue.
3. Place filename controls inside Filenames tab.
4. Place track title controls inside Track Titles tab.

### Phase 2 — Simplify File Queue

1. Queue rows show icon + filename only.
2. Remove metadata line and edited/status dots.
3. Add selection highlight (accent tint) and hover brighten.

### Phase 3 — Workspace Tabs

1. Filenames tab: controls + editable filename list.
2. Track Titles tab: controls + grouped results.
3. Ensure tab switching does not reset state.

### Phase 4 — Preferences & Tag Management

1. Tag creation/editing lives only in Preferences.
2. Workspace tabs only select existing tags.

### Phase 5 — Density & Polish

1. Divider-based layout, minimal card borders.
2. Tight spacing, inspector-style headers.
3. Consistent focus/hover/active using accent.
