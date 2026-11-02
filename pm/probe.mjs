#!/usr/bin/env node
/**
 * pm/probe.mjs — deterministic probe runner for the project-manager dashboard kit.
 *
 * Reads pm/plan.json (chapters → milestones → probes), runs every probe against the repo
 * (and, unless --no-network, the live app / GitHub), derives a status per milestone and
 * chapter, and prints one JSON document to stdout. Zero dependencies; Node 22.
 *
 *   node pm/probe.mjs [--plan pm/plan.json] [--ticks ticks.json] [--no-network] [--pretty]
 *
 * Exit code: 0 whenever the run completed (failing probes are data, not errors);
 * 2 only when the plan file is missing or invalid.
 *
 * This file is the single source of truth for the status rules. The dashboard page only
 * displays statuses and overlays live ticks; the /pm-check skill only writes what this
 * script produced. Keep it boring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);

const planPath = path.resolve(opt('--plan', 'pm/plan.json'));
const ticksPath = opt('--ticks');
const network = !flag('--no-network');
const pretty = flag('--pretty');

let plan;
try {
  plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
} catch (e) {
  console.error(`probe: cannot read plan ${planPath}: ${e.message}`);
  process.exit(2);
}
if (!plan || !Array.isArray(plan.chapters) || !plan.project) {
  console.error('probe: plan.json needs { project, chapters: [] }');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(planPath), '..');
let ticks = {};
if (ticksPath) {
  try {
    ticks = JSON.parse(fs.readFileSync(path.resolve(ticksPath), 'utf8')) || {};
  } catch (e) {
    console.error(`probe: ticks file ignored (${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DENY_PATH = /(^|\/)(\.env[^/]*|.*service-account.*|firebase-applet-config\.json)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'dist-packaged']);

function lookup(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

/** `{live.url}` → plan.project.live.url; `${ENV:NAME}` → process.env.NAME (throws when unset). */
function tpl(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, name) => {
      if (!process.env[name]) throw new Error(`env ${name} not set`);
      return process.env[name];
    })
    .replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, key) => {
      const v = lookup(plan.project, key);
      return v === undefined ? m : String(v);
    });
}

function safeRepoPath(p) {
  if (typeof p !== 'string' || !p) throw new Error('path missing');
  if (DENY_PATH.test(p)) throw new Error(`refusing to read ${p}`);
  const abs = path.resolve(repoRoot, p);
  if (!abs.startsWith(repoRoot + path.sep) && abs !== repoRoot) throw new Error(`path escapes repo: ${p}`);
  return abs;
}

function readText(p) {
  return fs.readFileSync(safeRepoPath(p), 'utf8');
}

function* walk(dir, include) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name), include);
    } else if (!include || include.some((ext) => entry.name.endsWith(ext))) {
      const rel = path.relative(repoRoot, path.join(dir, entry.name));
      if (!DENY_PATH.test(rel)) yield path.join(dir, entry.name);
    }
  }
}

function countMatches(p, pattern, flags = '', include) {
  const abs = safeRepoPath(p);
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const files = fs.statSync(abs).isDirectory() ? [...walk(abs, include)] : [abs];
  let count = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    count += (text.match(re) || []).length;
  }
  return count;
}

function compare(a, op, b) {
  switch (op) {
    case '==': return a == b; // eslint-disable-line eqeqeq
    case '!=': return a != b; // eslint-disable-line eqeqeq
    case '>': return Number(a) > Number(b);
    case '>=': return Number(a) >= Number(b);
    case '<': return Number(a) < Number(b);
    case '<=': return Number(a) <= Number(b);
    default: throw new Error(`unknown op ${op}`);
  }
}

/** Shared value check used by json-field and http-json. */
function checkValue(value, p) {
  if (p.equals !== undefined) return value === p.equals;
  if (p.pattern) return new RegExp(p.pattern).test(String(value ?? ''));
  if (p.op) return compare(value, p.op, p.value);
  return value !== undefined && value !== null && value !== '';
}

function git(argsList) {
  return execFileSync('git', argsList, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function checkboxLines(p) {
  return readText(p)
    .split('\n')
    .map((line) => {
      const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
      return m ? { checked: m[1] !== ' ', text: m[2] } : null;
    });
}

const trunc = (s, n = 2000) => (s && s.length > n ? s.slice(0, n) + '…' : s);

// ---------------------------------------------------------------------------
// Probe implementations. Each returns { ok, value?, detail }.
// ---------------------------------------------------------------------------
const PROBES = {
  'file-exists': (p) => {
    const abs = safeRepoPath(p.path);
    const ok = fs.existsSync(abs);
    return { ok, value: ok, detail: `${p.path} ${ok ? 'exists' : 'is missing'}` };
  },
  'file-absent': (p) => {
    const abs = safeRepoPath(p.path);
    const ok = !fs.existsSync(abs);
    return { ok, value: ok, detail: `${p.path} ${ok ? 'is gone' : 'still exists'}` };
  },
  grep: (p) => {
    const count = countMatches(p.path, p.pattern, p.flags, p.include);
    const min = p.min ?? 1;
    return { ok: count >= min, value: count, detail: `${count} match${count === 1 ? '' : 'es'} for /${p.pattern}/ in ${p.path}` };
  },
  'grep-count': (p) => {
    const count = countMatches(p.path, p.pattern, p.flags, p.include);
    return { ok: compare(count, p.op, p.value), value: count, detail: `${count} match${count === 1 ? '' : 'es'} for /${p.pattern}/ in ${p.path} (want ${p.op} ${p.value})` };
  },
  'grep-capture': (p) => {
    const m = new RegExp(p.pattern, p.flags || '').exec(readText(p.path));
    const value = m ? m[p.group ?? 1] : undefined;
    return { ok: value !== undefined, value, detail: value !== undefined ? `${p.label || p.path} = ${value}` : `no match for /${p.pattern}/ in ${p.path}` };
  },
  'json-field': (p) => {
    const value = lookup(JSON.parse(readText(p.path)), p.field);
    return { ok: checkValue(value, p), value, detail: `${p.label || p.path}:${p.field} = ${JSON.stringify(value)}` };
  },
  'same-value': async (p) => {
    const parts = [];
    for (const s of p.sources || []) {
      const r = await runProbe(s);
      parts.push({ label: s.label || s.type, ok: r.ok, value: r.value, error: r.error });
    }
    const errored = parts.filter((x) => x.error);
    if (errored.length) throw new Error(errored.map((x) => `${x.label}: ${x.error}`).join('; '));
    const values = parts.map((x) => String(x.value));
    const ok = parts.every((x) => x.ok) && values.every((v) => v === values[0]);
    return { ok, value: values[0], detail: parts.map((x) => `${x.label}=${x.value}`).join(', ') };
  },
  'http-json': async (p) => {
    if (!network) throw new Error('skipped: network off');
    const url = tpl(p.url);
    const headers = {};
    for (const [k, v] of Object.entries(p.headers || {})) headers[k] = tpl(v);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(p.timeoutMs ?? 15000) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const value = p.field ? lookup(body, p.field) : body;
    const ok = res.ok && checkValue(value, p);
    const shown = p.field ? JSON.stringify(value) : trunc(typeof body === 'string' ? body : JSON.stringify(body), 200);
    return { ok, value, detail: `${res.status} ${new URL(url).pathname}${p.field ? ' → ' + p.field + ' = ' + shown : ''}` };
  },
  'git-tag': (p) => {
    const tags = git(['tag', '-l']).split('\n').filter(Boolean);
    const hits = tags.filter((t) => new RegExp(p.pattern).test(t));
    return { ok: hits.length > 0, value: hits.length, detail: hits.length ? `${hits.length} tag(s): ${hits.slice(-3).join(', ')}` : 'no matching git tags' };
  },
  'gh-run': (p) => {
    if (!network) throw new Error('skipped: network off');
    const out = execFileSync(
      'gh',
      ['run', 'list', '--workflow', p.workflow, '-b', p.branch || 'main', '-L', '1', '--json', 'conclusion,status,url,headSha,createdAt'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: p.timeoutMs ?? 30000 },
    );
    const runs = JSON.parse(out || '[]');
    if (!runs.length) return { ok: false, value: 'none', detail: `no runs of ${p.workflow} on ${p.branch || 'main'}` };
    const run = runs[0];
    const expect = p.expectConclusion || 'success';
    return { ok: run.conclusion === expect, value: run.conclusion || run.status, detail: `${p.workflow} on ${p.branch || 'main'}: ${run.conclusion || run.status} (${run.headSha?.slice(0, 7)})`, url: run.url };
  },
  'md-checkbox': (p) => {
    const line = checkboxLines(p.path).find((l) => l && (p.match instanceof RegExp ? p.match.test(l.text) : l.text.includes(p.match)));
    if (!line) return { ok: false, value: 'missing', detail: `no checkbox containing "${p.match}" in ${p.path}` };
    const state = line.checked ? 'checked' : 'unchecked';
    const want = p.checked === false ? 'unchecked' : 'checked';
    return { ok: state === want, value: state, detail: `"${trunc(line.text, 60)}" is ${state}` };
  },
  'md-checkbox-count': (p) => {
    const text = readText(p.path);
    let scope = text;
    if (p.section) {
      const start = text.indexOf(p.section);
      if (start < 0) throw new Error(`section "${p.section}" not found in ${p.path}`);
      const rest = text.slice(start + p.section.length);
      const next = rest.search(/\n## /);
      scope = next >= 0 ? rest.slice(0, next) : rest;
    }
    const lines = scope.split('\n').map((l) => /^\s*[-*]\s+\[( |x|X)\]/.exec(l)).filter(Boolean);
    const count = lines.filter((m) => (p.state === 'checked' ? m[1] !== ' ' : m[1] === ' ')).length;
    return { ok: p.op ? compare(count, p.op, p.value) : true, value: count, detail: `${count} ${p.state} item(s)${p.section ? ' under ' + p.section : ''} in ${p.path}` };
  },
};

async function runProbe(p) {
  const base = { type: p.type, summary: p.summary || describe(p) };
  try {
    const impl = PROBES[p.type];
    if (!impl) throw new Error(`unknown probe type ${p.type}`);
    const r = await impl(p);
    return { ...base, ok: !!r.ok, value: r.value, detail: r.detail, url: r.url };
  } catch (e) {
    return { ...base, ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function describe(p) {
  switch (p.type) {
    case 'file-exists': return `file exists: ${p.path}`;
    case 'file-absent': return `file gone: ${p.path}`;
    case 'grep': return `${p.path} contains /${p.pattern}/`;
    case 'grep-count': return `/${p.pattern}/ in ${p.path} ${p.op} ${p.value}`;
    case 'grep-capture': return `read ${p.label || p.path}`;
    case 'json-field': return `${p.path} → ${p.field}`;
    case 'same-value': return `same value: ${(p.sources || []).map((s) => s.label || s.type).join(' = ')}`;
    case 'http-json': return `GET ${p.url}${p.field ? ' → ' + p.field : ''}`;
    case 'git-tag': return `git tag matching /${p.pattern}/`;
    case 'gh-run': return `latest ${p.workflow} run on ${p.branch || 'main'}`;
    case 'md-checkbox': return `${p.path}: "${p.match}" ${p.checked === false ? 'unchecked' : 'checked'}`;
    case 'md-checkbox-count': return `${p.state} boxes in ${p.path}${p.section ? ' ' + p.section : ''}`;
    default: return p.type;
  }
}

// ---------------------------------------------------------------------------
// Status derivation (the rules the dashboard displays)
// ---------------------------------------------------------------------------
function tickFor(id) {
  const t = ticks[id];
  if (!t || typeof t !== 'object') return null;
  return { done: !!t.done, by: typeof t.by === 'string' ? t.by : '', at: typeof t.at === 'string' ? t.at : '', where: typeof t.where === 'string' ? t.where : '' };
}

function deriveMilestone(m, results) {
  const tick = tickFor(m.id);
  if (m.kind === 'manual') {
    return { status: tick?.done ? 'done' : 'manual', uncertain: false, tick };
  }
  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.filter((r) => r.error).length;
  let status = results.length && okCount === results.length ? 'done' : okCount > 0 ? 'in_progress' : 'todo';
  if (m.allowTick && tick?.done) status = 'done';
  const uncertain = status !== 'done' && errCount > 0;
  return { status, uncertain, tick };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const ranAt = new Date().toISOString();
const out = {
  kit: 1,
  ranAt,
  planPath: path.relative(repoRoot, planPath),
  repo: {},
  project: plan.project,
  dashboard: plan.dashboard || {},
  checks: plan.checks || {},
  chapters: [],
  summary: { milestones: { done: 0, in_progress: 0, todo: 0, blocked: 0, manual: 0, total: 0, uncertain: 0 }, probesRun: 0, probesErrored: 0 },
  tiles: {},
};

try {
  out.repo = {
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']).split('\n').filter(Boolean).length > 0,
  };
} catch (e) {
  out.repo = { error: String(e.message) };
}

const byId = new Map();
let order = 0;
for (const chapter of plan.chapters) {
  const milestones = [];
  for (const m of chapter.milestones || []) {
    const results = [];
    for (const p of m.probes || []) {
      const r = await runProbe(p);
      results.push(r);
      out.summary.probesRun += 1;
      if (r.error) out.summary.probesErrored += 1;
    }
    const derived = deriveMilestone(m, results);
    const row = {
      id: m.id,
      chapterId: chapter.id,
      order: ++order,
      title: m.title,
      plain: m.plain || '',
      kind: m.kind || 'probe',
      allowTick: !!m.allowTick,
      blockedBy: m.blockedBy || [],
      links: m.links || [],
      tile: m.tile || null,
      doneInVersion: m.doneInVersion || null,
      plainWhenFailing: m.plainWhenFailing || '',
      verify: m.verify || '',
      status: derived.status,
      underlying: null,
      uncertain: derived.uncertain,
      tick: derived.tick,
      probes: results,
      checkedAt: ranAt,
    };
    byId.set(m.id, row);
    milestones.push(row);
  }
  out.chapters.push({ id: chapter.id, order: chapter.order ?? out.chapters.length + 1, title: chapter.title, plain: chapter.plain || '', milestones });
}

// Second pass: blockedBy
for (const row of byId.values()) {
  if (row.status === 'done') continue;
  const blockers = row.blockedBy.filter((id) => byId.get(id) && byId.get(id).status !== 'done');
  if (blockers.length) {
    row.underlying = row.status;
    row.status = 'blocked';
    row.blockedByTitles = blockers.map((id) => byId.get(id).title);
  }
}

// Chapter roll-ups + summary + tiles
for (const chapter of out.chapters) {
  const counts = { done: 0, in_progress: 0, todo: 0, blocked: 0, manual: 0, total: 0 };
  for (const row of chapter.milestones) {
    counts[row.status] = (counts[row.status] || 0) + 1;
    counts.total += 1;
    out.summary.milestones[row.status] += 1;
    out.summary.milestones.total += 1;
    if (row.uncertain) out.summary.milestones.uncertain += 1;
    if (row.tile) {
      const first = row.probes[0] || {};
      out.tiles[row.tile] = { status: row.status, detail: first.detail || first.error || '', value: first.value ?? null, milestoneId: row.id, uncertain: row.uncertain };
    }
  }
  chapter.counts = counts;
  chapter.percent = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  chapter.status = counts.done === counts.total && counts.total > 0 ? 'done' : counts.done + counts.in_progress > 0 ? 'in_progress' : 'todo';
  chapter.milestoneIds = chapter.milestones.map((m) => m.id);
}

if (pretty) {
  const lines = [`${plan.project.name} — ${ranAt}`, `repo ${out.repo.branch} @ ${String(out.repo.head).slice(0, 7)}${out.repo.dirty ? ' (dirty)' : ''}`, ''];
  for (const c of out.chapters) {
    lines.push(`${c.title.padEnd(28)} ${String(c.counts.done).padStart(2)}/${String(c.counts.total).padEnd(2)} ${c.status}`);
    for (const m of c.milestones) {
      if (m.status === 'done') continue;
      const why = m.probes.filter((p) => !p.ok).map((p) => p.error ? `ERR ${p.error}` : p.detail).join('; ');
      lines.push(`   · ${m.status.padEnd(11)} ${m.title}${why ? ' — ' + why : ''}`);
    }
  }
  const s = out.summary;
  lines.push('', `milestones: ${s.milestones.done} done, ${s.milestones.in_progress} in progress, ${s.milestones.todo} to do, ${s.milestones.blocked} blocked, ${s.milestones.manual} manual; probes ${s.probesRun} run, ${s.probesErrored} errored`);
  console.error(lines.join('\n'));
}

process.stdout.write(JSON.stringify(out, null, pretty ? 1 : 0) + '\n');
