export const DEMO_HOURS = 72;
export const DEMO_SEED = 20261029;
export const DEMO_BAR_MS = 300_000;
export const DEMO_START = Date.UTC(2026, 9, 26, 8, 0, 0);
export const DEMO_END = DEMO_START + DEMO_HOURS * 3_600_000;

const MARKS = [
  [0.00, 101.6],
  [0.08, 100.4],
  [0.16, 98.2],
  [0.24, 96.8],
  [0.32, 97.1],
  [0.40, 99.6],
  [0.48, 101.3],
  [0.54, 100.5],
  [0.62, 103.4],
  [0.70, 102.6],
  [0.78, 99.2],
  [0.84, 97.9],
  [0.90, 98.4],
  [0.95, 100.2],
  [1.00, 100.5]
];

const INTERVAL_MS = {'1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000};

export function pathPrice(frac, marks = MARKS) {
  const t = Math.min(1, Math.max(0, frac));
  let i = 0;
  while (i < marks.length - 2 && marks[i + 1][0] < t) i++;
  const [t0, p0] = marks[i];
  const [t1, p1] = marks[i + 1];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return p0 + (p1 - p0) * u;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(price) {
  return Math.min(112, Math.max(90, price));
}

let fiveMin = null;
const rolled = new Map();

function fiveMinSeries() {
  if (fiveMin) return fiveMin;
  fiveMin = new Map();
  const start = DEMO_START, end = DEMO_END, span = Math.max(1, end - start);
  const rand = mulberry32(DEMO_SEED);
  let close = pathPrice(0);
  for (let bar = start; bar < end; bar += DEMO_BAR_MS) {
    const target = pathPrice((bar + DEMO_BAR_MS - start) / span);
    const drift = target - close;
    const falling = drift < -0.02;
    const intensity = Math.min(0.014, Math.max(0.0015, Math.abs(drift) / Math.max(1, close) + 0.0018 + rand() * 0.0024));
    const range = close * intensity;
    const open = close;
    close = clamp(open + drift * (0.4 + rand() * 0.45) + (rand() - 0.5) * range * 0.22);
    const high = Math.min(113, Math.max(open, close) + range * (0.18 + rand() * 0.45));
    const low = Math.max(89, Math.min(open, close) - range * (0.18 + rand() * 0.45));
    const n = falling || intensity > 0.006 ? 7 + Math.floor(rand() * 7) : 5 + Math.floor(rand() * 5);
    const quote = n * (6 + rand() * 14);
    fiveMin.set(bar, {
      time: bar,
      open,
      high,
      low,
      close,
      volume: quote / Math.max(1, close),
      price: close
    });
  }
  return fiveMin;
}

function intervalMs(interval) {
  return INTERVAL_MS[interval] || 3_600_000;
}

export function demoWindow(interval = '1h') {
  const ms = intervalMs(interval);
  const key = String(ms);
  if (rolled.has(key)) return rolled.get(key);
  const source = fiveMinSeries();
  if (ms === DEMO_BAR_MS) {
    rolled.set(key, source);
    return source;
  }
  const buckets = new Map();
  for (const bar of source.values()) {
    const t = Math.floor(bar.time / ms) * ms;
    const bucket = buckets.get(t);
    if (!bucket) {
      buckets.set(t, {time: t, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, price: bar.close});
      continue;
    }
    bucket.high = Math.max(bucket.high, bar.high);
    bucket.low = Math.min(bucket.low, bar.low);
    bucket.close = bar.close;
    bucket.volume += bar.volume;
    bucket.price = bar.close;
  }
  rolled.set(key, buckets);
  return buckets;
}

export function demoCandle(interval, time) {
  const ms = intervalMs(interval);
  const t = Math.floor(Number(time) / ms) * ms;
  if (!Number.isFinite(t) || t < DEMO_START || t >= DEMO_END) return null;
  const row = demoWindow(interval).get(t);
  return row ? {...row} : null;
}

export function demoCandles(interval, from, end) {
  const ms = intervalMs(interval);
  const start = Math.floor(Number(from) / ms) * ms;
  const stop = Math.floor(Number(end) / ms) * ms;
  const items = [];
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return items;
  const window = demoWindow(interval);
  for (let t = start; t <= stop; t += ms) {
    const row = window.get(t);
    if (row) items.push({...row});
  }
  return items;
}
