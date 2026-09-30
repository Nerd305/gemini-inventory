import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Check, Code2, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { useAuth } from '../contexts/AuthContext';
import { loadAppSettings } from '../lib/config';
import { GITHUB_REPO_URL } from '../lib/links';

const API_GITHUB_URL = `${GITHUB_REPO_URL}/blob/main/docs/API.md`;

// Same file as docs/API.md in the repo, rendered in the app.
const ApiReference = lazy(async () => {
  const [{ default: markdown }, { default: MarkdownDoc }] = await Promise.all([
    import('../../docs/API.md?raw'),
    import('../components/docs/MarkdownDoc'),
  ]);
  return { default: () => <MarkdownDoc markdown={markdown} /> };
});

const ENDPOINTS: { path: string; what: string }[] = [
  { path: '/api/v1/summary', what: 'Totals: products, bins, vials on hand, expired / expiring trays, last count' },
  { path: '/api/v1/products', what: 'Stock and reorder point per product' },
  { path: '/api/v1/bins', what: 'Every bin with fridge, shelf, total vials, last count' },
  { path: '/api/v1/trays?expiringWithinDays=30', what: 'Trays with lot, BUD, days to BUD, use-first rank' },
  { path: '/api/v1/counts?since=2026-01-01', what: 'Stock reconciliations written by Complete & Sync' },
  { path: '/api/v1/sessions', what: 'Counting sessions (who, when, bins, trays, vials)' },
  { path: '/api/v1/export.csv?table=trays', what: 'CSV download: products, bins, trays, counts or sessions' },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyButton({ text, label = 'Copy curl' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 shrink-0"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      {done ? 'Copied' : label}
    </Button>
  );
}

export default function ApiDocs() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const [health, setHealth] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
  const [keyState, setKeyState] = useState<'unknown' | 'configured' | 'missing'>('unknown');

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    loadAppSettings()
      .then((s) => {
        if (!cancelled) setKeyState(s.apiBridgeConfig?.apiKey ? 'configured' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setKeyState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const checkHealth = async () => {
    setHealth({ state: 'loading', text: '' });
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`, { headers: { Accept: 'application/json' } });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(
          `HTTP ${res.status}. The API is served by server.js (the Cloud Run container), not by the Vite dev server — try it against the deployed URL.`,
        );
      }
      const json = await res.json();
      setHealth({ state: 'ok', text: `API v${json.version} is up · database ${json.database}` });
    } catch (e) {
      setHealth({ state: 'error', text: e instanceof Error ? e.message : 'Request failed' });
    }
  };

  const curlFor = (path: string) => `curl -H "Authorization: Bearer $KEY" "${baseUrl}${path}"`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Code2 className="h-6 w-6 mr-2 text-blue-600" /> Reporting API
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Pull counts, stock, bins and tray BUDs into any other system. Read-only. JSON or CSV.
          </p>
        </div>
        <a
          href={API_GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-sm text-teal-700 underline underline-offset-2"
        >
          <ExternalLink className="h-4 w-4 mr-1" /> docs/API.md on GitHub
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <Activity className="h-4 w-4 mr-2 text-teal-600" /> Base URL
            </CardTitle>
            <CardDescription>Every endpoint hangs off this origin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1.5 text-sm font-mono">{baseUrl}/api/v1</code>
              <CopyButton text={`${baseUrl}/api/v1`} label="Copy" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={checkHealth} disabled={health.state === 'loading'}>
                {health.state === 'loading' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Activity className="h-3.5 w-3.5 mr-1" />}
                Check the API is up
              </Button>
              {health.state === 'ok' && <span className="text-xs text-green-700">{health.text}</span>}
              {health.state === 'error' && <span className="text-xs text-red-600">{health.text}</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <KeyRound className="h-4 w-4 mr-2 text-amber-600" /> API key
            </CardTitle>
            <CardDescription>
              Send it as <code>Authorization: Bearer &lt;key&gt;</code> on every request except <code>/health</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 space-y-1.5">
            {isAdmin ? (
              <>
                {keyState === 'configured' && <p className="text-green-700">A key is configured. Copy it from Settings → API Bridge and hand it to whoever integrates.</p>}
                {keyState === 'missing' && (
                  <p className="text-amber-700">
                    No key yet. Set one under{' '}
                    <Link to="/settings" className="underline">
                      Settings → API Bridge
                    </Link>{' '}
                    (any long random string), then Save.
                  </p>
                )}
                {keyState === 'unknown' && <p className="text-gray-500">Checking key status…</p>}
              </>
            ) : (
              <p>Ask an admin for the key. It lives under Settings → API Bridge, which only admins can open.</p>
            )}
            <p className="text-xs text-gray-500">The same key also authorizes the inbound sale webhook; treat it like a password.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Endpoints</CardTitle>
          <CardDescription>All GET. Replace <code>$KEY</code> with the API key.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {ENDPOINTS.map((e) => (
              <div key={e.path} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <code className="text-sm font-mono text-gray-900 break-all">{e.path}</code>
                  <p className="text-xs text-gray-500">{e.what}</p>
                </div>
                <CopyButton text={curlFor(e.path)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Full reference</CardTitle>
          <CardDescription>Field-by-field, with sample responses. This is docs/API.md rendered from the repository.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading reference…
              </div>
            }
          >
            <ApiReference />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
