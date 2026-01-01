import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '..', 'icon.svg');
const distPath = join(__dirname, '..', 'dist');

const sizes = [16, 32, 48, 128];

// Read SVG and replace currentColor with white for dark backgrounds
let svg = readFileSync(svgPath, 'utf8');
svg = svg.replace(/currentColor/g, '#ffffff');

mkdirSync(distPath, { recursive: true });

for (const size of sizes) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(distPath, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}

console.log('Done!');
