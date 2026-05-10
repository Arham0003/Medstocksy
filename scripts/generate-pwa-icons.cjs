/**
 * Generates proper PWA icons from public/medstocksy-logo.png.
 * Outputs square PNGs at 192, 512, 180 (apple-touch), and a maskable variant
 * with safe-zone padding so the logo isn't clipped on Android adaptive icons.
 *
 * Usage: npm run pwa:icons
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const SRC = path.join(PUBLIC, 'medstocksy-logo.png');

if (!fs.existsSync(SRC)) {
  console.error('Missing source:', SRC);
  process.exit(1);
}

const targets = [
  { name: 'pwa-192x192.png',     size: 192, maskable: false },
  { name: 'pwa-512x512.png',     size: 512, maskable: false },
  { name: 'pwa-512x512-maskable.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
  { name: 'favicon-32.png',      size: 32,  maskable: false },
  { name: 'favicon-16.png',      size: 16,  maskable: false },
];

(async () => {
  for (const t of targets) {
    const out = path.join(PUBLIC, t.name);
    if (t.maskable) {
      // Maskable icons: logo at ~80% of canvas, white background — safe area
      const inner = Math.round(t.size * 0.8);
      const pad = Math.round((t.size - inner) / 2);
      const resized = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).toBuffer();
      await sharp({
        create: { width: t.size, height: t.size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite([{ input: resized, top: pad, left: pad }])
        .png({ compressionLevel: 9 })
        .toFile(out);
    } else {
      await sharp(SRC)
        .resize(t.size, t.size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png({ compressionLevel: 9 })
        .toFile(out);
    }
    const stat = fs.statSync(out);
    console.log(`✓ ${t.name.padEnd(28)} ${t.size}×${t.size}  ${(stat.size / 1024).toFixed(1)} KB`);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
