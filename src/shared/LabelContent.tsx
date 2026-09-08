import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
// @ts-ignore
import Barcode from 'react-barcode';
import type { LabelFormat, StickyRegion } from './types';

interface LabelContentProps {
  code: string;
  title: string;
  subtitle?: string;
  format: LabelFormat;
  stickyRegion?: StickyRegion;
}

/**
 * Renders the printable body of a label. Sizes are expressed in CSS px at
 * 96 px/in so the same markup renders identically in the browser print
 * iframe and in the desktop print server's hidden window (printToPDF).
 */
export function LabelContent({ code, title, subtitle, format, stickyRegion }: LabelContentProps) {
  const body = (() => {
    if (format === '4x3') {
      return (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '24px' }}>{title}</h1>
          {subtitle && <p style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#444' }}>{subtitle}</p>}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={code} size={180} />
          </div>
          <div style={{ marginTop: '4px', fontSize: '10px', fontFamily: 'monospace' }}>{code}</div>
        </div>
      );
    }
    if (format === '2x1.5') {
      // 2in x 1.5in = 192 x 144 px. QR on the left (~0.92in), text stacked on the right.
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '2in',
            height: '1.5in',
            boxSizing: 'border-box',
            padding: '0.07in',
            gap: '0.06in',
            fontFamily: 'sans-serif',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: '0 0 auto', display: 'flex' }}>
            <QRCodeSVG value={code} size={88} level="M" />
          </div>
          <div
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                lineHeight: 1.15,
                wordBreak: 'break-word',
                overflow: 'hidden',
                maxHeight: '39px',
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontSize: '8px',
                  color: '#333',
                  marginTop: '3px',
                  lineHeight: 1.2,
                  wordBreak: 'break-word',
                  overflow: 'hidden',
                  maxHeight: '20px',
                }}
              >
                {subtitle}
              </div>
            )}
            <div
              style={{
                fontSize: '6.5px',
                fontFamily: 'monospace',
                color: '#555',
                marginTop: '3px',
                wordBreak: 'break-all',
              }}
            >
              {code}
            </div>
          </div>
        </div>
      );
    }
    if (format === '1.5x1.5') {
      return (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '12px' }}>{title}</h1>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={code} size={90} />
          </div>
        </div>
      );
    }
    if (format === '2.5x1.5') {
      return (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{title}</h1>
          {subtitle && <p style={{ margin: '0 0 8px 0', fontSize: '10px', color: '#444' }}>{subtitle}</p>}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={code} size={100} />
          </div>
        </div>
      );
    }
    if (format === '2.5x0.7') {
      return (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Barcode value={code} width={1.5} height={35} fontSize={12} margin={0} displayValue={true} />
          </div>
          <h1 style={{ margin: '0', fontSize: '10px' }}>{title}</h1>
        </div>
      );
    }
    if (format === 'canon-integrated') {
      return (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '28px' }}>{title}</h1>
          {subtitle && <p style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#444' }}>{subtitle}</p>}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={code} size={240} />
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'monospace' }}>{code}</div>
        </div>
      );
    }
    return null;
  })();

  if (format === 'canon-integrated' && stickyRegion) {
    return (
      <div
        style={{
          position: 'absolute',
          left: `${stickyRegion.xIn}in`,
          top: `${stickyRegion.yIn}in`,
          width: `${stickyRegion.widthIn}in`,
          height: `${stickyRegion.heightIn}in`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        {body}
      </div>
    );
  }

  return body;
}
