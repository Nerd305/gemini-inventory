#!/usr/bin/env node
/**
 * pm/emit-docs.mjs — turn a probe run into the documents the dashboard database expects,
 * keeping only what changed since the last check.
 *
 *   node pm/emit-docs.mjs --probe <probe.json> --out <dir> [--prev <dir>] [--run-id run-…]
 *                         [--source session|dashboard] [--ci <ci.json>]
 *
 * --prev   directory holding the CURRENT database documents, as saved by ArtifactData `list`
 *          with `out_dir` (layout: <prev>/<collection>/<doc_id>.json, bare document data).
 *          Without it every document is treated as new (first seed).
 * --out    where to write the documents that must be written, plus <out>/manifest.json:
 *            { runId, writes: [{ op:'set', collection, doc_id, file_path, exists }],
 *              deletes: [{ collection, doc_id }], unchanged: <n> }
 *          `exists` tells the caller whether the document is already in the database
 *          (so it must be `get` first to learn the version it has to pin with `if_version`).
 *          `project/meta` is always last, so the page's "running" chip flips only when
 *          everything else is in.
 * --ci     JSON { conclusion, status, url, createdAt, headSha } when gh was unavailable.
 *
 * Volatile timestamp fields are ignored when deciding whether a document changed, so an
 * unchanged repo produces almost no writes. Never commits, never touches tracked files.
 * Zero dependencies; Node 22.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const probePath = opt('--probe');
const outDir = opt('--out');
if (!probePath || !outDir) {
  console.error('usage: node pm/emit-docs.mjs --probe probe.json --out dir [--prev dir] [--run-id id] [--source src] [--ci ci.json]');
  process.exit(2);
}
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const prevDir = opt('--prev');
const now = new Date().toISOString();
const runId = (opt('--run-id') || 'run-' + now.replace(/[:.]/g, '-')).replace(/[^A-Za-z0-9_.~:@+-]/g, '');
const source = opt('--source') || 'session';
const ciOverride = opt('--ci') ? JSON.parse(fs.readFileSync(opt('--ci'), 'utf8')) : null;

const git = (a) => { try { return execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

// ---------------------------------------------------------------------------
// Previous state (what is in the database now)
// ---------------------------------------------------------------------------
function prevDoc(collection, id) {
  if (!prevDir) return null;
  try { return JSON.parse(fs.readFileSync(path.join(prevDir, collection, id + '.json'), 'utf8')); } catch { return null; }
}
function prevIds(collection) {
  if (!prevDir) return [];
  try { return fs.readdirSync(path.join(prevDir, collection)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; }
}

const VOLATILE = new Set(['checkedAt', 'snapshotAt', 'updatedAt', 'ranAt', 'finishedAt', 'startedAt']);
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => !VOLATILE.has(k)).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const writes = [];
const desired = { docs: new Set(), chapters: new Set(), milestones: new Set() };
let unchanged = 0;

function emit(collection, docId, data, { always = false } = {}) {
  if (desired[collection]) desired[collection].add(docId);
  const prev = prevDoc(collection, docId);
  if (prev && !always && stable(prev) === stable(data)) { unchanged += 1; return; }
  const dir = path.join(outDir, collection);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, docId + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
  writes.push({ op: 'set', collection, doc_id: docId, file_path: path.resolve(file), exists: !!prev });
}

// 1. docs snapshots (compared by sha, not by timestamp)
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
const prevStatus = new Map(prevIds('milestones').map((id) => [id, (prevDoc('milestones', id) || {}).status]));
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
const ci = ciOverride || (ciTile
  ? { conclusion: ciTile.value, detail: ciTile.detail, url: (probe.chapters.flatMap((c) => c.milestones).find((m) => m.id === ciTile.milestoneId)?.probes[0] || {}).url || null }
  : { conclusion: 'unknown' });
emit('activity', 'commits', { updatedAt: now, branch: probe.repo.branch, head: probe.repo.head, commits, ci });

// 5. checks/<runId> (always new)
const all = probe.chapters.flatMap((c) => c.milestones);
const failing = all.filter((m) => m.kind !== 'manual' && m.status !== 'done').map((m) => ({ milestoneId: m.id, title: m.title, detail: m.plainWhenFailing || m.probes.filter((p) => !p.ok).map((p) => (p.error ? `couldn't verify: ${p.error}` : p.detail)).join(' · ') }));
const errored = all.flatMap((m) => m.probes.filter((p) => p.error).map((p) => ({ milestoneId: m.id, probe: p.summary, error: p.error })));
emit('checks', runId, { runId, startedAt: probe.ranAt, finishedAt: now, by: 'pm-check', source, summary: probe.summary.milestones, tiles: probe.tiles, probesRun: probe.summary.probesRun, probesErrored: probe.summary.probesErrored, failing, errored, changed, repoHead: probe.repo.head }, { always: true });

// 6. project/meta — always last
let backlogOpen = null;
try { backlogOpen = (fs.readFileSync(path.join(repoRoot, 'TASKS.md'), 'utf8').match(/^\s*[-*]\s+\[ \]/gm) || []).length; } catch {}
let repoVersion = null;
try { repoVersion = readJson('package.json').version; } catch {}
const versionTile = probe.tiles?.version;
const liveVersion = versionTile && typeof versionTile.detail === 'string' ? (versionTile.detail.match(/live=([0-9A-Za-z.-]+)/) || [])[1] || null : null;
emit('project', 'meta', {
  ...probe.project,
  dashboard: { ...(probe.dashboard || {}) },
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
}, { always: true });

// ---------------------------------------------------------------------------
// Deletions: documents no longer in the plan, and old check runs beyond keepRuns
// ---------------------------------------------------------------------------
const deletes = [];
for (const [collection, ids] of Object.entries(desired)) {
  for (const id of prevIds(collection)) if (!ids.has(id)) deletes.push({ collection, doc_id: id });
}
const keepRuns = probe.checks?.keepRuns || 20;
const oldChecks = prevIds('checks')
  .filter((id) => id !== runId)
  .map((id) => ({ id, at: (prevDoc('checks', id) || {}).startedAt || '' }))
  .sort((a, b) => (a.at < b.at ? 1 : -1));
for (const c of oldChecks.slice(Math.max(0, keepRuns - 1))) deletes.push({ collection: 'checks', doc_id: c.id });

// project/meta last, whatever order the loop above produced
writes.sort((a, b) => (a.collection === 'project' ? 1 : 0) - (b.collection === 'project' ? 1 : 0));

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ runId, writes, deletes, unchanged }, null, 1));
const byCol = {};
for (const w of writes) byCol[w.collection] = (byCol[w.collection] || 0) + 1;
console.error(`runId ${runId}: ${writes.length} to write (${Object.entries(byCol).map(([k, v]) => k + ' ' + v).join(', ')}), ${unchanged} unchanged, ${deletes.length} to delete, ${changed.length} milestone(s) changed status → ${path.join(outDir, 'manifest.json')}`);
