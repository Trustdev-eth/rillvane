# Mountain workspace theme

The app now carries the landing page's green mountain-and-river language into its overview, navigation, page headers, balance cards, and dialogs. Existing logo and token artwork are preserved.

## Files and behavior

The current palette follows the actual landing screenshots: forest `#203727`, moss and olive panels, warm ivory `#e9eddf`, and blue river accents. Neon colors and saturation filters have been removed. See [Landing-page palette match](LANDING_PALETTE.md) for the current artwork, exact prompt, and validation. The original logo files are preserved.

- `dist/mountain.css` owns landscape composition and responsive dashboard layout.
- `dist/theme.css` owns shared semantic colors. Existing app styles consume those colors.
- `dist/workspace.js` renders the mountain overview using the existing account and market data. The overview is the initial app route; explicit hash links still work.
- Fresh local sessions start with expanded desktop navigation. A saved compact-navigation preference is respected.
- Chart candle colors, custom chart preferences, trading actions, and backend code are preserved. Default chart labels and grids use sage/forest colors.
- All eight routes retain their functional controls. The full landscape is reserved for the overview; other headers use a smaller landscape treatment.

## Generated artwork

Created with the built-in image generation tool. The approved concept image was used only as a style reference. The generated asset contains no interface, lettering, logo, or data.

- Source: `brand/artwork/mountain-valley-source.png`, 2172 x 724.
- Desktop: `dist/assets/landscape/mountain-valley.webp`, approximately 133 KiB.
- Mobile and secondary details: `dist/assets/landscape/mountain-valley-small.webp`, approximately 30 KiB.

The source was copied into the project; browser images were resized/encoded to WebP for delivery.

### Final generation prompt

Use case: illustration-story.
Asset type: production background artwork for the Rillvane mountain-themed financial web app, wide panoramic 3:1 composition.
Primary request: Generate ONLY THE LANDSCAPE ARTWORK from the approved green mountain app design shown in the reference. It will be placed behind real HTML interface elements; do not render any interface, lettering, icons, charts, cards, logos, borders, or text.
Reference image role: visual style and color reference only, not an edit target. Reinterpret its misty mountain valley and winding mint river as a standalone panoramic illustration.
Scene: an expansive alpine valley in a sophisticated flat 2D illustrated / fine cut-paper style, softly layered sage-green mountain ridges receding into atmospheric pale mist, one distinctive craggy distant peak right of center with a subtle ivory snowcap, dark evergreen rolling foreground slopes with sparse tiny pine silhouettes, and a beautifully luminous winding mint-green river flowing from the distant middle-right valley towards the lower right edge. Delicate topographic contour strokes in the dark foreground. Beautiful restrained detail, layered flat color shapes with subtle grain, graphic landscape illustration rather than a photograph or 3D render.
Composition: keep the LEFT 40 percent quiet and dark with low contrast forest slopes and subtle mist, suitable behind ivory HTML headline and account balance. The vivid peak, valley and mint river belong in the right 60 percent. Compose the full mountain range comfortably inside the frame; no awkward cutoff of the primary summit. Bottom foreground and outer corners blend into solid deep evergreen #101b17. Top sky is muted pale sage with mist and atmospheric depth. Illustration should remain legible at 400px tall on a desktop dashboard.
Palette: #101b17 darkest evergreen; #203727 forest; #294c36 moss; #7e9d7b sage; mist #c4d4ba; river #95cec0 with ivory highlights #e9eddf. Calm natural daylight, premium editorial artistry, no purple, no neon, no blue sky, no glossy shine.
Constraints: full-bleed standalone original landscape asset, absolutely no text or logos or interface. Opaque background.

## Validation

`npm run check` and `npm run test:ui` pass. Run `node tools/mountain-browser-check.mjs` for the isolated browser smoke check and desktop/mobile screenshots. It starts an in-memory backend, uses a temporary Chrome profile, and does not use the configured application database or keys.

The UI check covers all eight routes, original logo references, artwork loading, navigation, settings dialogs, JavaScript exceptions, and horizontal overflow.

