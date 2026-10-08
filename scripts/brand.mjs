// Builds every Perch icon from the SVG sources in brand/src:
//   - the extension's toolbar and store icons (apps/extension/public/icon)
//   - the web reader's favicon, PWA and Apple touch icons (apps/web/public)
//   - iOS: an asset-catalog AppIcon (light, dark, tinted) and the separate
//     layers for Icon Composer (brand/ios); the app's catalog with the icon,
//     logo, mark and accent colour (apps/ios/Perch/Assets.xcassets); the mark
//     again for the widgets (apps/ios/PerchWidgets/Assets.xcassets)
//
// Run after changing anything in brand/src:  npm run brand
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (name) => readFileSync(resolve(ROOT, 'brand/src', name), 'utf8');

function png(svg, size, out) {
  const file = resolve(ROOT, out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  console.log('wrote', out);
}

function text(content, out) {
  const file = resolve(ROOT, out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log('wrote', out);
}

// The inner drawing of a 512-unit mark (everything inside its <svg>).
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const markFull = src('perch-mark-light.svg');
const markSmall = src('perch-mark-small.svg');
const appIcon = src('perch-app-icon.svg');
const appIconFullBleed = src('perch-app-icon-fullbleed.svg');

const NIGHT = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B2030"/><stop offset="1" stop-color="#0A0C12"/></linearGradient>`;

/**
 * The small mark on the night square, for 16–32 px. The bird fills more of the
 * tile than in the big icon, and the corner radius is a bit softer.
 */
const smallTile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>${NIGHT}</defs>
<rect width="512" height="512" rx="112" fill="url(#bg)"/>
<svg x="30" y="30" width="452" height="452" viewBox="39 53 440 440">${inner(markSmall)}</svg>
</svg>`;

// --- Extension ------------------------------------------------------------
png(smallTile, 16, 'apps/extension/public/icon/16.png');
png(smallTile, 32, 'apps/extension/public/icon/32.png');
png(appIcon, 48, 'apps/extension/public/icon/48.png');
png(appIcon, 128, 'apps/extension/public/icon/128.png');

// --- Web reader -------------------------------------------------------------
text(smallTile, 'apps/web/public/favicon.svg');
png(smallTile, 32, 'apps/web/public/favicon-32.png');
png(appIcon, 192, 'apps/web/public/icon-192.png');
png(appIcon, 512, 'apps/web/public/icon-512.png');
// Maskable: full bleed; Android crops it to its own shape.
png(appIconFullBleed, 512, 'apps/web/public/icon-maskable-512.png');
// iOS home screen (Safari "Add to Home Screen") rounds the corners itself.
png(appIconFullBleed, 180, 'apps/web/public/apple-touch-icon.png');

// --- iOS: asset catalog ------------------------------------------------------
// Written to brand/ios and into the app's own catalog (apps/ios).
const ICONSETS = [
  'brand/ios/AppIcon.appiconset',
  'apps/ios/Perch/Assets.xcassets/AppIcon.appiconset',
];
for (const dir of ICONSETS) {
  // Light: the full-bleed icon (iOS applies the mask).
  png(appIconFullBleed, 1024, `${dir}/AppIcon.png`);
  // Dark: the mark on transparency; iOS puts it on its own dark background.
  const darkIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<g transform="translate(128 112) scale(1.5)">${inner(markFull)}</g>
</svg>`;
  png(darkIcon, 1024, `${dir}/AppIcon-Dark.png`);
  // Tinted: greyscale; iOS maps luminance onto the user's tint colour.
  const tintedIcon = darkIcon
    .replace(/#F4F1EA/gi, '#FFFFFF')
    .replace(/#FF7A1A/gi, '#8C8C8C')
    .replace(/#12151C/gi, '#000000')
    .replace('<g ', '<rect width="1024" height="1024" fill="#000"/><g ');
  png(tintedIcon, 1024, `${dir}/AppIcon-Tinted.png`);
  text(
    `${JSON.stringify(
      {
        images: [
          { filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
          {
            appearances: [{ appearance: 'luminosity', value: 'dark' }],
            filename: 'AppIcon-Dark.png',
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
          },
          {
            appearances: [{ appearance: 'luminosity', value: 'tinted' }],
            filename: 'AppIcon-Tinted.png',
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
          },
        ],
        info: { author: 'xcode', version: 1 },
      },
      null,
      2,
    )}\n`,
    `${dir}/Contents.json`,
  );
}

// The app's other assets: the accent colour. The logo and the mark are drawn
// in SwiftUI (apps/ios/Shared/PerchLogoDrawing.swift) so they follow the
// user's colours, like PerchLogo in packages/reader.
const CATALOG = 'apps/ios/Perch/Assets.xcassets';
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const INFO = { author: 'xcode', version: 1 };
text(json({ info: INFO }), `${CATALOG}/Contents.json`);
text(
  json({
    colors: [
      {
        color: {
          'color-space': 'srgb',
          components: { red: '0xFF', green: '0x7A', blue: '0x1A', alpha: '1.000' },
        },
        idiom: 'universal',
      },
    ],
    info: INFO,
  }),
  `${CATALOG}/AccentColor.colorset/Contents.json`,
);

// --- iOS 26: layers for Icon Composer --------------------------------------
// Liquid Glass icons are built from flat layers; Icon Composer adds the glass,
// lighting and the dark / clear / tinted variants. Same 1024 canvas and
// placement as the app icon so the layers line up.
const layer = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n<g transform="translate(128 112) scale(1.5)">\n${body}\n</g>\n</svg>\n`;
const parts = inner(markFull);
const pick = (re) => (parts.match(re) ?? []).join('\n');
text(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n<defs>${NIGHT}</defs>\n<rect width="1024" height="1024" fill="url(#bg)"/>\n</svg>\n`,
  'brand/ios/IconComposer/1-background.svg',
);
text(
  layer(
    [
      pick(/<path d="M 392 176[^>]*\/>/g),
      pick(/<circle cx="338"[^>]*\/>/g),
      pick(/<g stroke="#F4F1EA"[\s\S]*?<\/g>/g),
    ].join('\n'),
  ),
  'brand/ios/IconComposer/2-bird.svg',
);
text(
  layer(
    [
      pick(/<polygon[^>]*\/>/g),
      pick(/<g fill="none" stroke="#FF7A1A"[\s\S]*?<\/g>/g),
      pick(/<circle cx="214"[^>]*\/>/g),
      pick(/<rect[^>]*\/>/g),
    ].join('\n'),
  ),
  'brand/ios/IconComposer/3-accents.svg',
);
