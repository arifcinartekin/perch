// Builds every Perch icon from the SVG sources in brand/src:
//   - the extension's toolbar and store icons (apps/extension/public/icon)
//   - the web reader's favicon, PWA and Apple touch icons (apps/web/public)
//   - iOS: an asset-catalog AppIcon (light, dark, tinted) and the separate
//     layers for Icon Composer (brand/ios); the app's catalog with the icon,
//     logo, mark and accent colour (apps/ios/Perch/Assets.xcassets); the mark
//     again for the widgets (apps/ios/PerchWidgets/Assets.xcassets)
//   - iOS alternate app icons (Settings → App icon) and their previews
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

// --- iOS: alternate app icons ------------------------------------------------
// Picked in Settings → App icon. Each is the same drawing in other colours; the
// default above stays the one with light, dark and tinted variants. A preview
// of each goes into an image set, since app icon sets can't be shown in the app.
const ALT_ICONS = {
  // Single colour: the waves on the bird take the background's colour.
  Black: {
    bg: ['#000000', '#000000'],
    bird: '#FFFFFF',
    accent: '#FFFFFF',
    waves: '#000000',
    eye: '#000000',
  },
  White: {
    bg: ['#FFFFFF', '#F2F2F2'],
    bird: '#111111',
    accent: '#111111',
    waves: '#FFFFFF',
    eye: '#FFFFFF',
  },
  Green: { bg: ['#14523C', '#08261C'], bird: '#F4F1EA', accent: '#7BE3A6', eye: '#0B2E22' },
  Blue: { bg: ['#1C3E78', '#0A1A38'], bird: '#F4F1EA', accent: '#6CC1FF', eye: '#0C1F42' },
  Midnight: {
    bg: ['#0B0C10', '#000000'],
    bird: '#262A35',
    accent: '#3C4252',
    waves: '#4A5163',
    eye: '#000000',
  },
};
const birdBody = inner(markFull);
for (const [name, c] of Object.entries(ALT_ICONS)) {
  const waves = c.waves ?? c.accent;
  const body = birdBody
    .replace(/#F4F1EA/gi, '@BIRD@')
    // The waves and their dot sit on the bird; the beak and perch sit on the
    // background. Mark the waves first so each can take its own colour.
    .replace(/<g fill="none" stroke="#FF7A1A"/i, `<g fill="none" stroke="${waves}"`)
    .replace(/(<circle cx="214"[^>]*fill=")#FF7A1A/i, `$1${waves}`)
    .replace(/#FF7A1A/gi, c.accent)
    .replace(/#12151C/gi, c.eye)
    .replace(/@BIRD@/g, c.bird);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/></linearGradient></defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<g transform="translate(128 112) scale(1.5)">${body}</g>
</svg>`;
  const set = `apps/ios/Perch/Assets.xcassets/AppIcon-${name}.appiconset`;
  png(svg, 1024, `${set}/AppIcon-${name}.png`);
  text(
    `${JSON.stringify(
      {
        images: [
          {
            filename: `AppIcon-${name}.png`,
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
    `${set}/Contents.json`,
  );
}
// The same colourings for Android's alternate launcher icons (activity
// aliases in the manifest, picked in Settings → Appearance): the default's
// vector layers with the colours swapped.
const ANDROID_RES = 'apps/android/app/src/main/res';
const androidForeground = readFileSync(
  resolve(ROOT, `${ANDROID_RES}/drawable/ic_launcher_foreground.xml`),
  'utf8',
);
const argb = (hex) => `#FF${hex.slice(1).toUpperCase()}`;
for (const [name, c] of Object.entries(ALT_ICONS)) {
  const key = name.toLowerCase();
  const waves = c.waves ?? c.accent;
  const foreground = androidForeground
    .replace(
      /<!--.*?-->/s,
      `<!-- The Perch mark in the ${name} colours (scripts/brand.mjs, ALT_ICONS). -->`,
    )
    .replace(/#FFF4F1EA/g, '@BIRD@')
    // The waves and their dot sit on the bird; the beak and perch on the background.
    .replace(/strokeColor="#FFFF7A1A"/g, `strokeColor="${argb(waves)}"`)
    .replace(
      /fillColor="#FFFF7A1A" android:pathData="M200,330/,
      `fillColor="${argb(waves)}" android:pathData="M200,330`,
    )
    .replace(/#FFFF7A1A/g, argb(c.accent))
    .replace(/#FF12151C/g, argb(c.eye))
    .replace(/@BIRD@/g, argb(c.bird));
  text(foreground, `${ANDROID_RES}/drawable/ic_launcher_foreground_${key}.xml`);
  text(
    `<?xml version="1.0" encoding="utf-8"?>
<!-- The ${name} icon's background (scripts/brand.mjs, ALT_ICONS). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
  <path android:pathData="M0,0h108v108h-108z">
    <aapt:attr name="android:fillColor">
      <gradient android:type="linear" android:startX="54" android:startY="0" android:endX="54" android:endY="108">
        <item android:offset="0" android:color="${argb(c.bg[0])}" />
        <item android:offset="1" android:color="${argb(c.bg[1])}" />
      </gradient>
    </aapt:attr>
  </path>
</vector>
`,
    `${ANDROID_RES}/drawable/ic_launcher_background_${key}.xml`,
  );
  text(
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background_${key}" />
  <foreground android:drawable="@drawable/ic_launcher_foreground_${key}" />
  <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`,
    `${ANDROID_RES}/mipmap-anydpi/ic_launcher_${key}.xml`,
  );
}

// Previews for the picker, the default included.
const previews = {
  Default: appIconFullBleed,
  ...Object.fromEntries(
    Object.keys(ALT_ICONS).map((name) => [
      name,
      readFileSync(
        resolve(
          ROOT,
          `apps/ios/Perch/Assets.xcassets/AppIcon-${name}.appiconset/AppIcon-${name}.png`,
        ),
      ),
    ]),
  ),
};
for (const [name, source] of Object.entries(previews)) {
  const set = `apps/ios/Perch/Assets.xcassets/IconPreview-${name}.imageset`;
  const file = resolve(ROOT, `${set}/IconPreview-${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  if (typeof source === 'string') {
    writeFileSync(
      file,
      new Resvg(source, { fitTo: { mode: 'width', value: 240 } }).render().asPng(),
    );
  } else {
    // Already a PNG: draw it smaller through an <image>.
    const data = `data:image/png;base64,${source.toString('base64')}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024"><image href="${data}" width="1024" height="1024"/></svg>`;
    writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: 240 } }).render().asPng());
  }
  console.log('wrote', `${set}/IconPreview-${name}.png`);
  text(
    `${JSON.stringify(
      {
        images: [{ filename: `IconPreview-${name}.png`, idiom: 'universal' }],
        info: { author: 'xcode', version: 1 },
      },
      null,
      2,
    )}\n`,
    `${set}/Contents.json`,
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

// --- GitHub social preview ------------------------------------------------
// 1280×640 (Settings → General → Social preview): the horizontal logo on the
// night gradient, with the one-line description under it.
const socialPreview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640">
<defs>${NIGHT}</defs>
<rect width="1280" height="640" fill="url(#bg)"/>
<svg x="230" y="130" width="820" height="254" viewBox="90 100 1550 480">${inner(src('perch-logo-horizontal-on-dark.svg'))}</svg>
<text x="640" y="470" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="40" fill="#F4F1EA">A calm, private feed reader</text>
<text x="640" y="526" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="26" fill="#F4F1EA" fill-opacity="0.6">No account · No tracking · Your library stays on your device</text>
</svg>`;
png(socialPreview, 1280, 'brand/social-preview.png');
