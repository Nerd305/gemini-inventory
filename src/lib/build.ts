/**
 * The git commit this bundle was built from (Dockerfile ARG GIT_SHA, passed by the deploy workflow and
 * baked in by vite's `define`). Empty in local dev. Lives apart from version.ts because
 * scripts/bump-version.js rewrites that file wholesale.
 */
export const GIT_SHA: string = (process.env.GIT_SHA || '').slice(0, 7);

/** Suffix for the version badge: " · a1b2c3d" when built by the deploy workflow, "" locally. */
export const BUILD_LABEL = GIT_SHA ? ` · ${GIT_SHA}` : '';
