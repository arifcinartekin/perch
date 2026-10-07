# Perch brand

A bird on a perch, with an RSS wave for a wing. Every icon in the repo is
generated from the SVGs in `src/` — edit those, then run:

```bash
npm run brand
```

## Colours

| Name  | Hex                 | Used for                                                            |
| ----- | ------------------- | ------------------------------------------------------------------- |
| Ember | `#FF7A1A`           | Beak, waves, perch. The default accent and button colour.           |
| Ink   | `#12151C`           | The bird on light backgrounds; text in light mode; labels on ember. |
| Cream | `#F4F1EA`           | The bird on dark backgrounds; text in dark mode.                    |
| Night | `#1B2030 → #0A0C12` | The app icon and the dark theme's background gradient.              |

The same values live in code as `BRAND` in `packages/core/src/theme.ts`; the
iOS app should read them from one place too. Ember is not a text colour on
light backgrounds (2.6:1) — use the darker `--accent-text` (`#B35512`, 4.6:1),
which the theme derives automatically for any accent.

## Sources

| File                           | What                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `perch-mark-light.svg`         | The mark for dark backgrounds (cream bird).                     |
| `perch-mark-dark.svg`          | The mark for light backgrounds (ink bird).                      |
| `perch-mark-mono.svg`          | One colour, for stamps and system tinting.                      |
| `perch-mark-small.svg`         | Simplified for 16–32 px: no legs, one thick wave, bigger perch. |
| `perch-logo-horizontal-*.svg`  | Bird with the "perch" wordmark; on-light, on-dark and mono.     |
| `perch-logo-stacked-*.svg`     | The same, wordmark under the bird.                              |
| `perch-app-icon.svg`           | The app icon with rounded corners (extension, PWA).             |
| `perch-app-icon-fullbleed.svg` | Square, for platforms that apply their own mask (iOS, Android). |

In the apps the mark is drawn by `PerchMark` and the horizontal logo by
`PerchLogo` (`packages/reader`), coloured by the theme so they follow a custom
accent. On light the perch is ink and the eye cream; on dark the perch is ember
and the eye ink, as in the files.

## Generated

- `apps/extension/public/icon/` — 16/32 px use the small mark on a night tile;
  48/128 px the app icon.
- `apps/web/public/` — `favicon.svg`, `favicon-32.png`, `icon-192/512.png`,
  `icon-maskable-512.png`, `apple-touch-icon.png`.
- `apps/ios/Perch/Assets.xcassets/` — the iPhone app's icon, `PerchLogo` and
  `PerchMark` (vector, with dark variants) and `AccentColor`.
- `ios/AppIcon.appiconset/` — the same icon set, to drop into another asset catalog. Light, dark
  (mark on transparency; iOS draws its own dark background) and tinted
  (greyscale; iOS maps luminance to the user's tint).
- `ios/IconComposer/` — the icon as three flat layers for iOS 26's Liquid
  Glass icons: `1-background.svg`, `2-bird.svg`, `3-accents.svg`. Import them
  into Icon Composer (Xcode 26) in that order to build `AppIcon.icon`; Icon
  Composer adds the glass, specular highlights and the dark / clear / tinted
  variants. Keep the layers flat — no baked-in shadows or gradients on the bird.
