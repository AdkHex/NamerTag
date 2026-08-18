# NamerTag

NamerTag is a desktop app for renaming and editing video file metadata using ffmpeg.

Requirements

- Node.js 18+
- Rust (stable)
- ffmpeg
- Tauri system prerequisites for your OS

Run in development

1. Install dependencies:
   `pnpm install`

2. Start the dev app:
   `pnpm run tauri:dev`

Build installers

1. Build the frontend:
   `pnpm run build`

2. Build the Tauri app (installers/artifacts):
   `pnpm run tauri:build`

Auto-updates (GitHub Releases)

See `docs/UPDATER_GITHUB_RELEASES.md`.

License

MIT. See `LICENSE.md`.
