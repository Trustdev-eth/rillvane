# Landing-page palette match

The app now follows the supplied Rillvane landing screenshots: sunlit olive and moss slopes, deep forest shadows, blue sky/water, and warm ivory type and controls.

## Palette

- Forest background: `#14251a`, a deeper version of the landing page's forest green.
- Primary and secondary interface text: white `#ffffff`.
- Panel surfaces: `#1e3120` and `#283c26`.
- Meadow accents: `#c3d883`, `#a5b56b`, and `#d3d89b`.
- River accents: `#9bbad4`.

The neon lime/turquoise palette, glow, and artwork saturation filters have been removed. Default charts use the same forest/moss palette; saved chart customizations are preserved. Logo assets, landing-page source, and backend behavior are unchanged.

## Sunlit gradient layer

`dist/gradients.css` adds a shared gradient treatment after the mountain stylesheet. It covers workspace chrome, selected navigation, card families, summary cards, primary/secondary/icon buttons, form surfaces, tickets, tables, tabs, toggles, notifications, and dialogs. Surfaces and gradient stops have been gently darkened, while balances and interface text use solid white. Buttons and selected navigation use deeper moss gradients to keep white labels readable. Background gradients use forest, olive, moss, and restrained blue-water colors from the landing imagery. The artwork, logo, market data, saved chart preferences, and backend flows remain intact.

CSS parsing and static source checks passed for this layer. Browser verification and publication are pending because automatic approval review encountered the session usage limit; the live deployment has the earlier landing-matched styling until this layer is published.

The gradient effect is now restrained: color stops sit close together, tint overlays and highlights are lighter, and icon glow is removed. The slightly darker page surfaces and solid white text are preserved.

Surface highlights, active-control fills, button edges, and thin shine overlays now use a low-opacity moss tint instead of a white wash. Interface text remains white.

The remaining pale fills were reduced further: background declarations use a dedicated moss-highlight token instead of the white foreground accent. Surface tint is now 4%, edge tint 18%, and glow/inset shine is mostly removed. Text tokens remain pure white.

## Artwork

Generated with the built-in image generation tool using the user's three landing screenshots as style/color references. Only landscape artwork was generated, without logos, text, or interface elements.

- Source: `brand/artwork/landing-valley-source-v2.png` (2172 x 724).
- Desktop asset: `dist/assets/landscape/landing-valley-v2.webp`.
- Mobile and secondary asset: `dist/assets/landscape/landing-valley-small-v2.webp`.

The generated source was copied into the project and encoded to WebP for delivery. Earlier artwork remains available separately.

### Final generation prompt

Use case: illustration-story.
Asset type: production panoramic landscape background for Rillvane's app dashboard, 3:1 wide composition, no interface.
Reference images: the three user-supplied Rillvane landing-page screenshots are COLOR, MATERIAL, and LANDSCAPE STYLE REFERENCES. Match their actual natural colors closely.
Primary request: create an original wide valley illustration that belongs to the SAME visual world as the references: distinctive angular, steep low-poly mountain spires covered in sunlit moss and grassy olive yellow-green, deep shaded forest-green faces with broad painterly rock/grass textures; a clear soft powder-blue sky and atmospheric pale-blue distant peaks; a winding muted steel-blue / glacial-blue river with fine ivory whitewater. The references feel sculpted, painterly, natural, sunlit and fresh. They are not a neon green forest or a mint river.
Palette targets: deep forest #203727, dark green rock #254839, moss #657b3e, sunlit olive meadow #94a94b and #a9b65c, pale blue sky #9bc4ee, muted blue water #86a6bf, warm ivory #e9eddf highlights. Sunlight creates life through LIGHT and OLIVE YELLOW-GREEN highlights, rather than oversaturation.
Composition: panoramic view through an angular green mountain valley, primary dramatic mountain group in middle/right, a blue river descending through the valley on the far right, enough open pale-blue sky to clearly read as the landing-page world. Quiet darker moss-green rolling foreground on the LEFT 35 percent for ivory HTML heading and balance text. Foreground and lower corners should blend naturally into deep forest #203727. Keep the main summit inside the frame. Modest textured vegetation without dense conifer forest.
Medium/style: stylized low-poly sculptural landscape with broad softly brushed/striated textures and faceted mountain planes, matching the screenshots' painterly low-poly material. Gentle ambient daylight, natural hue variation. Not photorealistic, not a flat vector poster, not a snowy alpine tourism scene.
Constraints: full-bleed standalone artwork ONLY. No text, letters, logo, UI, chart, cards, border, watermark, or screenshot chrome. No neon lime, no emerald/turquoise color cast, no teal water, no snowcaps, no giant pine forest. Do not copy any text or brand mark from references. Opaque background.

## Verification

`npm run test:ui` passes all 12 chart tests. The browser smoke check covers all eight routes on desktop/mobile, artwork loading, the original logo, navigation, settings dialogs, value clipping, and runtime/overflow errors. Screenshots are in `output/landing-match-ui-checks/`.

