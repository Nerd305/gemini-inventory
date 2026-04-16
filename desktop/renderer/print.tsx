import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LabelContent } from '@shared/LabelContent';
import type { PrintJob, StickyRegion } from '@shared/types';
import './bridge';

function PrintRoot() {
  const [job, setJob] = useState<PrintJob | null>(null);
  const [sticky, setSticky] = useState<StickyRegion | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const j = await window.printServer.getRenderJob();
      if (!j) return;
      setJob(j);
      const region = await window.printServer.getStickyRegion(j.format);
      setSticky(region);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      window.printServer.signalRenderReady();
    }, 250);
    return () => clearTimeout(t);
  }, [ready]);

  if (!job) return null;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <LabelContent
        code={job.code}
        title={job.title}
        subtitle={job.subtitle}
        format={job.format}
        stickyRegion={sticky ?? undefined}
      />
    </div>
  );
}

createRoot(document.getElementById('print-root')!).render(<PrintRoot />);
