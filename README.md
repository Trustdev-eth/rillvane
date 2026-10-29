# Rillvane — Capital, connected

A scroll-controlled landscape study made to reproduce the movement and section choreography of the user's Everswap reference. The application code and user interface are implemented here; the published Everswap camera, landscape, and texture assets are retained as the visual and motion reference. This is an independent frontend, not an official Everswap application.

## Run

Serve `dist/` over HTTP. ES modules and the software renderer's module worker require HTTP. Everything needed by the browser is served from this project; there are no third-party runtime CDN requests and no dependency installation or build step.

## Implementation

- `dist/app.js`: responsive camera sampling, reversible scroll timeline, section reveals, chapter navigation, guided journey, and keyboard-accessible menu.
- `dist/webgl.js`: Three.js rendering, flow-map river advection, normal-map lake refraction and reflections, vertex waves, 24 instanced current strands, and a bloom composite. Every material is exercised before the loader closes; rejected GPU programs select the software renderer.
- `dist/render-worker.js`: textured software rasterizer for devices without WebGL. Uses the same camera matrices and geometry, with simpler shading and water movement.
- `dist/buffer.js`: binary geometry and track decoder.
- `dist/style.css`: responsive typography and layout.
- `dist/title-surface.js`: projected matte headline with a restrained warm light response.
- `tools/check-shaders.py`: actual GLSL ES 3 shader compilation and linking through a surfaceless EGL context. The prefix matches Three.js WebGL 2 shader conversion.

The timeline is 20.75 viewports tall, with 19.75 viewports of camera travel. Summit camera frames and mobile focal tracks come from the reference's 450-frame animation. The river uses the same top-down traverse. The lake uses its 120-frame position, quaternion, and focal animation. Section transitions, title splits, line drawings, role sequencing, and the final portal follow the reference's scroll intervals. The five navigation stops are the summit, One Pool, the river journey (including audience callouts), ReDeFined, and One Pool / Every Function. ReDeFined opens the lake through an animated water-refraction pass.

The bird follows the published flight path and its two-weight, 21-bone animation in both rendering modes. The headline is painted on a perspective-projected canvas anchored at the same 0.112 track position. Hover gently lifts the matte face color without erasure, distortion, or destructive trails. One Pool draws the original vertical divider before opening into a glass diamond, with a staggered horizontal subtitle. The river transition clears before “Where liquidity Flows” appears without geometric lines. At the section’s midpoint, the title moves upward while three staggered squares draw below it; title, squares, center mark, and description remain visible together. Each outline uses its own normalized path length and becomes a solid closed stroke before the center mark appears, avoiding seams from transformed SVG dashes. The title and squares are smaller, and their expanded positions reserve measured gaps above and below the diagram, fitting inside the header and footer even on short screens. The glass face strengthens only during the expanded diagram. Chapter links land on the complete title, and scrolling backward reverses the composition. The final landscape contracts into a live diamond window on a dark green background. The reference's full postprocessing stack and original title extrusion have not been copied; this version uses its own lighter bloom and surface effects. The software renderer preserves camera motion with simpler lighting.

## Reference and third-party assets

- Design, camera tracks, and scene assets: [Everswap](https://everswap.com/), created by [Lusion](https://lusion.co/projects/everswap/). Those assets retain their respective owners' rights.
- Cormorant Garamond: SIL Open Font License, bundled in `assets/fonts/cormorant-OFL.txt`. Retained for earlier display styles; current landing headings use DM Sans.
- DM Sans: Open Font License.
- Three.js r186: MIT, license notices preserved in the vendor files.

The hosting audience is managed in Sites. Replace reference-owned assets and obtain appropriate font/asset licensing before using them in a public production brand.

## Verification

Run `npm run check`. On Linux with Mesa/EGL installed, `npm run check:shaders` also compiles and links the shader programs as GLSL ES 3. The reserved GLSL ES 3 identifier that previously prevented the river material from compiling has been removed. Browser QA should inspect forward and backward scrolling, all five chapter links, the menu, guided journey controls, the final reveal, and a narrow viewport. The cloud browser in this session has no WebGL context, so its visual checks exercise the software path. The GPU path requires a WebGL-capable browser for full effect and performance verification.

## Product website and app UI

The landing page presents its tokenized-asset concept entirely through the original animated landscape journey. The added product sections and product-discovery links have been removed. Header and journey CTAs open `/app/`. Cormorant Garamond display headings pair with readable DM Sans supporting text, with responsive spacing and weights. The canvas headline uses the same computed font settings as the layout.

The buildless app uses `workspace.js`, `workspace-data.js`, and `workspace.css` with eight hash routes: Overview, Markets, Trade, Earn, Borrow, Portfolio, Activity, and Risk overview. The live market is **RLVN / USDC**: oracle-priced inventory pool, market exact-in swaps, single-asset NAV supply, and RLVN-collateral USDC credit (50% LTV, 60% liquidation, 8% APR). Connect a wallet, sign each instruction, and load balances from `/api/v1`.

Candles and tape come from executed swaps. Empty history stays empty. Limit orders and fabricated depth are not part of this market.

App QA covers signed quotes and intents, faucet, supply, swap, borrow/repay, filtering, stress scenarios, mobile navigation, and responsive layouts. Landing QA covers the retained journey, Flows title and square sequence, closing scene, responsive typography, chapter navigation, and app links.


## Trading desk and protocol detail update

The landing page retains the same seven scenes and 20.75-viewport scroll timeline. One Pool now introduces the original split title before the contextual explanations appear in the same landscape. Flows and Risk include contextual detail, and role scenes explain supply, execution, and collateral more clearly. `protocol-notes.js` and `protocol.css` provide an accessible in-place reader with six protocol topics; opening it pauses guided travel. No conventional product sections or additional scroll scenes were added.

The app uses the Blueworld near-black navy and cyan trading-desk theme in `desk.css`. The spot terminal is market exact-in for RLVN/USDC: oracle price, pool inventory, fee, and impact from `/api/v1` quotes. Depth is pool cash, not a CLOB. Charts fill from settled trades.

Supply uses a compact market table with utilization, cash, and per-account NAV shares. Overview, markets, credit, portfolio, activity, and risk share the same theme. Cloudflare remains static-only; the Node origin on port 8787 is the API.

Validation includes JavaScript checks, candle tests on executed-trade history, and backend protocol tests for faucet-to-withdraw.

## Rillvane update

The identity is Rillvane, ticker RLVN. Landing typography uses DM Sans with a matte ivory hero. The app palette follows the Blueworld reference: navy `#030b1b`, pale text `#d8e0ff`, cyan `#65dcff`, muted text `#96a5bf`.

```sh
node scripts/bootstrap.mjs
npm run backend
```

Opens `http://localhost:8787/app/`. See [backend/README.md](backend/README.md). Run `npm run test:backend` for protocol tests. Mainnet is disabled. The static Sites host does not run this API.

The `brand/` folder contains the SVG logo, square 1000px token image, metadata template and [launch preparation notes](brand/LAUNCH.md). RLVN has not been created. Proposed naming remains subject to final clearance, and reference-owned assets need permission or replacement before production.

## High-contrast app palette

`dist/theme.css` owns the current app colors: graphite surfaces, near-white text, acid-lime navigation and key actions, electric cyan bids/up candles and vivid orange asks/down candles. Candle wicks and volume bars are more visible; chart labels, order-book quantities, secondary text, controls, dialogs and account screens use brighter contrast. Market sparklines and overview allocation graphics share the same semantic colors. The landing page and all trading/backend behavior are unchanged by this palette update.

## GitHub Dark reference update

The current app palette in `dist/theme.css` follows the two supplied GitHub Dark SVG swatches: near-black `#010409`, off-white `#e6edf3`, secondary text `#b1bac4`, blue `#58a6ff`, bright green `#56d364`, coral `#ff7b72`, gold `#e3b341`, purple `#bc8cff`, and coral active indicators `#f78166`. Neutral raised surfaces separate the chart, order book, ticket and account panels. The same palette applies to app navigation, dialogs, sparklines, allocation graphics and directional order states.

## Terminal interaction update

The latest terminal uses the supplied second reference: a pure black chart with vivid green/red translucent outlined candles and restrained indigo/purple workspace controls. The trading layout adds a compact expandable navigation rail, measured chart sizing, hide/show depth, a chart focus mode, a clearer pay/receive ticket and progressive execution details. `dist/chart-preferences.js` provides persistent candle body/border/wick controls. `dist/terminal-ux.css` owns the layout and theme.

Run `npm run test:ui` for chart preference validation and `npm run test:backend` for the protocol suite. Economics are in [docs/ECONOMICS.md](docs/ECONOMICS.md).

## App motion and origin service

The app uses locally hosted Manrope for interface text and DejaVu Sans Mono for trading values (licenses in `dist/assets/fonts`). `app-motion.js`/`.css` add tab indicators, switch motion, route transitions, dialog/button feedback, async busy states and dismissible notifications. Reduced-motion preferences disable transitions. The animated landing journey remains unchanged.

The Node origin includes migrations, durable rate buckets, audit records, operator metrics, readiness, verified RPC failover, leased signature tracking, per-wallet notifications, oracle/liquidation workers and verified online backups. See [ops/RUNBOOK.md](ops/RUNBOOK.md). The published Site is still static; this Node service needs a separate runtime.

## Dialog layout and scrollbars

`dist/dialogs.css` supplies the shared workspace dialog treatment. The header and action footer stay visible while only the middle content scrolls, including on short screens. Deposit/withdraw tabs have 44px targets and balanced padding; fields, review summaries, settings, notices and picker rows share consistent spacing. App scrollbars use a muted, slim thumb across dialogs, tables, depth/tape, lists and the market strip. Native dialog semantics and the existing motion/reduced-motion behavior are preserved.

## Connected frontend and backend

For VPS hosting, use [the VPS setup guide](docs/VPS_HOSTING.md). The landing page runs at `https://rillvane.trade/`; the app opens directly at `https://app.rillvane.trade/`, with its API and WebSocket on the same app origin. `ops/Caddyfile`, `ops/vps.env.example` and `ops/rillvane.service` provide the configuration. Local development retains `/app/`.

The local mountain UI now uses the same-origin protocol API, wallet sessions, signed quotes/intents, and live market stream. Start the combined server with `npm run dev`; the default app URL is `http://localhost:8787/app/`. The combined Worker deployment is `https://rillvane.onchainme.workers.dev/app/`. See [frontend/backend integration](docs/FRONTEND_BACKEND.md) for setup, build, deployment, and verification.
