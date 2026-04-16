import sharp from 'sharp';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

const svgPath = './assets/icon.svg';
const pngPath = './assets/icon.png';
const icnsPath = './assets/icon.icns';
const iconsetDir = './assets/icon.iconset';

async function generateIcon() {
  const svg = await fs.readFile(svgPath);

  await fs.mkdir(iconsetDir, { recursive: true });

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(`${iconsetDir}/${size}x${size}.png`);
    if (size <= 512) {
      await sharp(svg)
        .resize(size * 2, size * 2)
        .png()
        .toFile(`${iconsetDir}/${size}x${size}@2x.png`);
    }
    console.log(`Generated ${size}x${size} PNG`);
  }

  await sharp(svg)
    .resize(1024, 1024)
    .png()
    .toFile(pngPath);
  console.log('Generated 1024x1024 PNG');

  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
    console.log('Generated icon.icns');
  } catch (e) {
    console.log('iconutil not available, using PNG only');
  }

  console.log('Done! Use desktop/assets/icon.png in electron-builder.yml');
}

generateIcon();