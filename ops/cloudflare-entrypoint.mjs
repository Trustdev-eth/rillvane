import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const keysDir = process.env.KEYS_DIR || '/data/keys';
await mkdir('/data', {recursive: true, mode: 0o700});
await mkdir(keysDir, {recursive: true, mode: 0o700});
const files = [
  ['DEPLOYER_KEYPAIR', 'deployer.json'],
  ['ORACLE_KEYPAIR', 'oracle.json'],
  ['FAUCET_KEYPAIR', 'faucet.json'],
  ['KEEPER_KEYPAIR', 'keeper.json']
];
for (const [name, file] of files) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    await writeFile(join(keysDir, file), value.trim(), {mode: 0o600});
  }
}

const child = spawn(process.execPath, ['backend/server.mjs'], {stdio: 'inherit', env: process.env});
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
