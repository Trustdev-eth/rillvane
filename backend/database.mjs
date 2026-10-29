import {DatabaseSync, backup} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {atomic, migrate} from './db-util.mjs';
export {migrations, atomic, digest, audit, rateLimit, maintenance} from './db-util.mjs';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return migrate(db);
}

export async function backupDatabase(db, path) {
  await mkdir(dirname(path), {recursive: true});
  await backup(db, path);
  const restored = new DatabaseSync(path, {readOnly: true});
  try {
    if (restored.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup failed integrity verification.');
  } finally {
    restored.close();
  }
  return path;
}
