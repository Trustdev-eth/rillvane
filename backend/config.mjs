import {resolve, isAbsolute} from 'node:path';

export const CLUSTER_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

function assertRpcUrl(value) {
  const u = new URL(value);
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.username || u.password) throw new Error('RPC URLs must not embed credentials.');
  if (local) {
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid RPC URL protocol.');
    return;
  }
  if (u.protocol !== 'https:') throw new Error('RPC URLs require HTTPS with no embedded credentials.');
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:8787');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('PUBLIC_ORIGIN must be an origin without credentials or path.');
  }
  if (production && origin.protocol !== 'https:') throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid PUBLIC_ORIGIN protocol.');
  const cluster = env.SOLANA_CLUSTER || 'solana';
  if (cluster === 'mainnet-beta' || cluster === 'mainnet') throw new Error('Mainnet is not enabled.');
  if ((env.EXECUTION_MODE || 'protocol') !== 'protocol') {
    throw new Error('EXECUTION_MODE must be protocol.');
  }
  const rpcUrls = (env.SOLANA_RPC_URLS || env.SOLANA_RPC_URL || 'http://127.0.0.1:8899')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (rpcUrls.length > 2) throw new Error('Configure at most two read-only RPC endpoints.');
  for (const value of rpcUrls) assertRpcUrl(value);
  const opsToken = env.OPS_TOKEN || '';
  if (production && opsToken.length < 32) throw new Error('Set OPS_TOKEN to at least 32 random characters.');
  if (production && (!env.DATABASE_PATH || !isAbsolute(env.DATABASE_PATH))) {
    throw new Error('Set DATABASE_PATH to a persistent mounted volume.');
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const genesis = env.GENESIS_HASH || CLUSTER_GENESIS;
  const faucetLimit = {
    USDC: env.FAUCET_USDC || '10000',
    RLVN: env.FAUCET_RLVN || '100'
  };
  return {
    production,
    origin: origin.origin,
    rpcUrls,
    opsToken,
    dbPath: resolve(env.DATABASE_PATH || 'rillvane.sqlite'),
    port,
    host: env.HOST || '127.0.0.1',
    worker: env.WORKER_ENABLED !== 'false',
    genesis,
    registryPath: resolve(env.REGISTRY_PATH || 'ops/registry.json'),
    keysDir: resolve(env.KEYS_DIR || 'ops/keys'),
    faucetLimit
  };
}
