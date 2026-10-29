import {createHash, randomUUID} from 'node:crypto';

export const migrations = [`
CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,wallet TEXT NOT NULL,message TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,wallet TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(wallet TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests(wallet TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(wallet,key));
`, `
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,event TEXT NOT NULL,wallet TEXT,request_id TEXT NOT NULL,detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_time ON audit(time);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chain_transactions(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,signature TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'unknown',ownership_verified INTEGER NOT NULL DEFAULT 0,slot INTEGER,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(wallet,signature));
CREATE INDEX IF NOT EXISTS tx_wallet_created ON chain_transactions(wallet,created);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL UNIQUE REFERENCES chain_transactions(id) ON DELETE CASCADE,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL,lease_until INTEGER,lease_token TEXT,last_error TEXT);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,available,lease_until);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,wallet TEXT NOT NULL,dedupe TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL,read_at INTEGER);
CREATE INDEX IF NOT EXISTS notice_wallet_id ON notifications(wallet,id);
`, `
CREATE TABLE IF NOT EXISTS markets(
  id TEXT PRIMARY KEY,
  base_symbol TEXT NOT NULL,
  quote_symbol TEXT NOT NULL,
  price TEXT NOT NULL,
  oracle_time INTEGER NOT NULL,
  oracle_slot INTEGER NOT NULL,
  base_cash TEXT NOT NULL,
  quote_cash TEXT NOT NULL,
  quote_debt TEXT NOT NULL,
  base_shares TEXT NOT NULL,
  quote_shares TEXT NOT NULL,
  debt_shares TEXT NOT NULL,
  borrow_index TEXT NOT NULL,
  last_accrual INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  epoch INTEGER NOT NULL DEFAULT 1,
  config_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS protocol_wallets(
  wallet TEXT PRIMARY KEY,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  base_shares TEXT NOT NULL,
  quote_shares TEXT NOT NULL,
  collateral TEXT NOT NULL,
  debt_shares TEXT NOT NULL,
  nonce TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes(
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS intents(
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  nonce TEXT NOT NULL,
  digest TEXT NOT NULL,
  payload TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  quote_id TEXT,
  idempotency TEXT,
  deadline INTEGER NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(wallet,idempotency)
);
CREATE TABLE IF NOT EXISTS protocol_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT,
  slot INTEGER,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS protocol_events_wallet ON protocol_events(wallet,id);
CREATE TABLE IF NOT EXISTS faucet_claims(
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  day TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(wallet,day,asset)
);
CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL,
  price TEXT NOT NULL,
  base_amount TEXT NOT NULL,
  quote_amount TEXT NOT NULL,
  slot INTEGER,
  created INTEGER NOT NULL
);
`, `
ALTER TABLE intents ADD COLUMN signature TEXT;
ALTER TABLE intents ADD COLUMN unsigned_bytes TEXT;
ALTER TABLE intents ADD COLUMN result TEXT;
ALTER TABLE intents ADD COLUMN applied_at INTEGER;
`, `
CREATE INDEX IF NOT EXISTS trades_created_id ON trades(created,id);
`];

export function atomic(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied INTEGER NOT NULL);');
  for (let i = 0; i < migrations.length; i++) {
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(i + 1)) {
      atomic(db, () => {
        db.exec(migrations[i]);
        db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(i + 1, Date.now());
      });
    }
  }
  const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  if (version !== migrations.length) {
    db.close();
    throw new Error('Unsupported database schema version.');
  }
  return db;
}

export const digest = value => createHash('sha256').update(value).digest('hex');

export function audit(db, {event, wallet = null, requestId = randomUUID(), detail = {}, time = Date.now()}) {
  db.prepare('INSERT INTO audit(time,event,wallet,request_id,detail) VALUES(?,?,?,?,?)').run(time, event, wallet, requestId, JSON.stringify(detail));
}

export function rateLimit(db, key, limit, now) {
  const row = db.prepare(`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count,expires`).get(key, now + 60000, now, now);
  return {allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((row.expires - now) / 1000))};
}

export function maintenance(db, now = Date.now()) {
  atomic(db, () => {
    db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    db.prepare('DELETE FROM rate_limits WHERE expires<=?').run(now);
    db.prepare('DELETE FROM notifications WHERE created<?').run(now - 30 * 86400000);
    db.prepare("DELETE FROM chain_transactions WHERE updated<? AND id NOT IN(SELECT transaction_id FROM jobs WHERE state IN ('queued','leased'))").run(now - 30 * 86400000);
    db.prepare('DELETE FROM audit WHERE time<?').run(now - 90 * 86400000);
    db.prepare('DELETE FROM quotes WHERE expires<?').run(now);
  });
}
