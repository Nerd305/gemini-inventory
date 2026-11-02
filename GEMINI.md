# GEMINI.md — rules for Gemini-based assistants (AI Studio, Antigravity, Gemini CLI)

Read [CLAUDE.md](CLAUDE.md) first. It is the architecture and rules document for every AI
assistant working in this repository; this file only adds what is specific to Gemini tooling.

## Deploys

- **The app deploys from GitHub Actions** (`.github/workflows/deploy.yml`): a merge to `main`
  builds the image and deploys Cloud Run service `blu35inventory` (us-west1). **Never press
  "Deploy" in Google AI Studio.** It would overwrite the service with AI Studio's own wrapper and
  whatever stale copy of the code its workspace holds. If that happens anyway,
  `GET /api/v1/health` shows `"commit": null`; the fix is to run the Deploy workflow again from
  GitHub → Actions.
- The Gemini API key is **server-side only** (Secret Manager → `server.js` proxy at
  `/api/ai/gemini`). Never put a real key in the repo, in `vite.config.ts` `define`, or in any file
  that ends up in the browser bundle. Locally the key lives in `.env.local` (git-ignored).
- Never add a service worker or `vite-plugin-pwa` unless the task explicitly asks for one; the
  server already serves a kill-switch worker at `/_service-worker.js` to remove the old AI Studio
  worker from phones.

## Working in this repo

- Keep the `DISABLE_HMR` logic in `vite.config.ts` as it is (see the comment there).
- Run `node scripts/bump-version.js` for every shipped change (CLAUDE.md "Versioning").
- Do not delete or rewrite `pm/`, `.claude/`, `package-lock.json` or `desktop/package-lock.json`.
  `pm/` is the project-manager dashboard kit; `.claude/` holds the `/pm-check` skill; the lockfiles
  are what CI and the Docker build install from.
- After shipping, run `/pm-check` (Claude) or ask the owner to press "Quick check" on the
  dashboard so the milestones stay current. If a milestone's definition changed, edit
  `pm/plan.json`.
- `metadata.json` is only an AI Studio manifest (name, description, camera permission). It no
  longer drives a server-side Gemini proxy.
