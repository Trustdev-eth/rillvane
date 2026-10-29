import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {MARKET_ID, START_PRICE} from './math.mjs';

export function emptyRegistry() {
  return {
    market: MARKET_ID,
    programId: '11111111111111111111111111111111',
    baseMint: 'RLVN1111111111111111111111111111111111111',
    quoteMint: 'USDC1111111111111111111111111111111111111',
    baseVault: 'BVlt11111111111111111111111111111111111111',
    quoteVault: 'QVlt11111111111111111111111111111111111111',
    oracle: 'Orcl11111111111111111111111111111111111111',
    config: 'Cfg111111111111111111111111111111111111111',
    price: START_PRICE.toString(),
    decimals: 6,
    authorities: {upgrade: '', oracle: '', faucet: '', keeper: ''}
  };
}

export function loadRegistry(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data?.market || !data?.programId) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveRegistry(path, registry) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n');
  return registry;
}

export function requireRegistry(path, production) {
  const registry = loadRegistry(path);
  if (registry) return registry;
  if (production) throw new Error('Protocol registry is missing. Run scripts/bootstrap.mjs.');
  if (!path) return emptyRegistry();
  if (existsSync(path)) throw new Error('Protocol registry is invalid.');
  return emptyRegistry();
}
