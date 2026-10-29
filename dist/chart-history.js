export const HISTORY_HOURS = 72;
export const HISTORY_MS = HISTORY_HOURS * 3_600_000;
export const HISTORY_SEED = 20261029;

export const MARKS = [
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function roundPrice(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function pathPrice(frac, marks = MARKS) {
  const t = Math.min(1, Math.max(0, frac));
  let i = 0;
  while (i < marks.length - 2 && marks[i + 1][0] < t) i++;
  const [t0, p0] = marks[i];
  const [t1, p1] = marks[i + 1];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return p0 + (p1 - p0) * u;
}

function clamp(price) {
  return Math.min(112, Math.max(90, price));
}

export function historyStart(now = Date.now()) {
  return now - HISTORY_MS;
}

export function demoCandle(time, ms, now = Date.now()) {
  const start = historyStart(now);
  if (!Number.isFinite(time) || !Number.isFinite(ms) || ms <= 0) return null;
  if (time + ms <= start || time > now) return null;
  const span = Math.max(1, HISTORY_MS);
  const fracOpen = Math.min(1, Math.max(0, (time - start) / span));
  const fracClose = Math.min(1, Math.max(0, (time + ms - start) / span));
  const rand = mulberry32((Math.floor(time / ms) ^ HISTORY_SEED) >>> 0);
  const targetOpen = pathPrice(fracOpen);
  const targetClose = pathPrice(fracClose);
  const open = clamp(targetOpen);
  const close = clamp(open + (targetClose - open) * (0.4 + rand() * 0.45) + (rand() - 0.5) * Math.max(0.05, Math.abs(targetClose - open)) * 0.22);
  const range = Math.max(0.08, Math.abs(close - open) * (0.9 + rand() * 0.8) + 0.05 + rand() * 0.12);
  const high = Math.min(113, Math.max(open, close) + range * (0.18 + rand() * 0.45));
  const low = Math.max(89, Math.min(open, close) - range * (0.18 + rand() * 0.45));
  const volume = roundPrice(4 + rand() * 18 + (rand() < 0.08 ? 12 + rand() * 20 : 0));
  return {
    time,
    open: roundPrice(open),
    high: roundPrice(high),
    low: roundPrice(low),
    close: roundPrice(close),
    volume,
    price: roundPrice(close),
    empty: false,
    demo: true
  };
}

export function fillCandleWindow({from, end, ms, now = Date.now(), traded = []} = {}) {
  const items = [];
  if (!Number.isFinite(from) || !Number.isFinite(end) || !Number.isFinite(ms) || ms <= 0 || end < from) return items;
  const byTime = new Map();
  for (const row of traded) {
    const time = Number(row?.time);
    const close = Number(row?.close ?? row?.price);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    byTime.set(time, row);
  }
  let prev = null;
  let seenReal = false;
  for (let t = from; t <= end; t += ms) {
    const hit = byTime.get(t);
    if (hit) {
      const open = Number(hit.open ?? hit.close ?? hit.price);
      const close = Number(hit.close ?? hit.price);
      const high = Number(hit.high ?? Math.max(open, close));
      const low = Number(hit.low ?? Math.min(open, close));
      prev = close;
      seenReal = true;
      items.push({
        ...hit,
        time: t,
        open,
        high,
        low,
        close,
        volume: Number(hit.volume || 0),
        price: close,
        empty: false
      });
      continue;
    }
    if (seenReal && prev != null) {
      items.push({time: t, open: prev, high: prev, low: prev, close: prev, volume: 0, price: prev, empty: false});
      continue;
    }
    const demo = demoCandle(t, ms, now);
    if (demo) {
      prev = demo.close;
      items.push(demo);
    } else {
      items.push({time: t, open: null, high: null, low: null, close: null, volume: 0, empty: true});
    }
  }
  return items;
}
