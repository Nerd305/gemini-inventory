#!/usr/bin/env npx ts-node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PrinterInfo {
  device: string;
  status: string;
  makeAndModel: string;
}

function getCupsPrinters(): PrinterInfo[] {
  try {
    const output = execSync('lpstat -p', { encoding: 'utf8' });
    const printers: PrinterInfo[] = [];
    for (const line of output.split('\n')) {
      const match = line.trim().match(/printer (\S+)\s+(\S+)\s+(\S+)/);
      if (match) {
        printers.push({
          device: match[1],
          status: match[2],
          makeAndModel: match[3],
        });
      }
    }
    return printers;
  } catch {
    return [];
  }
}

function prompt(question: string): string {
  return question;
}

function promptNumber(question: string, min: number, max: number): number {
  return min;
}

function main() {
  console.log('\n=== VialTrack Print Station Setup ===\n');
  
  console.log('Step 1: Detecting CUPS printers...\n');
  const printers = getCupsPrinters();
  
  if (printers.length === 0) {
    console.log('ERROR: No printers found via CUPS.');
    console.log('Make sure printers are added in System Settings > Printers & Scanners');
    console.log('Then run: lpstat -p\n');
    return;
  }
  
  console.log(`Found ${printers.length} printer(s):\n`);
  printers.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.device} (${p.makeAndModel}) - ${p.status}`);
  });
  console.log('');
  
  console.log('Step 2: Mapping label formats to printers...\n');
  console.log('Available formats: 4x3, 1.5x1.5, 2.5x1.5, 2.5x0.7, canon-integrated');
  console.log('');
  
  const config: { formats: Record<string, {
    cupsPrinter: string;
    pageSize: { widthIn: number; heightIn: number };
    margins: { top: number; right: number; bottom: number; left: number };
    lpOptions: string[];
    stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  }> } = { formats: {} };
  
  const defaultMappings: Record<string, string[]> = {
    '4x3': ['Zebra', 'ZD410', 'ZD420'],
    '1.5x1.5': ['EPSON', 'TM', 'C6000'],
    '2.5x1.5': ['EPSON', 'TM', 'C6000'],
    '2.5x0.7': ['EPSON', 'TM', 'C6000'],
    'canon-integrated': ['Canon'],
  };
  
  for (const [format, hints] of Object.entries(defaultMappings)) {
    console.log(`--- ${format} ---`);
    
    const matchingPrinters = printers.filter(p => 
      hints.some(h => p.device.toLowerCase().includes(h.toLowerCase()))
    );
    
    if (matchingPrinters.length > 0) {
      console.log(`Suggested: ${matchingPrinters[0].device}`);
      (config.formats as Record<string, unknown>)[format] = {
        cupsPrinter: matchingPrinters[0].device,
        pageSize: getDefaultPageSize(format),
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        lpOptions: getDefaultLpOptions(format, matchingPrinters[0].device),
      };
    } else {
      console.log(`Available printers: ${printers.map(p => p.device).join(', ')}`);
      const fallbackPrinter = printers[0].device;
      (config.formats as Record<string, unknown>)[format] = {
        cupsPrinter: fallbackPrinter,
        pageSize: getDefaultPageSize(format),
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        lpOptions: getDefaultLpOptions(format, fallbackPrinter),
      };
    }
    
    const stickyRegion = getStickyRegion(format);
    if (stickyRegion) {
      const existing = config.formats[format];
      if (existing) {
        config.formats[format] = { ...existing, stickyRegion };
      }
    }
    console.log('');
  }
  
  const outputPath = path.join(__dirname, '..', 'config', 'printers.json');
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`Written: ${outputPath}\n`);
  
  console.log('Step 3: Test printing...\n');
  console.log('To test, run: npm run test-print -- --format 4x3');
  console.log('\nSetup complete!');
}

function getDefaultPageSize(format: string): { widthIn: number; heightIn: number } {
  const sizes: Record<string, { widthIn: number; heightIn: number }> = {
    '4x3': { widthIn: 4, heightIn: 3 },
    '1.5x1.5': { widthIn: 1.5, heightIn: 1.5 },
    '2.5x1.5': { widthIn: 2.5, heightIn: 1.5 },
    '2.5x0.7': { widthIn: 2.5, heightIn: 0.7 },
    'canon-integrated': { widthIn: 8.5, heightIn: 11 },
  };
  return sizes[format] || { widthIn: 4, heightIn: 3 };
}

function getDefaultLpOptions(format: string, printer: string): string[] {
  const lpOptions: Record<string, string[]> = {
    '4x3': ['-o', 'media=Custom.4x3in', '-o', 'fit-to-page'],
    '1.5x1.5': ['-o', 'media=Custom.1.5x1.5in'],
    '2.5x1.5': ['-o', 'media=Custom.2.5x1.5in'],
    '2.5x0.7': ['-o', 'media=Custom.2.5x0.7in'],
    'canon-integrated': ['-o', 'media=Letter'],
  };
  return lpOptions[format] || [];
}

function getStickyRegion(format: string) {
  if (format === 'canon-integrated') {
    return { xIn: 1.25, yIn: 6.5, widthIn: 6, heightIn: 4 };
  }
  return null;
}

main();