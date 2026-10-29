import {DurableObject} from 'cloudflare:workers';
import {createApplication} from '../backend/app.mjs';
import {openDurableDatabase} from '../backend/durable-db.mjs';
import {loadKeypairFromSecret} from '../backend/chain.mjs';
import registry from '../ops/registry.json';

function loadKeys(env) {
  return {
    deployer: loadKeypairFromSecret(env.DEPLOYER_KEYPAIR),
    oracle: loadKeypairFromSecret(env.ORACLE_KEYPAIR),
    faucet: loadKeypairFromSecret(env.FAUCET_KEYPAIR),
    keeper: loadKeypairFromSecret(env.KEEPER_KEYPAIR)
  };
}

function isOriginPath(pathname) {
  return pathname.startsWith('/api/') || pathname === '/livez' || pathname === '/readyz';
}

const ORIGIN_BUILD = 'deploy-3';
const ALARM_MS = 15_000;

function isHealthPath(pathname) {
  return pathname === '/livez' || pathname === '/readyz' || pathname === '/api/health';
}

function jsonError(status, error) {
  return new Response(JSON.stringify({ok: false, error}), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-rillvane-build': ORIGIN_BUILD}
  });
}

export class RillvaneOrigin extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.app = null;
    this.build = '';
  }

  ensureApp() {
    if (this.app && this.build === ORIGIN_BUILD) return this.app;
    if (this.app) {
      try { this.app.stream.stop(); } catch { /* replaced */ }
    }
    this.build = ORIGIN_BUILD;
    const db = openDurableDatabase(this.ctx.storage);
    this.app = createApplication({
      db,
      origin: this.env.PUBLIC_ORIGIN || '',
      fetchRpc: (url, init) => globalThis.fetch(url, init),
      rpcUrl: this.env.SOLANA_RPC_URL || 'https://rpc.magicblock.app/devnet',
      rpcUrls: (this.env.SOLANA_RPC_URLS || this.env.SOLANA_RPC_URL || 'https://rpc.magicblock.app/devnet').split(',').map(value => value.trim()).filter(Boolean),
      opsToken: this.env.OPS_TOKEN || '',
      workerEnabled: false,
      production: true,
      registry,
      keys: loadKeys(this.env),
      faucetLimit: {
        USDC: this.env.FAUCET_USDC || '10000',
        RLVN: this.env.FAUCET_RLVN || '100'
      },
      streamTimers: false,
      logger: entry => console.log(JSON.stringify(entry))
    });
    this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    return this.app;
  }

  async alarm() {
    try {
      const app = this.ensureApp();
      await app.worker.tick();
      app.stream.tick();
      app.stream.pingAll();
    } catch (error) {
      console.log(JSON.stringify({level: 'error', event: 'durable.alarm', error: error.message}));
    } finally {
      try { await this.ctx.storage.setAlarm(Date.now() + ALARM_MS); } catch { /* retry next request */ }
    }
  }

  async fetch(request) {
    let app;
    try { app = this.ensureApp(); }
    catch (error) {
      console.log(JSON.stringify({level: 'error', event: 'durable.ensure', error: error.message}));
      return jsonError(503, error.message || 'Origin failed to start.');
    }
    const path = new URL(request.url).pathname;
    if (!isHealthPath(path)) {
      try { await app.worker.tick(); } catch (error) {
        console.log(JSON.stringify({level: 'error', event: 'durable.fetch_tick', error: error.message}));
      }
    }
    app.adoptOrigin(request);
    const ip = request.headers.get('x-rillvane-ip') || 'unknown';
    if (String(request.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
      const gate = app.stream.canUpgrade({ip, origin: request.headers.get('origin')});
      if (!gate.ok) {
        return new Response(JSON.stringify({error: gate.error}), {
          status: gate.status,
          headers: {'content-type': 'application/json; charset=utf-8'}
        });
      }
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      server.accept();
      app.stream.attachBrowser(server, {
        ip,
        cookie: request.headers.get('cookie') || '',
        origin: request.headers.get('origin')
      }, true);
      return new Response(null, {status: 101, webSocket: client});
    }
    try {
      const response = await app.handleFetch(request, {ip});
      return response || jsonError(404, 'Not found.');
    } catch (error) {
      console.log(JSON.stringify({level: 'error', event: 'durable.fetch', error: error.message}));
      return jsonError(500, error.message || 'Origin request failed.');
    }
  }
}

function fillMarkCandles(data, mark = 100) {
  const ms = {'5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000}[data.interval] || 3_600_000;
  const from = Number(data.from), end = Number(data.end);
  if (!Number.isFinite(from) || !Number.isFinite(end) || end < from) return data;
  const items = [];
  for (let t = from; t <= end; t += ms) {
    items.push({time: t, open: mark, high: mark, low: mark, close: mark, volume: 0, price: mark});
  }
  return {...data, earliest: data.earliest ?? from, items};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!isOriginPath(url.pathname)) return env.ASSETS.fetch(request);
    try {
      const headers = new Headers(request.headers);
      headers.set('x-rillvane-ip', request.headers.get('cf-connecting-ip') || 'unknown');
      const id = env.RILLVANE_ORIGIN.idFromName('origin');
      const response = await env.RILLVANE_ORIGIN.get(id).fetch(new Request(request, {headers}));
      if (response.status === 101 || response.webSocket) return response;
      let payload = response;
      if (request.method === 'GET' && url.pathname === '/api/v1/candles') {
        try {
          const data = await response.clone().json();
          if (Array.isArray(data.items) && data.items.length === 0) {
            payload = new Response(JSON.stringify(fillMarkCandles(data)), {
              status: 200,
              headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
            });
          }
        } catch { /* origin response is authoritative */ }
      }
      const out = new Response(payload.body, payload);
      out.headers.set('x-rillvane-build', ORIGIN_BUILD);
      return out;
    } catch (error) {
      console.log(JSON.stringify({level: 'error', event: 'worker.fetch', error: error.message}));
      return jsonError(503, error.message || 'Origin unavailable.');
    }
  }
};
