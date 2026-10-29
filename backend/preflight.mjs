import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {loadConfig} from './config.mjs';
import {openDatabase} from './database.mjs';
import {createRpc} from './rpc.mjs';
process.umask(0o077);
const config=loadConfig();await mkdir(dirname(config.dbPath),{recursive:true});const db=openDatabase(config.dbPath);
try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Database integrity check failed.');
  const slot=await createRpc({urls:config.rpcUrls}).check();
  process.stdout.write(JSON.stringify({event:'preflight.passed',ok:true,finalizedSlot:slot,schemaVersion:db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version})+'\n');
}finally{db.close();}
