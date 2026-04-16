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
