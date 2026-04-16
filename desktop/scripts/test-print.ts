#!/usr/bin/env npx ts-node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface FormatConfig {
  cupsPrinter: string;
  pageSize: { widthIn: number; heightIn: number };
  margins: { top: number; right: number; bottom: number; left: number };
  lpOptions: string[];
  stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
}

function loadConfig(): { formats: Record<string, FormatConfig> } {
  const configPath = path.join(__dirname, '..', 'config', 'printers.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    console.error('Run "npm run setup" first to configure printers');
    process.exit(1);
  }
}

function generateAlignmentHTML(format: string, cfg: FormatConfig): string {
  const pw = cfg.pageSize.widthIn * 96;
  const ph = cfg.pageSize.heightIn * 96;
  const isCanon = format === 'canon-integrated';
  
  const labelW = isCanon && cfg.stickyRegion ? cfg.stickyRegion.widthIn * 96 : pw * 0.8;
  const labelH = isCanon && cfg.stickyRegion ? cfg.stickyRegion.heightIn * 96 : ph * 0.6;
  const labelX = isCanon && cfg.stickyRegion ? cfg.stickyRegion.xIn * 96 : (pw - labelW) / 2;
  const labelY = isCanon && cfg.stickyRegion ? cfg.stickyRegion.yIn * 96 : (ph - labelH) / 2;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: ${cfg.pageSize.widthIn}in ${cfg.pageSize.heightIn}in;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${pw}px;
      height: ${ph}px;
      position: relative;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .border {
      position: absolute;
      left: ${labelX}px;
      top: ${labelY}px;
      width: ${labelW}px;
      height: ${labelH}px;
      border: 2px solid #f00;
      background: transparent;
    }
    .corners {
      position: absolute;
      left: ${labelX}px;
      top: ${labelY}px;
      width: ${labelW}px;
      height: ${labelH}px;
    }
    .corners::before, .corners::after {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      border: 2px solid #f00;
    }
    .corners::before { top: 0; left: 0; border-right: none; border-bottom: none; }
    .corners::after { top: 0; right: 0; border-left: none; border-bottom: none; }
    .c2::before { bottom: 0; left: 0; border-right: none; border-top: none; }
    .c2::after { bottom: 0; right: 0; border-left: none; border-top: none; }
    .grid {
      position: absolute;
      left: ${labelX}px;
      top: ${labelY}px;
      width: ${labelW}px;
      height: ${labelH}px;
      background-image: 
        linear-gradient(#f00 1px, transparent 1px),
        linear-gradient(90deg, #f00 1px, transparent 1px);
      background-size: 24px 24px;
      opacity: 0.3;
    }
    .label-area {
      position: absolute;
      left: ${labelX + 20}px;
      top: ${labelY + 20}px;
      width: ${labelW - 40}px;
      height: ${labelH - 40}px;
      border: 1px dashed #00f;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    .label-text {
      font-size: 14px;
      color: #00f;
      text-align: center;
      font-weight: bold;
    }
    .dims-h {
      position: absolute;
      top: ${labelY + labelH + 10}px;
      left: ${labelX}px;
      font-size: 12px;
      color: #f00;
    }
    .dims-v {
      position: absolute;
      top: ${labelY}px;
      left: ${labelX + labelW + 10}px;
      font-size: 12px;
      color: #f00;
      writing-mode: vertical-rl;
    }
    .title {
      position: absolute;
      top: 20px;
      left: 20px;
      font-size: 18px;
      font-weight: bold;
      color: #333;
    }
    .info {
      position: absolute;
      top: 50px;
      left: 20px;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="title">VialTrack Alignment Test - ${format}</div>
  <div class="info">Printer: ${cfg.cupsPrinter} | Size: ${cfg.pageSize.widthIn}" x ${cfg.pageSize.heightIn}" | ${isCanon ? 'Sticky region: ' + cfg.stickyRegion?.widthIn + 'x' + cfg.stickyRegion?.heightIn + '@' + cfg.stickyRegion?.xIn + ',' + cfg.stickyRegion?.yIn : 'Full page'}</div>
  <div class="border"></div>
  <div class="corners"></div>
  <div class="corners c2"></div>
  <div class="grid"></div>
  <div class="label-area">
    <div class="label-text">Label Area</div>
    <div class="label-text">${Math.round(labelW/96*100)/100}" x ${Math.round(labelH/96*100)/100}"</div>
  </div>
  <div class="dims-h">${cfg.pageSize.widthIn}"</div>
  <div class="dims-v">${cfg.pageSize.heightIn}"</div>
</body>
</html>`;
}

function printHTML(format: string, cfg: FormatConfig): void {
  const html = generateAlignmentHTML(format, cfg);
  const tmpDir = os.tmpdir();
  const htmlPath = path.join(tmpDir, `vialtrack-test-${format}.html`);
  
  fs.writeFileSync(htmlPath, html);
  
  console.log(`\nAlignment sheet generated: ${htmlPath}\n`);
  console.log('To print, choose File > Print in your browser,');
  console.log(`and select printer "${cfg.cupsPrinter}" with these options:`);
  console.log(`  ${cfg.lpOptions.join(' ')}\n`);
  console.log('Or run this command:');
  console.log(`  lp -d ${cfg.cupsPrinter} ${cfg.lpOptions.join(' ')} ${htmlPath}\n`);
  
  console.log('The red border shows the label boundary.');
  console.log('The blue dashed box shows the printable area.');
  console.log('Adjust your printer margins if the label is clipped.\n');
  
  console.log('Open in browser? (y/n): ');
}

function main() {
  const args = process.argv.slice(2);
  let format = '4x3';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1];
    }
  }
  
  const config = loadConfig();
  const cfg = config.formats[format];
  
  if (!cfg) {
    console.error(`Unknown format: ${format}`);
    console.log('Available:', Object.keys(config.formats).join(', '));
    process.exit(1);
  }
  
  console.log(`\n=== VialTrack Test Print: ${format} ===\n`);
  printHTML(format, cfg);
}

main();