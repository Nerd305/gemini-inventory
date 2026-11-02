# Project-manager dashboard kit (`pm/`)

A small, repo-portable kit that gives a project owner one page with the plan as chapters and
milestones, engineering status, the repo's own documents in plain language, and a **Quick check**
button that re-audits the repository. The page is a claude.ai Artifact; its data lives in the
artifact's database; a Claude Code skill (`/pm-check`) fills it.

## Files

| File | What it is |
| --- | --- |
| `pm/plan.json` | The only file you edit per project: project facts, chapters, milestones, probes. No secrets. |
| `pm/probe.mjs` | Deterministic probe runner (Node 22, no dependencies). Owns the status rules. |
| `pm/dashboard.html` | The page template. Generic: everything it shows comes from the artifact database. |
| `.claude/skills/pm-check/SKILL.md` | The `/pm-check` procedure Claude follows (locally or in a cloud session fired by the button). |
| `pm/README.md` | This guide. |

## Probe types (`pm/plan.json` → milestone → `probes[]`)

| Type | Fields | Passes when |
| --- | --- | --- |
| `file-exists` | `path` | the file exists |
| `file-absent` | `path` | the file is gone |
| `grep` | `path` (file or folder), `pattern`, `flags?`, `min?` (1), `include?` (extensions) | matches ≥ `min` |
| `grep-count` | as `grep` + `op`, `value` | `count op value` (`==`, `!=`, `>`, `>=`, `<`, `<=`) |
| `grep-capture` | `path`, `pattern`, `group?`, `label?` | the capture group matched (value = capture) |
| `json-field` | `path`, `field` (dot path), `equals?` / `pattern?` / `op`+`value`? | the check passes (or the field is non-empty) |
| `same-value` | `sources[]` (any probes with a `label`) | every source has the same value |
| `http-json` | `url`, `field?`, `equals?` / `pattern?` / `op`+`value`?, `headers?`, `timeoutMs?` | 2xx and the check passes |
| `git-tag` | `pattern` | a tag matches |
| `gh-run` | `workflow`, `branch?`, `expectConclusion?` | the latest run's conclusion matches (needs `gh`) |
| `md-checkbox` | `path`, `match` (text), `checked` (true/false) | the first checkbox containing `match` is in that state |
| `md-checkbox-count` | `path`, `state` (`checked`/`unchecked`), `section?` (a `## heading`), `op`, `value` | `count op value` |

Template tokens inside string fields: `{live.url}`, `{live.healthPath}`, `{repo.url}`,
`{repo.branch}` (anything under `project`), and `${ENV:NAME}` (read from the environment; the probe
reports "couldn't verify" when unset). The runner refuses to read `.env*`, `*service-account*` and
`firebase-applet-config.json`. There is deliberately no "run any command" probe: `plan.json` is
committed and must never be a way to run code in the checking session.

## Milestone fields

`id`, `title`, `plain` (≤ 20 words, verbs first, no file paths), `kind` (`probe` | `manual`),
`probes[]`, `allowTick?` (a probe-backed milestone the owner may also tick), `blockedBy?` (ids),
`tile?` (`live` | `version` | `ci`, shown as a health tile), `links?` `[{label,url}]`,
`doneInVersion?`, `plainWhenFailing?` (what a person should do when the check fails), `verify?`
(for manual: what a person does to check).

## Status rules (in words)

- **Done** — every probe passed, or a person marked it done (manual / `allowTick`).
- **In progress** — some probes passed.
- **Not started** — no probe passed.
- **Waiting on…** — a `blockedBy` milestone is not done.
- **Needs a person** — `kind: manual` and nobody has marked it done yet.
- **Couldn't verify** — a probe errored (network off, file unreadable). Shown as a dashed pill.

Probe-backed milestones are read-only on the page. Manual (and `allowTick`) milestones have a
"Mark done" button; the tick records the viewer's id, the time and a "where" chip
(iPhone / Android / iMac / Desktop / Other). Ticks are the only thing the page writes.

## The page

Tabs: **Overview** (goal, health tiles, chapter progress, what's next) · **Plan** (chapters →
milestones) · **Engineering** (versions, build check, commits, check history) · **Docs** (one
button per document, rendered from the latest snapshot; relative links go to GitHub at the
snapshot's commit) · **Ask** (a question box answered from the docs and the status, on the
viewer's own Claude account).

**Quick check** (owner only): the button calls the viewer's *Claude Code Remote* connector →
`fire_trigger` on a scheduled task → a fresh cloud session runs `/pm-check` → the page flips to
"Updated" when `project/meta.lastCheckRunId` equals the run id the button sent.

Publish capabilities (pass exactly this when publishing the page):

```json
{
  "db": { "rules": [ { "path": "", "read": "view", "write": "admin" }, { "path": "ticks", "read": "view", "write": "interact" } ] },
  "user": { "scopes": ["profile"] },
  "mcp": { "servers": [ { "server": "Claude Code Remote", "tools": ["fire_trigger", "get_trigger"] } ] },
  "sample": {}
}
```

Database collections: `project/meta` (one doc), `chapters/{id}`, `milestones/{id}`, `docs/{key}`,
`activity/commits`, `checks/{runId}` (newest 20 kept), `ticks/{milestoneId}` (page-written only).

## Bootstrap for a new repo (the reuse checklist)

1. Copy `pm/` and `.claude/skills/pm-check/` into the repo.
2. Edit `pm/plan.json`: `project.{id, name, oneLiner, goal, repo, live, deploy, docs}`; replace the
   chapters (keep "Foundation & deploy" as a template); blank `dashboard.artifactUrl` and
   `dashboard.triggerId`; set `dashboard.environmentId` to that repo's cloud environment id.
3. Run `node pm/probe.mjs --pretty` until every probe runs (errors are plan bugs; failures are facts).
4. In a Claude session: copy `pm/dashboard.html` to a scratch file with `{{PROJECT_NAME}}` replaced
   by the project name, and publish it with the Artifact tool using the capabilities above, a short
   `description`, `icon: "checklist"`, and **private sharing** (the URL is committed; the repo may be
   public). Paste the URL into `plan.json` → `dashboard.artifactUrl`.
5. Run `/pm-check` once to seed the database. Open the page: chapters and tiles should appear.
6. Create the poke-only scheduled task (no cron, fresh session per fire) with the prompt template
   below; paste its id into `plan.json` → `dashboard.triggerId` and update `project/meta.dashboard`.
7. Add the rule "after shipping, run /pm-check" to CLAUDE.md (and GEMINI.md if Gemini tools are used).
8. Bump the version per that repo's rule, commit, push. Then fire the task once and click the
   button once; fix whatever that exposes.

Trigger prompt template (replace the angle-bracket values):

```
You are running the project-manager quick check for <PROJECT NAME>.
Repository: <REPO URL>, branch <BRANCH>. If the repository is not checked out in this session, use
the Claude Code Remote add_repo tool (owner <OWNER>, repo <REPO>), clone it as instructed, call
register_repo_root, then `git checkout <BRANCH>`. Then read .claude/skills/pm-check/SKILL.md and
follow it exactly. Dashboard artifact URL: <ARTIFACT URL> (also in pm/plan.json): read it with the
Artifact tool first, then write with ArtifactData. If the message that fired you contains
`runId=<id>`, use that id for checks/<id> and record source=dashboard. Hard rules: do not commit,
push, tag, deploy, install packages, or edit tracked files; do not print environment variable
values. Finish with a 5-line plain-language summary.
```

Optional: give the same task a weekday cron (jittered minute) so the data is never more than a day
old even if nobody presses the button.

## Copy rules

Every `plain` sentence is for a non-engineer: ≤ 20 words, verbs first, no file paths, no
acronyms without the expansion. A failing-state sentence says what a person should do next.

## What the quick check must never do

Commit, push, tag, deploy, install packages, edit tracked files, write the app's own database,
or print environment values. It only reads the repo and writes the dashboard database.
