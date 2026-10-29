import {mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {loadConfig} from '../backend/config.mjs';
import {openDatabase} from '../backend/database.mjs';
import {ensureProtocol} from '../backend/protocol.mjs';
import {loadRegistry, saveRegistry, emptyRegistry} from '../backend/registry.mjs';
import {MARKET_ID, START_PRICE} from '../backend/math.mjs';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function pubkey() {
  let n = BigInt('0x' + randomBytes(32).toString('hex')), s = '';
  while (n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  return s.padStart(32, '1').slice(0, 44);
}

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
process.umask(0o077);
const config = loadConfig();
const existing = loadRegistry(config.registryPath);
if (existing?.market === MARKET_ID && !process.argv.includes('--force')) {
  process.stdout.write(JSON.stringify({event: 'bootstrap.already_initialized', market: existing.market, registry: config.registryPath}) + '\n');
  process.exit(0);
}

await mkdir(dirname(config.dbPath), {recursive: true});
const db = openDatabase(config.dbPath);
try {
  const prior = db.prepare('SELECT id FROM markets WHERE id=?').get(MARKET_ID);
  if (prior && existing && !process.argv.includes('--force')) {
    process.stdout.write(JSON.stringify({event: 'bootstrap.refused_duplicate', market: MARKET_ID}) + '\n');
    process.exit(1);
  }
  ensureProtocol(db, Date.now());
  const registry = {
    ...emptyRegistry(),
    ...(existing || {}),
    market: MARKET_ID,
    price: START_PRICE.toString(),
    decimals: 6,
    authorities: {
      upgrade: process.env.UPGRADE_AUTHORITY || pubkey(),
      oracle: process.env.ORACLE_AUTHORITY || pubkey(),
      faucet: process.env.FAUCET_AUTHORITY || pubkey(),
      keeper: process.env.KEEPER_AUTHORITY || pubkey()
    },
    rpcUrl: config.rpcUrls[0],
    seeded: true
  };
  saveRegistry(config.registryPath, registry);
  process.stdout.write(JSON.stringify({
    event: 'bootstrap.ok',
    market: MARKET_ID,
    registry: resolve(config.registryPath),
    database: resolve(config.dbPath),
    authorities: Object.keys(registry.authorities)
  }) + '\n');
} finally {
  db.close();
}
