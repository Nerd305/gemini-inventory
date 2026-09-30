import fs from 'fs';
import path from 'path';

const versionFilePath = path.join(process.cwd(), 'src/lib/version.ts');
const packageJsonPath = path.join(process.cwd(), 'package.json');
const indexHtmlPath = path.join(process.cwd(), 'index.html');

function bump() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const currentVersion = pkg.version;
  const parts = currentVersion.split('.').map(Number);
  parts[2] += 1;
  const nextVersion = parts.join('.');

  pkg.version = nextVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

  fs.writeFileSync(versionFilePath, `export const APP_VERSION = '${nextVersion}';\n`);

  // Keep the browser tab title in step with the badge shown in the UI.
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    fs.writeFileSync(indexHtmlPath, html.replace(/<title>[^<]*<\/title>/, `<title>VialTrack AI v${nextVersion}</title>`));
  }

  console.log(`Version bumped from ${currentVersion} to ${nextVersion}`);
}

bump();
