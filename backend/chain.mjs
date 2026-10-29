import {createHash, createPrivateKey, generateKeyPairSync, sign as edSign} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {decodePublicKey} from './auth.mjs';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSVAR_RENT = 'SysvarRent111111111111111111111111111111111';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const P = (1n << 255n) - 19n;
const PDA_MARKER = Buffer.from('ProgramDerivedAddress');

export function chainConfigured(registry) {
  return Boolean(registry?.programId)
    && registry.programId !== SYSTEM_PROGRAM
    && Boolean(registry?.baseMint)
    && !String(registry.baseMint).startsWith('RLVN');
}

export function encodeBase58(bytes) {
  const buf = Buffer.from(bytes);
  let n = 0n;
  for (const b of buf) n = (n << 8n) + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s || '1';
}

function mod(a) {
  const r = a % P;
  return r < 0n ? r + P : r;
}

function modPow(a, e) {
  let r = 1n, b = mod(a), k = e;
  while (k > 0n) {
    if (k & 1n) r = mod(r * b);
    b = mod(b * b);
    k >>= 1n;
  }
  return r;
}

const D = mod(-121665n * modPow(121666n, P - 2n));
const I = modPow(2n, (P - 1n) / 4n);

export function isOnCurve(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  const b = Buffer.from(bytes);
  let y = 0n;
  for (let i = 0; i < 31; i++) y |= BigInt(b[i]) << (8n * BigInt(i));
  y |= BigInt(b[31] & 127) << 248n;
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = mod(mod(v * v) * v);
  const v7 = mod(mod(v3 * v3) * v);
  let x = mod(mod(u * v3) * modPow(mod(u * v7), (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === mod(-u)) x = mod(x * I);
  else if (vx2 !== u) return false;
  return true;
}

export function findProgramAddress(seeds, programId) {
  const program = Buffer.isBuffer(programId) || programId instanceof Uint8Array
    ? Buffer.from(programId)
    : decodePublicKey(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds.map(s => Buffer.from(s)), Buffer.from([bump]), program, PDA_MARKER];
    const hash = createHash('sha256').update(Buffer.concat(parts)).digest();
    if (!isOnCurve(hash)) return {address: encodeBase58(hash), bump, bytes: hash};
  }
  throw new Error('Unable to find program address.');
}

export function protocolPdas(programId) {
  return {
    config: findProgramAddress([Buffer.from('config')], programId),
    market: findProgramAddress([Buffer.from('market')], programId),
    oracle: findProgramAddress([Buffer.from('oracle')], programId)
  };
}

export function userPda(programId, owner) {
  return findProgramAddress([Buffer.from('user'), decodePublicKey(owner)], programId);
}

export function ataAddress(mint, owner) {
  return findProgramAddress(
    [decodePublicKey(owner), decodePublicKey(TOKEN_PROGRAM), decodePublicKey(mint)],
    ATA_PROGRAM
  );
}

export function generateKeypair() {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyBytes = pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32);
  const pkcs8 = pair.privateKey.export({format: 'der', type: 'pkcs8'});
  const secretKey = Buffer.concat([pkcs8.subarray(-32), publicKeyBytes]);
  return {secretKey, publicKeyBytes, publicKey: encodeBase58(publicKeyBytes)};
}

export function loadKeypairFromSecret(secretJson) {
  if (!secretJson) return null;
  const secret = Buffer.from(JSON.parse(String(secretJson).trim()));
  if (secret.length !== 64) throw new Error('Expected a 64-byte Solana keypair file.');
  return {
    secretKey: secret,
    publicKeyBytes: secret.subarray(32),
    publicKey: encodeBase58(secret.subarray(32))
  };
}

export function loadKeypair(path) {
  if (!existsSync(path)) return null;
  return loadKeypairFromSecret(readFileSync(path, 'utf8'));
}

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function signBytes(keypair, message) {
  const pk = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, keypair.secretKey.subarray(0, 32)]),
    format: 'der',
    type: 'pkcs8'
  });
  return edSign(null, message, pk);
}

function compactU16(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n & 0x7f) | 0x80, n >> 7]);
  return Buffer.from([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
}

export function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export function i64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

export function u128le(n) {
  const x = BigInt(n);
  return Buffer.concat([u64le(x & ((1n << 64n) - 1n)), u64le(x >> 64n)]);
}

export function encodeInstruction(kind, fields = {}) {
  switch (kind) {
    case 'initialize': return Buffer.from([0]);
    case 'oracleUpdate': return Buffer.concat([Buffer.from([1]), u128le(fields.price)]);
    case 'faucetMint': return Buffer.concat([Buffer.from([2]), u64le(fields.amount), Buffer.from([fields.base ? 1 : 0])]);
    case 'supply': return Buffer.concat([Buffer.from([3]), u64le(fields.amount), Buffer.from([fields.base ? 1 : 0])]);
    case 'withdraw': return Buffer.concat([Buffer.from([4]), u64le(fields.amount), Buffer.from([fields.base ? 1 : 0])]);
    case 'swap': return Buffer.concat([
      Buffer.from([5]), u64le(fields.amountIn), Buffer.from([fields.buyBase ? 1 : 0]),
      u64le(fields.minOut), u64le(fields.nonce), i64le(fields.deadline)
    ]);
    case 'addCollateral': return Buffer.concat([Buffer.from([6]), u64le(fields.amount)]);
    case 'removeCollateral': return Buffer.concat([Buffer.from([7]), u64le(fields.amount)]);
    case 'borrow': return Buffer.concat([Buffer.from([8]), u64le(fields.amount)]);
    case 'repay': return Buffer.concat([Buffer.from([9]), u64le(fields.amount)]);
    case 'liquidate': return Buffer.from([10]);
    case 'accrue': return Buffer.from([11]);
    case 'pause': return Buffer.concat([Buffer.from([12]), Buffer.from([fields.paused ? 1 : 0])]);
    default: throw new Error('Unknown instruction.');
  }
}

function meta(pubkey, isSigner = false, isWritable = false) {
  return {pubkey: typeof pubkey === 'string' ? pubkey : encodeBase58(pubkey), isSigner, isWritable};
}

export function compileMessage({feePayer, blockhash, instructions}) {
  const seen = new Map();
  const order = [];
  function add(account) {
    const key = account.pubkey;
    const prior = seen.get(key);
    if (!prior) {
      const next = {...account};
      seen.set(key, next);
      order.push(next);
      return;
    }
    prior.isSigner = prior.isSigner || account.isSigner;
    prior.isWritable = prior.isWritable || account.isWritable;
  }
  add(meta(feePayer, true, true));
  for (const ix of instructions) {
    for (const account of ix.accounts) add(account);
    add(meta(ix.programId, false, false));
  }
  const signedW = order.filter(a => a.isSigner && a.isWritable);
  const signedR = order.filter(a => a.isSigner && !a.isWritable);
  const unsignedW = order.filter(a => !a.isSigner && a.isWritable);
  const unsignedR = order.filter(a => !a.isSigner && !a.isWritable);
  const keys = [...signedW, ...signedR, ...unsignedW, ...unsignedR];
  const indexOf = key => {
    const i = keys.findIndex(a => a.pubkey === key);
    if (i < 0) throw new Error('Missing account ' + key);
    return i;
  };
  const header = Buffer.from([signedW.length + signedR.length, signedR.length, unsignedR.length]);
  const keyBytes = Buffer.concat([compactU16(keys.length), ...keys.map(a => decodePublicKey(a.pubkey))]);
  const compiled = instructions.map(ix => {
    const accounts = Buffer.from(ix.accounts.map(a => indexOf(a.pubkey)));
    const data = Buffer.from(ix.data);
    return Buffer.concat([
      Buffer.from([indexOf(ix.programId)]),
      compactU16(accounts.length), accounts,
      compactU16(data.length), data
    ]);
  });
  const message = Buffer.concat([
    header, keyBytes, decodePublicKey(blockhash),
    compactU16(compiled.length), ...compiled
  ]);
  return {message, keys, numRequiredSignatures: signedW.length + signedR.length};
}

export function serializeTransaction(message, signatures) {
  return Buffer.concat([compactU16(signatures.length), ...signatures.map(s => Buffer.from(s)), message]);
}

export function unsignedTransaction({feePayer, blockhash, instructions}) {
  const compiled = compileMessage({feePayer, blockhash, instructions});
  const zeros = Buffer.alloc(64);
  const sigs = Array.from({length: compiled.numRequiredSignatures}, () => zeros);
  return {wire: serializeTransaction(compiled.message, sigs), message: compiled.message, keys: compiled.keys};
}

export async function readUserNonce(rpc, programId, owner) {
  const pda = userPda(programId, owner);
  const info = await rpc.call('getAccountInfo', [pda.address, {encoding: 'base64', commitment: 'confirmed'}]);
  const blob = info?.value?.data?.[0];
  if (!blob) return 0n;
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < 136) return 0n;
  return buf.readBigUInt64LE(128);
}

export function signTransaction({feePayer, blockhash, instructions, signers}) {
  const compiled = compileMessage({feePayer, blockhash, instructions});
  const sigs = [];
  for (let i = 0; i < compiled.numRequiredSignatures; i++) {
    const key = compiled.keys[i].pubkey;
    const signer = signers.find(s => s.publicKey === key);
    if (!signer) throw new Error('Missing signer for ' + key);
    sigs.push(signBytes(signer, compiled.message));
  }
  return {
    wire: serializeTransaction(compiled.message, sigs),
    message: compiled.message,
    keys: compiled.keys
  };
}

export function extractMessage(wire) {
  const buf = Buffer.from(wire);
  let i = 0, n = 0, shift = 0;
  while (true) {
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return buf.subarray(i + n * 64);
}

export function createChainRpc(url, fetchRpc = globalThis.fetch.bind(globalThis)) {
  async function call(method, params = []) {
    const response = await fetchRpc(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) {
      throw Object.assign(new Error(data.error?.message || method + ' failed.'), {status: 503});
    }
    return data.result;
  }
  return {call};
}

export async function latestBlockhash(rpc) {
  const result = await rpc.call('getLatestBlockhash', [{commitment: 'confirmed'}]);
  return result.value || result;
}

export async function sendAndConfirm(rpc, wire, {timeout = 60000} = {}) {
  const signature = await rpc.call('sendTransaction', [
    Buffer.from(wire).toString('base64'),
    {encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed'}
  ]);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const status = await rpc.call('getSignatureStatuses', [[signature], {searchTransactionHistory: true}]);
    const value = status.value?.[0];
    if (value?.err) throw new Error('On-chain instruction failed.');
    if (value && ['confirmed', 'finalized'].includes(value.confirmationStatus)) return signature;
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error('Timed out waiting for confirmation.');
}

function systemCreateAccount(from, newAccount, lamports, space, owner) {
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [meta(from, true, true), meta(newAccount, true, true)],
    data: Buffer.concat([Buffer.from([0, 0, 0, 0]), u64le(lamports), u64le(space), decodePublicKey(owner)])
  };
}

function initializeMint2(mint, decimals, mintAuthority) {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [meta(mint, false, true)],
    data: Buffer.concat([Buffer.from([20, decimals]), decodePublicKey(mintAuthority), Buffer.from([0])])
  };
}

function mintToIx(mint, dest, authority, amount) {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [meta(mint, false, true), meta(dest, false, true), meta(authority, true, false)],
    data: Buffer.concat([Buffer.from([7]), u64le(amount)])
  };
}

function setMintAuthority(mint, current, next) {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [meta(mint, false, true), meta(current, true, false)],
    data: Buffer.concat([Buffer.from([6, 0, 1]), decodePublicKey(next)])
  };
}

function createAtaIdempotent(payer, ata, owner, mint) {
  return {
    programId: ATA_PROGRAM,
    accounts: [
      meta(payer, true, true),
      meta(ata, false, true),
      meta(owner, false, false),
      meta(mint, false, false),
      meta(SYSTEM_PROGRAM, false, false),
      meta(TOKEN_PROGRAM, false, false)
    ],
    data: Buffer.from([1])
  };
}

export function rillvaneAccounts(registry, pdas) {
  return {
    programId: registry.programId,
    config: pdas.config.address,
    market: pdas.market.address,
    oracle: pdas.oracle.address,
    baseMint: registry.baseMint,
    quoteMint: registry.quoteMint,
    baseVault: registry.baseVault,
    quoteVault: registry.quoteVault
  };
}

export function initializeIx(registry, pdas, payer, authorities) {
  return {
    programId: registry.programId,
    accounts: [
      meta(payer, true, true),
      meta(pdas.config.address, false, true),
      meta(pdas.market.address, false, true),
      meta(pdas.oracle.address, false, true),
      meta(registry.baseMint, false, false),
      meta(registry.quoteMint, false, false),
      meta(registry.baseVault, false, false),
      meta(registry.quoteVault, false, false),
      meta(authorities.upgrade, false, false),
      meta(authorities.oracle, false, false),
      meta(authorities.faucet, false, false),
      meta(authorities.keeper, false, false),
      meta(SYSTEM_PROGRAM, false, false)
    ],
    data: encodeInstruction('initialize')
  };
}

export function oracleUpdateIx(programId, pdas, updater, price) {
  return {
    programId,
    accounts: [
      meta(updater, true, false),
      meta(pdas.config.address, false, false),
      meta(pdas.oracle.address, false, true)
    ],
    data: encodeInstruction('oracleUpdate', {price})
  };
}

export function faucetMintIx(programId, pdas, faucet, mint, dest, amount, base) {
  return {
    programId,
    accounts: [
      meta(faucet, true, false),
      meta(pdas.config.address, false, false),
      meta(pdas.market.address, false, false),
      meta(mint, false, true),
      meta(dest, false, true),
      meta(TOKEN_PROGRAM, false, false)
    ],
    data: encodeInstruction('faucetMint', {amount, base})
  };
}

export function swapIx(programId, registry, pdas, owner, user, userBase, userQuote, amountIn, buyBase, minOut, nonce, deadline) {
  return {
    programId,
    accounts: [
      meta(owner, true, true),
      meta(pdas.config.address, false, false),
      meta(pdas.market.address, false, true),
      meta(pdas.oracle.address, false, false),
      meta(user, false, true),
      meta(userBase, false, true),
      meta(userQuote, false, true),
      meta(registry.baseVault, false, true),
      meta(registry.quoteVault, false, true),
      meta(TOKEN_PROGRAM, false, false),
      meta(SYSTEM_PROGRAM, false, false)
    ],
    data: encodeInstruction('swap', {amountIn, buyBase, minOut, nonce, deadline})
  };
}

export function withdrawIx(programId, pdas, owner, user, userToken, vault, amount, base) {
  return {
    programId,
    accounts: [
      meta(owner, true, true),
      meta(pdas.config.address, false, false),
      meta(pdas.market.address, false, true),
      meta(pdas.oracle.address, false, false),
      meta(user, false, true),
      meta(userToken, false, true),
      meta(vault, false, true),
      meta(TOKEN_PROGRAM, false, false)
    ],
    data: encodeInstruction('withdraw', {amount, base})
  };
}

export function creditIx(programId, pdas, registry, owner, user, userBase, userQuote, action, amount) {
  const common = [
    meta(owner, true, true),
    meta(pdas.config.address, false, false),
    meta(pdas.market.address, false, true),
    meta(pdas.oracle.address, false, false),
    meta(user, false, true)
  ];
  if (action === 'add') {
    return {
      programId,
      accounts: [...common, meta(userBase, false, true), meta(registry.baseVault, false, true), meta(TOKEN_PROGRAM, false, false), meta(SYSTEM_PROGRAM, false, false)],
      data: encodeInstruction('addCollateral', {amount})
    };
  }
  if (action === 'remove') {
    return {
      programId,
      accounts: [...common, meta(userBase, false, true), meta(registry.baseVault, false, true), meta(TOKEN_PROGRAM, false, false)],
      data: encodeInstruction('removeCollateral', {amount})
    };
  }
  if (action === 'borrow') {
    return {
      programId,
      accounts: [...common, meta(userQuote, false, true), meta(registry.quoteVault, false, true), meta(TOKEN_PROGRAM, false, false)],
      data: encodeInstruction('borrow', {amount})
    };
  }
  return {
    programId,
    accounts: [...common, meta(userQuote, false, true), meta(registry.quoteVault, false, true), meta(TOKEN_PROGRAM, false, false)],
    data: encodeInstruction('repay', {amount})
  };
}

export function supplyIx(programId, pdas, owner, user, userToken, vault, amount, base) {
  return {
    programId,
    accounts: [
      meta(owner, true, true),
      meta(pdas.config.address, false, false),
      meta(pdas.market.address, false, true),
      meta(pdas.oracle.address, false, false),
      meta(user, false, true),
      meta(userToken, false, true),
      meta(vault, false, true),
      meta(TOKEN_PROGRAM, false, false),
      meta(SYSTEM_PROGRAM, false, false)
    ],
    data: encodeInstruction('supply', {amount, base})
  };
}

export async function sendSigned(rpc, built) {
  return sendAndConfirm(rpc, built.wire);
}

export async function sendIx(rpc, {feePayer, instructions, signers}) {
  const blockhash = await latestBlockhash(rpc);
  const built = signTransaction({
    feePayer: feePayer.publicKey,
    blockhash: blockhash.blockhash,
    instructions,
    signers
  });
  const signature = await sendAndConfirm(rpc, built.wire);
  return {signature, blockhash};
}

export {systemCreateAccount, initializeMint2, mintToIx, setMintAuthority, createAtaIdempotent, meta};
