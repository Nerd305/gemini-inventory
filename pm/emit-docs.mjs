#!/usr/bin/env node
/**
 * pm/emit-docs.mjs — turn a probe run into the documents the dashboard database expects.
 *
 *   node pm/emit-docs.mjs --probe <probe.json> --out <dir> [--run-id run-…] [--source session|dashboard]
 *                         [--versions <versions.json>] [--ci <ci.json>] [--previous <milestones.json>]
 *
 * Writes <dir>/<collection>/<doc_id>.json for docs/*, chapters/*, milestones/*, activity/commits,
 * checks/<runId> and project/meta, plus <dir>/manifest.json: the ordered list of
 * { op, collection, doc_id, file_path, if_version? } entries to hand to ArtifactData `batch`
 * (50 per call). The order matters: project/meta is last so the page flips only when all data is in.
 *
 * --versions: JSON { "<collection>/<doc_id>": <version> } of documents that already exist (from
 *             ArtifactData list); entries get if_version so stale writes are refused, never silent.
 * --ci:       JSON { conclusion, status, url, createdAt, headSha } when gh was unavailable to probe.mjs.
 * --previous: JSON array of the previous milestones docs (to compute checks.changed).
 * Never commits, never touches tracked files. Zero dependencies; Node 22.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const probePath = opt('--probe');
const outDir = opt('--out');
if (!probePath || !outDir) { console.error('usage: node pm/emit-docs.mjs --probe probe.json --out dir [--run-id id] [--source src] [--versions v.json] [--ci ci.json] [--previous prev.json]'); process.exit(2); }
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const repoRoot = path.resolve(path.dirname(path.resolve(probePath.endsWith('.json') && fs.existsSync(path.join(process.cwd(), 'pm/plan.json')) ? 'pm/plan.json' : probePath)), '..');
const now = new Date().toISOString();
const runId = (opt('--run-id') || 'run-' + now.replace(/[:.]/g, '-')).replace(/[^A-Za-z0-9_.~:@+-]/g, '');
const source = opt('--source') || 'session';
const versions = opt('--versions') ? JSON.parse(fs.readFileSync(opt('--versions'), 'utf8')) : {};
const ciOverride = opt('--ci') ? JSON.parse(fs.readFileSync(opt('--ci'), 'utf8')) : null;
const previous = opt('--previous') ? JSON.parse(fs.readFileSync(opt('--previous'), 'utf8')) : [];
const prevStatus = new Map(previous.map((m) => [m.id, m.status]));

const git = (a) => { try { return execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const manifest = [];
function emit(collection, docId, data) {
  const dir = path.join(outDir, collection);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, docId + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const entry = { op: 'set', collection, doc_id: docId, file_path: file };
  const v = versions[`${collection}/${docId}`];
  if (v) entry.if_version = v;
  manifest.push(entry);
}

// 1. docs snapshots
const MAX_MD = 200 * 1024;
for (const d of probe.project.docs || []) {
  const abs = path.join(repoRoot, d.path);
  if (!fs.existsSync(abs)) { emit('docs', d.key, { key: d.key, path: d.path, label: d.label, plain: d.plain, missing: true, snapshotAt: now }); continue; }
  let md = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(md);
  const truncated = md.length > MAX_MD;
  if (truncated) md = md.slice(0, MAX_MD) + '\n\n[shortened for the dashboard]';
  emit('docs', d.key, { key: d.key, path: d.path, label: d.label, plain: d.plain, markdown: md, bytes, sha: git(['hash-object', d.path]), missing: false, truncated, snapshotAt: now });
}

// 2. chapters, 3. milestones
const changed = [];
for (const c of probe.chapters) {
  emit('chapters', c.id, { id: c.id, order: c.order, title: c.title, plain: c.plain, status: c.status, percent: c.percent, counts: c.counts, milestoneIds: c.milestoneIds });
  for (const m of c.milestones) {
    const { tick, ...rest } = m;
    emit('milestones', m.id, rest);
    if (prevStatus.size && prevStatus.get(m.id) !== m.status) changed.push(m.title);
  }
}

// 4. activity/commits
const count = probe.checks?.commitCount || 30;
const log = git(['log', '-n', String(count), '--format=%H|%ad|%s', '--date=short']);
const commits = log ? log.split('\n').filter(Boolean).map((l) => { const [sha, date, ...s] = l.split('|'); return { sha, date, subject: s.join('|') }; }) : [];
const ciTile = probe.tiles?.ci;
const ci = ciOverride || (ciTile ? { conclusion: ciTile.value, detail: ciTile.detail, url: (probe.chapters.flatMap((c) => c.milestones).find((m) => m.id === ciTile.milestoneId)?.probes[0] || {}).url || null } : { conclusion: 'unknown' });
emit('activity', 'commits', { updatedAt: now, branch: probe.repo.branch, head: probe.repo.head, commits, ci });

// 5. checks/<runId>
const all = probe.chapters.flatMap((c) => c.milestones);
const failing = all.filter((m) => m.kind !== 'manual' && m.status !== 'done').map((m) => ({ milestoneId: m.id, title: m.title, detail: m.plainWhenFailing || m.probes.filter((p) => !p.ok).map((p) => p.error ? `couldn't verify: ${p.error}` : p.detail).join(' · ') }));
const errored = all.flatMap((m) => m.probes.filter((p) => p.error).map((p) => ({ milestoneId: m.id, probe: p.summary, error: p.error })));
emit('checks', runId, { runId, startedAt: probe.ranAt, finishedAt: now, by: 'pm-check', source, summary: probe.summary.milestones, tiles: probe.tiles, probesRun: probe.summary.probesRun, probesErrored: probe.summary.probesErrored, failing, errored, changed, repoHead: probe.repo.head });

// 6. project/meta (last)
let backlogOpen = null;
try { backlogOpen = (fs.readFileSync(path.join(repoRoot, 'TASKS.md'), 'utf8').match(/^\s*[-*]\s+\[ \]/gm) || []).length; } catch {}
let repoVersion = null;
try { repoVersion = readJson('package.json').version; } catch {}
const versionTile = probe.tiles?.version;
const liveVersion = versionTile && typeof versionTile.detail === 'string' ? (versionTile.detail.match(/live=([0-9A-Za-z.\-]+)/) || [])[1] || null : null;
const dashboard = { ...(probe.dashboard || {}) };
emit('project', 'meta', {
  ...probe.project,
  dashboard,
  kitVersion: 1,
  lastCheckedAt: now,
  lastCheckRunId: runId,
  lastCheckBy: 'pm-check',
  lastCheckSource: source,
  repoHead: probe.repo.head,
  repoBranch: probe.repo.branch,
  repoVersion,
  liveVersion,
  dirty: !!probe.repo.dirty,
  tiles: probe.tiles,
  ci,
  backlogOpen,
  summary: probe.summary.milestones,
});

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
const sizes = manifest.map((e) => fs.statSync(e.file_path).size);
console.error(`emitted ${manifest.length} documents (${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)} KB, largest ${Math.round(Math.max(...sizes) / 1024)} KB) → ${outDir}/manifest.json; runId ${runId}; changed ${changed.length}`);
