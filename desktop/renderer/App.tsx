import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS, printStationId, usePrintJobQueue } from '@shared/printJobSubscription';
import { renderLabelsPdf } from '@shared/labelRender';
import type { LabelFormat, PrintJob } from '@shared/types';
import type { FormatConfigSummary, CupsPrinter, MediaSize } from './bridge';

const S = {
  page: {
    padding: '24px',
    maxWidth: '880px',
    margin: '0 auto',
    color: '#111827',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  } as React.CSSProperties,
  h1: { fontSize: '24px', fontWeight: 700, margin: 0 } as React.CSSProperties,
  subtitle: { color: '#6b7280', margin: '4px 0 0 0', fontSize: '13px' } as React.CSSProperties,
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '999px',
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '13px',
  } as React.CSSProperties,
  card: {
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
  } as React.CSSProperties,
  cardTitle: { fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0' } as React.CSSProperties,
  cardDesc: { fontSize: '12px', color: '#6b7280', margin: '0 0 12px 0' } as React.CSSProperties,
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    marginBottom: '6px',
    fontSize: '13px',
  } as React.CSSProperties,
  pill: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '999px',
    fontWeight: 500,
  } as React.CSSProperties,
  btn: {
    padding: '6px 12px',
    fontSize: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
  } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' } as React.CSSProperties,
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  } as React.CSSProperties,
  modalContent: {
    background: 'white',
    borderRadius: '12px',
    width: '600px',
    maxHeight: '80vh',
    overflow: 'auto',
    padding: '20px',
  } as React.CSSProperties,
  tabRow: {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px',
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '4px',
  } as React.CSSProperties,
  tab: {
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    borderRadius: '6px 6px 0 0',
    border: 'none',
    background: 'transparent',
    color: '#6b7280',
  } as React.CSSProperties,
  tabActive: {
    color: '#1d4ed8',
    borderBottom: '2px solid #1d4ed8',
  } as React.CSSProperties,
  input: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    width: '100%',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '4px',
    display: 'block',
  } as React.CSSProperties,
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginTop: '12px',
  } as React.CSSProperties,
  banner: {
    borderRadius: '10px',
    padding: '10px 14px',
    marginBottom: '12px',
    fontSize: '13px',
    lineHeight: 1.45,
  } as React.CSSProperties,
  hint: { fontSize: '11px', color: '#6b7280', margin: '6px 0 0 0', lineHeight: 1.45 } as React.CSSProperties,
  primaryBtn: {
    padding: '8px 16px',
    fontSize: '13px',
    border: 'none',
    borderRadius: '6px',
    background: '#1d4ed8',
    color: 'white',
    cursor: 'pointer',
  } as React.CSSProperties,
  iconBtn: {
    padding: '8px',
    fontSize: '14px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    cursor: 'pointer',
    color: '#6b7280',
  } as React.CSSProperties,
};

type Tab = 'sizes' | 'printers' | 'alignment';

const SIZE_NAMES: Record<string, string> = {
  '2.5x1.5': 'Bin / tray / shelf label · 2.5" × 1.5"',
  '1.5x1.5': 'Square label · 1.5" × 1.5"',
  '2.5x0.7': 'Slim label · 2.5" × 0.7"',
  '4x3': 'Large label · 4" × 3"',
  'canon-integrated': 'Canon integrated form · Letter',
};
const sizeName = (key: string) => SIZE_NAMES[key] ?? key;

const PILL = {
  ok: { background: '#d1fae5', color: '#065f46' },
  warn: { background: '#fef3c7', color: '#92400e' },
  bad: { background: '#fee2e2', color: '#991b1b' },
  info: { background: '#dbeafe', color: '#1e40af' },
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** "-o media=Custom.2.5x1.5in -o print-scaling=none" ⇄ ["-o", "media=…", …] */
const optionsToText = (opts: string[]) => opts.join(' ');
const textToOptions = (text: string) => text.trim().split(/\s+/).filter(Boolean);
/** Replace any media / PageSize choice in the options with this one. */
function withMedia(text: string, m: MediaSize): string {
  const parts = textToOptions(text);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '-o' && /^(media|PageSize)=/.test(parts[i + 1] ?? '')) {
      i++;
      continue;
    }
    if (/^(media|PageSize)=/.test(parts[i]) && out[out.length - 1] === '-o') {
      out.pop();
      continue;
    }
    out.push(parts[i]);
  }
  return optionsToText(['-o', `${m.option === 'PageSize' ? 'PageSize' : 'media'}=${m.key}`, ...out]);
}

type Health = { tone: keyof typeof PILL; text: string };
function printerHealth(device: string | undefined, printers: CupsPrinter[] | null): Health {
  if (!device) return { tone: 'bad', text: 'no printer chosen' };
  if (!printers) return { tone: 'info', text: 'checking…' };
  const p = printers.find((x) => x.device === device);
  if (!p) return { tone: 'bad', text: 'not found on this Mac' };
  if (p.state === 'disabled' || !p.enabled) return { tone: 'warn', text: `paused${p.detail && !/^paused$/i.test(p.detail) ? `: ${p.detail}` : ''}` };
  if (p.state === 'printing') return { tone: 'info', text: 'printing' };
  return { tone: 'ok', text: 'ready' };
}

export function App() {
  const station = useMemo(() => ({ id: printStationId(), name: 'Mac print server' }), []);
  const { jobs, activeJob, isPrinting, completeActive, failActive, reprint, legacyRules } = usePrintJobQueue(station);
  const [formats, setFormats] = useState<Record<string, FormatConfigSummary> | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [printers, setPrinters] = useState<CupsPrinter[] | null>(null);
  const knownDevicesRef = useRef<string[] | null>(null);
  const [newPrinters, setNewPrinters] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastPrinted, setLastPrinted] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('sizes');
  const [selected, setSelected] = useState('2.5x1.5');
  const [draftPrinter, setDraftPrinter] = useState('');
  const [draftOptions, setDraftOptions] = useState('');
  const [media, setMedia] = useState<MediaSize[] | null>(null);
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stickyRegion, setStickyRegion] = useState({ xIn: 1.25, yIn: 6.5, widthIn: 6, heightIn: 4 });
  const dispatchingRef = useRef<string | null>(null);

  useEffect(() => {
    window.printServer.getFormats().then(setFormats).catch((e) => setLastError(`Failed to load printer settings: ${e.message}`));
    window.printServer.getConfigPath().then(setConfigPath).catch(() => {});
    return window.printServer.onConfigReload((next) => setFormats(next));
  }, []);

  // CUPS printers, every 30 s: health for the mapped printers and "new printer" notices.
  const refreshPrinters = useCallback(async () => {
    try {
      const list = await window.printServer.listPrinters();
      setPrinters(list);
      const devices = list.map((p) => p.device);
      const known = knownDevicesRef.current;
      if (known) {
        const added = devices.filter((d) => !known.includes(d));
        if (added.length) setNewPrinters((prev) => Array.from(new Set([...prev, ...added])));
      }
      knownDevicesRef.current = devices;
    } catch (e: any) {
      setLastError(`Could not list printers: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    void refreshPrinters();
    const t = window.setInterval(() => void refreshPrinters(), 30_000);
    return () => window.clearInterval(t);
  }, [refreshPrinters]);

  // Print the claimed job: exact-size PDF from the shared label engine, then lp in the main process.
  useEffect(() => {
    if (!activeJob || !formats || dispatchingRef.current === activeJob.id) return;
    dispatchingRef.current = activeJob.id;
    const job = activeJob;
    (async () => {
      try {
        const cfg = formats[job.format];
        const pdf = await renderLabelsPdf([{ code: job.code, title: job.title, subtitle: job.subtitle }], job.format, {
          pageSize: cfg?.pageSize,
          stickyRegion: cfg?.stickyRegion,
        });
        const result = await window.printServer.printPdf({ jobId: job.id, format: job.format, title: job.title, pdfBase64: toBase64(pdf) });
        if (result.success) {
          setLastError(null);
          setLastPrinted(`${job.title} → ${cfg?.cupsPrinter ?? ''}`);
          await completeActive();
        } else {
          setLastError(result.error ?? 'Unknown print error');
          await failActive(result.error);
        }
      } catch (e: any) {
        setLastError(e?.message ?? String(e));
        await failActive(e?.message);
      } finally {
        dispatchingRef.current = null;
      }
    })();
  }, [activeJob, formats, completeActive, failActive]);

  // Editor follows the selected label size.
  useEffect(() => {
    const cfg = formats?.[selected];
    if (!cfg) return;
    setDraftPrinter(cfg.cupsPrinter);
    setDraftOptions(optionsToText(cfg.lpOptions));
    if (cfg.stickyRegion) setStickyRegion(cfg.stickyRegion);
  }, [formats, selected]);

  // Paper sizes the chosen printer's driver offers, to pick the one matching the label.
  useEffect(() => {
    if (!settingsOpen || !draftPrinter) return;
    let cancelled = false;
    setMedia(null);
    window.printServer
      .printerMedia(draftPrinter)
      .then((m) => !cancelled && setMedia(m))
      .catch(() => !cancelled && setMedia([]));
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, draftPrinter]);

  const saveSelected = async (patch: Partial<FormatConfigSummary>) => {
    if (!formats?.[selected]) return false;
    setBusy('saving');
    setNote(null);
    try {
      const next = { ...formats, [selected]: { ...formats[selected], ...patch } };
      const result = await window.printServer.saveFormats(next);
      if (!result.success) {
        setNote(result.error ?? 'Save failed');
        return false;
      }
      setFormats(result.formats ?? next);
      setNote('Saved. New jobs use it right away.');
      return true;
    } finally {
      setBusy(null);
    }
  };

  const testPrint = async () => {
    const cfg = formats?.[selected];
    if (!cfg) return;
    setBusy('testing');
    setNote(null);
    try {
      const pdf = await renderLabelsPdf(
        [{ code: `TEST-${selected}`, title: 'VialTrack test label', subtitle: `${cfg.pageSize.widthIn}" × ${cfg.pageSize.heightIn}" on ${cfg.cupsPrinter}` }],
        selected as LabelFormat,
        { pageSize: cfg.pageSize, stickyRegion: cfg.stickyRegion },
      );
      const result = await window.printServer.printPdf({ jobId: `test-${Date.now()}`, format: selected, title: 'Test label', pdfBase64: toBase64(pdf) });
      setNote(result.success ? `Test label sent to ${cfg.cupsPrinter}${result.requestId ? ` (${result.requestId})` : ''}. Check that it fills the label without shrinking.` : result.error ?? 'Test print failed');
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const formatEntries = formats ? Object.entries(formats) : [];
  const problems = formatEntries
    .map(([key, cfg]) => ({ key, cfg, health: printerHealth(cfg.cupsPrinter, printers) }))
    .filter((p) => p.health.tone === 'bad' || p.health.tone === 'warn');
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const selectedCfg = formats?.[selected];
  const matching = media && selectedCfg ? media.filter((m) => {
    const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 0.03;
    const { widthIn: w, heightIn: h } = selectedCfg.pageSize;
    return (near(m.widthIn, w) && near(m.heightIn, h)) || (near(m.widthIn, h) && near(m.heightIn, w));
  }) : [];
  const printerChoices = Array.from(new Set([...(printers ?? []).map((p) => p.device), draftPrinter].filter(Boolean)));

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>VialTrack Print Server</h1>
          <p style={S.subtitle}>Prints labels queued from the VialTrack app, each label size on its own printer.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={S.statusPill}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isPrinting ? '#f59e0b' : '#10b981' }} />
            {isPrinting ? `Printing: ${activeJob?.title ?? ''}` : 'Listening for jobs'}
          </div>
          <button style={S.iconBtn} onClick={() => { void refreshPrinters(); setSettingsOpen(true); }} title="Settings">
            ⚙
          </button>
        </div>
      </div>

      {lastError && (
        <div style={{ ...S.banner, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
          <strong>Last print failed:</strong> {lastError}
          <div style={{ fontSize: '11px', marginTop: '4px' }}>It retries automatically ({MAX_ATTEMPTS} tries), then shows as failed with a Retry button.</div>
        </div>
      )}
      {!lastError && lastPrinted && (
        <div style={{ ...S.banner, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46' }}>Last printed: {lastPrinted}</div>
      )}
      {legacyRules && (
        <div style={{ ...S.banner, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          The database rules are older than this print server, so it prints without claiming jobs and can't mark failures.
          Publish <code>firestore.rules</code> (see the README).
        </div>
      )}
      {newPrinters.length > 0 && (
        <div style={{ ...S.banner, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
          New printer found: <strong>{newPrinters.join(', ')}</strong>. Assign it to a label size in Settings → Label sizes.{' '}
          <button style={S.btn} onClick={() => { setTab('sizes'); setSettingsOpen(true); setNewPrinters([]); }}>Assign…</button>{' '}
          <button style={S.btn} onClick={() => setNewPrinters([])}>Dismiss</button>
        </div>
      )}
      {problems.length > 0 && (
        <div style={{ ...S.banner, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          {problems.map((p) => (
            <div key={p.key}>
              <strong>{sizeName(p.key)}</strong>: {p.cfg.cupsPrinter || 'no printer'} is {p.health.text}.
            </div>
          ))}
          <div style={{ fontSize: '11px', marginTop: '4px' }}>Fix it in System Settings → Printers & Scanners, or pick another printer in Settings → Label sizes.</div>
        </div>
      )}

      <div style={S.grid}>
        <div style={S.card}>
          <h3 style={S.cardTitle}>Label sizes → printers</h3>
          <p style={S.cardDesc}>Change in Settings (⚙). Saved instantly, no restart.</p>
          {formatEntries.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#6b7280' }}>Loading…</p>
          ) : (
            formatEntries.map(([key, cfg]) => {
              const h = printerHealth(cfg.cupsPrinter, printers);
              return (
                <div key={key} style={S.row}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{sizeName(key)}</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>{cfg.cupsPrinter || '—'}</div>
                  </div>
                  <span style={{ ...S.pill, ...PILL[h.tone] }}>{h.text}</span>
                </div>
              );
            })
          )}
        </div>

        <div style={S.card}>
          <h3 style={S.cardTitle}>Recent print jobs</h3>
          <p style={S.cardDesc}>{failedJobs.length ? `${failedJobs.length} failed: open one to see why, then Retry.` : 'Shared with every print station.'}</p>
          {jobs.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#6b7280' }}>No print jobs yet.</p>
          ) : (
            jobs.slice(0, 10).map((job) => <JobRow key={job.id} job={job} onReprint={() => void reprint(job)} />)
          )}
        </div>
      </div>

      {settingsOpen && (
        <div style={S.modal} onClick={() => setSettingsOpen(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Settings</h2>
              <button style={S.iconBtn} onClick={() => setSettingsOpen(false)}>✕</button>
            </div>

            <div style={S.tabRow}>
              {(['sizes', 'printers', 'alignment'] as Tab[]).map((t) => (
                <button key={t} style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }} onClick={() => setTab(t)}>
                  {t === 'sizes' ? 'Label sizes' : t === 'printers' ? 'Printers on this Mac' : 'Canon alignment'}
                </button>
              ))}
            </div>

            {tab === 'sizes' && selectedCfg && (
              <div>
                <label style={S.label}>Label size</label>
                <select style={S.input} value={selected} onChange={(e) => { setSelected(e.target.value); setNote(null); }}>
                  {formatEntries.map(([key]) => (
                    <option key={key} value={key}>{sizeName(key)}</option>
                  ))}
                </select>

                <div style={S.formRow}>
                  <div>
                    <label style={S.label}>Printer</label>
                    <select style={S.input} value={draftPrinter} onChange={(e) => setDraftPrinter(e.target.value)}>
                      {printerChoices.map((d) => (
                        <option key={d} value={d}>
                          {d}{printers && !printers.some((p) => p.device === d) ? ' (not found)' : ''}
                        </option>
                      ))}
                    </select>
                    <p style={S.hint}>
                      New printer? Add it in{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); void window.printServer.openPrinterSettings(); }}>Printers & Scanners</a>, then{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); void refreshPrinters(); }}>rescan</a>.
                    </p>
                  </div>
                  <div>
                    <label style={S.label}>Page size (from the label)</label>
                    <input style={{ ...S.input, background: '#f9fafb' }} value={`${selectedCfg.pageSize.widthIn}" × ${selectedCfg.pageSize.heightIn}"`} disabled />
                  </div>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label style={S.label}>Paper size on this printer</label>
                  {media === null ? (
                    <p style={S.hint}>Reading the printer's paper sizes…</p>
                  ) : media.length === 0 ? (
                    <p style={S.hint}>The driver didn't list paper sizes. Use a custom size in the options below, e.g. <code>-o media=Custom.{selectedCfg.pageSize.widthIn}x{selectedCfg.pageSize.heightIn}in</code>.</p>
                  ) : matching.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {matching.map((m) => (
                        <button key={m.key} style={S.btn} onClick={() => setDraftOptions(withMedia(draftOptions, m))} title={`${m.option}=${m.key}`}>
                          Use {m.key}{m.isDefault ? ' (default)' : ''}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p style={S.hint}>
                      None of the {media.length} sizes this printer lists is {selectedCfg.pageSize.widthIn}" × {selectedCfg.pageSize.heightIn}". Load that label stock, or
                      define the size for the printer (for Zebra / Epson drivers: <code>lpoptions -p {draftPrinter} -o media=Custom.{selectedCfg.pageSize.widthIn}x{selectedCfg.pageSize.heightIn}in</code>).
                    </p>
                  )}
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label style={S.label}>lp options</label>
                  <input style={S.input} value={draftOptions} onChange={(e) => setDraftOptions(e.target.value)} placeholder="-o media=Custom.2.5x1.5in -o print-scaling=none" />
                  <p style={S.hint}>
                    Passed to <code>lp</code> as-is. Labels already come as {selectedCfg.pageSize.widthIn}" × {selectedCfg.pageSize.heightIn}" PDF pages; avoid <code>fit-to-page</code> unless the label prints shifted.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
                  <button
                    style={S.primaryBtn}
                    disabled={busy !== null}
                    onClick={() => void saveSelected({ cupsPrinter: draftPrinter, lpOptions: textToOptions(draftOptions) })}
                  >
                    {busy === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  <button style={S.btn} disabled={busy !== null} onClick={() => void testPrint()}>
                    {busy === 'testing' ? 'Printing…' : '🖨 Test print (saved settings)'}
                  </button>
                </div>
                {note && <p style={{ ...S.hint, color: '#111827' }}>{note}</p>}
                {configPath && <p style={S.hint}>Settings file: {configPath}</p>}
              </div>
            )}

            {tab === 'printers' && (
              <div>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>Printers macOS knows about (refreshed every 30 s).</p>
                {!printers || printers.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#6b7280' }}>{printers ? 'No printers found.' : 'Checking…'}</p>
                ) : (
                  printers.map((p) => {
                    const h = printerHealth(p.device, printers);
                    const used = formatEntries.filter(([, cfg]) => cfg.cupsPrinter === p.device).map(([k]) => k);
                    return (
                      <div key={p.device} style={S.row}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{p.device}{p.isDefault ? ' ★' : ''}</div>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>
                            {p.description || '—'}{used.length ? ` · used for ${used.join(', ')}` : ' · not used'}
                          </div>
                        </div>
                        <span style={{ ...S.pill, ...PILL[h.tone] }}>{h.text}</span>
                      </div>
                    );
                  })
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button style={S.btn} onClick={() => void refreshPrinters()}>⟳ Rescan</button>
                  <button style={S.btn} onClick={() => void window.printServer.openPrinterSettings()}>＋ Add a printer…</button>
                </div>
                <p style={S.hint}>
                  Add new printers in System Settings → Printers & Scanners (USB, network or AirPrint). They show up here within 30 s;
                  then pick them under Label sizes.
                </p>
              </div>
            )}

            {tab === 'alignment' && (
              <div>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                  Where the adhesive label sits on the Canon integrated form (inches from the top-left of the Letter sheet).
                  Test print the Canon size under Label sizes after saving.
                </p>
                <div style={S.formRow}>
                  {(['xIn', 'yIn', 'widthIn', 'heightIn'] as const).map((k) => (
                    <div key={k}>
                      <label style={S.label}>{{ xIn: 'X position', yIn: 'Y position', widthIn: 'Width', heightIn: 'Height' }[k]} (in)</label>
                      <input
                        style={S.input}
                        type="number"
                        step="0.05"
                        value={stickyRegion[k]}
                        onChange={(e) => setStickyRegion({ ...stickyRegion, [k]: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  ))}
                </div>
                <button
                  style={{ ...S.primaryBtn, marginTop: '16px' }}
                  disabled={busy !== null || !formats?.['canon-integrated']}
                  onClick={() => {
                    setSelected('canon-integrated');
                    void (async () => {
                      if (!formats?.['canon-integrated']) return;
                      setBusy('saving');
                      try {
                        const next = { ...formats, 'canon-integrated': { ...formats['canon-integrated'], stickyRegion } };
                        const result = await window.printServer.saveFormats(next);
                        if (result.success) setFormats(result.formats ?? next);
                        setNote(result.success ? 'Saved.' : result.error ?? 'Save failed');
                      } finally {
                        setBusy(null);
                      }
                    })();
                  }}
                >
                  {busy === 'saving' ? 'Saving…' : '💾 Save'}
                </button>
                {note && <p style={{ ...S.hint, color: '#111827' }}>{note}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onReprint }: { job: PrintJob; onReprint: () => void }) {
  const tone =
    job.status === 'completed' ? PILL.ok : job.status === 'failed' ? PILL.bad : job.status === 'printing' ? PILL.info : PILL.warn;
  const label =
    job.status === 'pending' && job.attempts ? `retrying (${job.attempts}/${MAX_ATTEMPTS})` : job.status === 'printing' ? `printing · ${job.claimedByName ?? ''}` : job.status;
  return (
    <div style={{ ...S.row, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{job.title}</div>
        <div style={{ fontSize: '11px', color: '#6b7280' }}>
          {job.code} • {job.format}{job.printedBy && job.status === 'completed' ? ` • ${job.printedBy}` : ''}
        </div>
        {job.lastError && job.status !== 'completed' && <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px' }}>{job.lastError}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span style={{ ...S.pill, ...tone }}>{label}</span>
        {(job.status === 'completed' || job.status === 'failed') && (
          <button style={S.btn} onClick={onReprint}>
            {job.status === 'failed' ? 'Retry' : 'Reprint'}
          </button>
        )}
      </div>
    </div>
  );
}
