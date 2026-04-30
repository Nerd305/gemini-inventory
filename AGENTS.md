# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This repo contains two apps sharing a Firestore database and `src/shared/` code:

- **Web app** (root `/`): React 19 + Vite + Tailwind 4 SPA (MedInventory/VialTrack) with an Express webhook backend (`server.js`).
- **Desktop app** (`desktop/`): Electron macOS print server. **Cannot run on Linux**—it requires macOS CUPS and Electron GUI. Only lint/type-check is viable in Cloud Agent VMs.

### Commands

See `CLAUDE.md` for the full command reference. Key commands:

| Task | Web app (root) | Desktop (`desktop/`) |
|------|---------------|---------------------|
| Install deps | `npm install` | `cd desktop && npm install` |
| Lint / type-check | `npm run lint` | `npm run lint` |
| Dev server | `npm run dev` (port 3000) | N/A on Linux |
| Build | `npm run build` | `npm run build` |
| Production server | `npm run start` (port 8080) | N/A on Linux |

### Non-obvious caveats

- **`GEMINI_API_KEY` is required for the app to render.** Without it, the `@google/genai` constructor in `src/lib/ai.ts` throws at import time, crashing the entire app. For dev without a real key, create `.env.local` at root with `GEMINI_API_KEY=dummy-key-for-dev`. AI features won't work, but the rest of the app will render (login screen, etc.).
- **No test suite exists.** `npm run lint` (TypeScript type-check via `tsc --noEmit`) is the only automated check for both apps.
- **No Firebase Emulator is configured.** Both apps connect directly to the production Firestore database (`ai-studio-198437a8-7e10-4c8b-9a00-22acac4c2d1f`). Firebase Auth (Google sign-in) is required to get past the login screen.
- **`vite.config.ts` HMR control:** The `DISABLE_HMR` env var disables HMR for AI Studio. Do not modify this logic.
- **Version bumping:** Run `node scripts/bump-version.js` after implementing features or fixes to keep the UI version current.
- **Shared code** lives in `src/shared/` — imports from `src/components`, `src/pages`, etc. will break the desktop build.
