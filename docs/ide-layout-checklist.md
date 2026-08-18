# RsKv IDE Layout Checklist

## Window + Base Surfaces

- [ ] App background uses `#1C1D20` (visible canvas around panels).
- [ ] Main content has 12–16px outer padding from window edges.

## Panel Containers

- [ ] Left panel (File Queue) container uses `#232529` or `#2A2D31`.
- [ ] Right panel (Workspace) container uses `#232529`.
- [ ] Both panels have 12px radius.
- [ ] Both panels have 12–16px inner padding.
- [ ] Gutter between panels is 12–16px (no hard divider).
- [ ] Optional 1px divider `#3B4046` at 40–60% opacity if needed.

## File Queue Panel

- [ ] Header row text: `FILE QUEUE` uppercase, muted `#737A84`.
- [ ] Header tools are icon-only; 16–18px icons with 28–32px hit area.
- [ ] Header tool default color `#A8AFB7`, hover `#E6E8EB`.
- [ ] Header tool focus ring `#3D7EFF` (1px).
- [ ] Row height 40–44px.
- [ ] Row icon ~16px, muted.
- [ ] Row filename uses primary text `#E6E8EB`.
- [ ] Remove “X” muted by default; brightens on row hover.
- [ ] Optional selection: subtle bg + optional 2px accent bar.

## Workspace Tab Bar

- [ ] Tabs are text-only, no pill backgrounds.
- [ ] Active tab uses `#E6E8EB` text + 2px underline `#3D7EFF`.
- [ ] Inactive tabs use `#737A84`; hover `#A8AFB7`.
- [ ] Tab bar height 40–44px.
- [ ] Tabs aligned with left padding 16–20px.
- [ ] Divider under tabs `#3B4046` at ~60% opacity.

## Control Band vs Results List

- [ ] Control band uses `#2A2D31` surface.
- [ ] Control band radius 10px, padding 12px.
- [ ] 12–16px space between control band and results list.
- [ ] Results list stays on workspace surface `#232529`.
- [ ] Rows use raised surface `#31353A` with subtle borders `#3B4046`.

## General Rules

- [ ] No gradients, glows, or heavy shadows.
- [ ] Rounded containers only for major panels.
- [ ] Inputs/rows use 6px radius.
- [ ] Accent color only for active tab, focus, selection.
