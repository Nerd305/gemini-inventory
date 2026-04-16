import React, { useEffect, useState } from 'react';
import { usePrintJobQueue } from '@shared/printJobSubscription';
import type { PrintJob } from '@shared/types';
import type { FormatConfigSummary, PrintResult, CupsPrinter } from './bridge';

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

type Tab = 'printers' | 'formats' | 'alignment';

export function App() {
  const { jobs, activeJob, isPrinting, completeActive, failActive, reprint } = usePrintJobQueue();
  const [formats, setFormats] = useState<Record<string, FormatConfigSummary>>({});
  const [systemPrinters, setSystemPrinters] = useState<CupsPrinter[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('printers');
  const [selectedFormat, setSelectedFormat] = useState<string>('4x3');
  const [testingPrint, setTestingPrint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stickyRegion, setStickyRegion] = useState({ xIn: 1.25, yIn: 6.5, widthIn: 6, heightIn: 4 });

  useEffect(() => {
    window.printServer.getFormats().then(setFormats).catch((e) => {
      setLastError(`Failed to load printer config: ${e.message}`);
    });
    const unsub = window.printServer.onConfigReload((next) => {
      setFormats(next);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!activeJob || dispatching) return;
    setDispatching(true);
    setLastError(null);
    window.printServer
      .printJob(activeJob)
      .then((result: PrintResult) => {
        if (result.success) {
          completeActive();
        } else {
          setLastError(result.error ?? 'Unknown print error');
          failActive();
        }
      })
      .catch((e) => {
        setLastError(e.message);
        failActive();
      })
      .finally(() => setDispatching(false));
  }, [activeJob, dispatching, completeActive, failActive]);

  useEffect(() => {
    if (formats['canon-integrated']?.stickyRegion) {
      setStickyRegion(formats['canon-integrated'].stickyRegion);
    }
  }, [formats]);

  const loadSystemPrinters = async () => {
    try {
      const printers = await window.printServer.listPrinters();
      setSystemPrinters(printers);
    } catch (e: any) {
      setLastError(`Failed to load printers: ${e.message}`);
    }
  };

  const handleTestPrint = async () => {
    setTestingPrint(true);
    try {
      const result = await window.printServer.testPrint(selectedFormat);
      if (!result.success) {
        setLastError(result.error ?? 'Test print failed');
      }
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setTestingPrint(false);
    }
  };

  const handleSaveStickyRegion = async () => {
    const current = formats['canon-integrated'];
    if (!current) return;
    setSaving(true);
    try {
      const updated = {
        ...formats,
        'canon-integrated': {
          ...current,
          stickyRegion,
        },
      };
      const result = await window.printServer.saveFormats(updated);
      if (!result.success) {
        setLastError(result.error ?? 'Save failed');
      } else {
        setFormats(updated);
      }
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrinterChange = async (printer: string) => {
    const current = formats[selectedFormat];
    if (!current) return;
    setSaving(true);
    try {
      const updated = {
        ...formats,
        [selectedFormat]: { ...current, cupsPrinter: printer },
      };
      const result = await window.printServer.saveFormats(updated);
      if (!result.success) {
        setLastError(result.error ?? 'Save failed');
      } else {
        setFormats(updated);
      }
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>VialTrack Print Server</h1>
          <p style={S.subtitle}>Listening for print jobs and routing to physical printers.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={S.statusPill}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isPrinting ? '#f59e0b' : '#10b981' }} />
            {isPrinting ? `Printing: ${activeJob?.title ?? ''}` : 'Listening for jobs'}
          </div>
          <button style={S.iconBtn} onClick={() => { loadSystemPrinters(); setSettingsOpen(true); }} title="Settings">
            ⚙
          </button>
        </div>
      </div>

      {lastError && (
        <div style={{ ...S.card, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
          <strong>Last error:</strong> {lastError}
        </div>
      )}

      <div style={S.grid}>
        <div style={S.card}>
          <h3 style={S.cardTitle}>Configured Printers</h3>
          <p style={S.cardDesc}>Edit desktop/config/printers.json to update. Reloads automatically.</p>
          {Object.keys(formats).length === 0 ? (
            <p style={{ fontSize: '12px', color: '#6b7280' }}>No formats configured.</p>
          ) : (
            Object.entries(formats).map(([fmt, cfg]) => (
              <div key={fmt} style={S.row}>
                <div>
                  <div style={{ fontWeight: 500 }}>{fmt}</div>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{cfg.cupsPrinter}</div>
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  {cfg.pageSize.widthIn}" × {cfg.pageSize.heightIn}"
                </div>
              </div>
            ))
          )}
        </div>

        <div style={S.card}>
          <h3 style={S.cardTitle}>Recent Print Jobs</h3>
          <p style={S.cardDesc}>History from Firestore.</p>
          {jobs.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#6b7280' }}>No print jobs yet.</p>
          ) : (
            jobs.slice(0, 8).map((job) => <JobRow key={job.id} job={job} onReprint={() => reprint(job)} />)
          )}
        </div>
      </div>

      {settingsOpen && (
        <div style={S.modal} onClick={() => setSettingsOpen(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Printer Configuration</h2>
              <button style={S.iconBtn} onClick={() => setSettingsOpen(false)}>✕</button>
            </div>

            <div style={S.tabRow}>
              <button
                style={{ ...S.tab, ...(activeTab === 'printers' ? S.tabActive : {}) }}
                onClick={() => setActiveTab('printers')}
              >
                System Printers
              </button>
              <button
                style={{ ...S.tab, ...(activeTab === 'formats' ? S.tabActive : {}) }}
                onClick={() => setActiveTab('formats')}
              >
                Formats
              </button>
              <button
                style={{ ...S.tab, ...(activeTab === 'alignment' ? S.tabActive : {}) }}
                onClick={() => setActiveTab('alignment')}
              >
                Alignment
              </button>
            </div>

            {activeTab === 'printers' && (
              <div>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                  CUPS printers detected on this system. Run <code style={{ background: '#f3f4f6', padding: '2px 4px', borderRadius: '4px' }}>lpstat -p</code> in Terminal to refresh.
                </p>
                {systemPrinters.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#6b7280' }}>Click "Rescan" to detect printers.</p>
                ) : (
                  systemPrinters.map((p) => (
                    <div key={p.device} style={S.row}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.device}</div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>{p.model}</div>
                      </div>
                      <span style={{ ...S.pill, background: p.status === 'ready' ? '#d1fae5' : '#fef3c7', color: p.status === 'ready' ? '#065f46' : '#92400e' }}>
                        {p.status}
                      </span>
                    </div>
                  ))
                )}
                <button style={{ ...S.btn, marginTop: '12px' }} onClick={loadSystemPrinters}>
                  ⟳ Rescan
                </button>
              </div>
            )}

            {activeTab === 'formats' && (
              <div>
                <label style={S.label}>Format</label>
                <select
                  style={S.input}
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                >
                  {Object.keys(formats).map((fmt) => (
                    <option key={fmt} value={fmt}>{fmt}</option>
                  ))}
                </select>

                {formats[selectedFormat] && (
                  <>
                    <div style={S.formRow[0]}>
                      <div>
                        <label style={S.label}>CUPS Printer</label>
                        <select
                          style={S.input}
                          value={formats[selectedFormat].cupsPrinter}
                          onChange={(e) => handlePrinterChange(e.target.value)}
                        >
                          {systemPrinters.length === 0 ? (
                            <option value={formats[selectedFormat].cupsPrinter}>{formats[selectedFormat].cupsPrinter}</option>
                          ) : (
                            systemPrinters.map((p) => (
                              <option key={p.device} value={p.device}>{p.device}</option>
                            ))
                          )}
                        </select>
                      </div>
                      <div>
                        <label style={S.label}>Page Size</label>
                        <input
                          style={{ ...S.input, background: '#f9fafb' }}
                          value={`${formats[selectedFormat].pageSize.widthIn}" × ${formats[selectedFormat].pageSize.heightIn}"`}
                          disabled
                        />
                      </div>
                    </div>

                    <button
                      style={{ ...S.primaryBtn, marginTop: '16px' }}
                      onClick={handleTestPrint}
                      disabled={testingPrint}
                    >
                      {testingPrint ? 'Printing...' : '🖨 Test Print'}
                    </button>
                  </>
                )}
              </div>
            )}

            {activeTab === 'alignment' && (
              <div>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                  Adjust stickyRegion for canon-integrated format. Use "Test Print" in Formats tab to print alignment sheet.
                </p>
                <div style={S.formRow[0]}>
                  <div>
                    <label style={S.label}>X Position (inches)</label>
                    <input
                      style={S.input}
                      type="number"
                      step="0.05"
                      value={stickyRegion.xIn}
                      onChange={(e) => setStickyRegion({ ...stickyRegion, xIn: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Y Position (inches)</label>
                    <input
                      style={S.input}
                      type="number"
                      step="0.05"
                      value={stickyRegion.yIn}
                      onChange={(e) => setStickyRegion({ ...stickyRegion, yIn: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div style={S.formRow[0]}>
                  <div>
                    <label style={S.label}>Width (inches)</label>
                    <input
                      style={S.input}
                      type="number"
                      step="0.05"
                      value={stickyRegion.widthIn}
                      onChange={(e) => setStickyRegion({ ...stickyRegion, widthIn: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Height (inches)</label>
                    <input
                      style={S.input}
                      type="number"
                      step="0.05"
                      value={stickyRegion.heightIn}
                      onChange={(e) => setStickyRegion({ ...stickyRegion, heightIn: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <button
                  style={{ ...S.primaryBtn, marginTop: '16px' }}
                  onClick={handleSaveStickyRegion}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : '💾 Save'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onReprint }: { job: PrintJob; onReprint: () => void }) {
  const pillStyle: React.CSSProperties =
    job.status === 'completed'
      ? { ...S.pill, background: '#d1fae5', color: '#065f46' }
      : { ...S.pill, background: '#fef3c7', color: '#92400e' };
  return (
    <div style={S.row}>
      <div>
        <div style={{ fontWeight: 500 }}>{job.title}</div>
        <div style={{ fontSize: '11px', color: '#6b7280' }}>
          {job.code} • {job.format}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={pillStyle}>{job.status}</span>
        {job.status === 'completed' && (
          <button style={S.btn} onClick={onReprint}>
            Reprint
          </button>
        )}
      </div>
    </div>
  );
}