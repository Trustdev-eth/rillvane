import {writeFileSync, existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {START_PRICE, UNIT} from '../backend/math.mjs';
import {saveRegistry, loadRegistry} from '../backend/registry.mjs';
import {
  loadKeypair, generateKeypair, createChainRpc, sendIx, protocolPdas, ataAddress,
  systemCreateAccount, initializeMint2, mintToIx, setMintAuthority, createAtaIdempotent,
  initializeIx, oracleUpdateIx, TOKEN_PROGRAM
} from '../backend/chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const keysDir = resolve('ops/keys');
const registryPath = resolve(process.env.REGISTRY_PATH || 'ops/registry.json');
const rpcUrl = 'https://api.devnet.solana.com';
const programId = '2GZypcHMjRrfrjimxkB5G4wcisj9MFZpns9gSSZbfrt4';
const MIN_LAMPORTS = 2_500_000_000n;

function wsl(script) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('wsl', ['-d', 'Ubuntu', '--', 'bash', '-c', `sed -i 's/\\r$//' ${script} && bash ${script}`], {
      stdio: 'inherit'
    });
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error('WSL command failed (' + code + ')')));
  });
}

function writeKeypair(path, pair) {
  if (existsSync(path)) return loadKeypair(path);
  writeFileSync(path, JSON.stringify([...pair.secretKey]) + '\n', {mode: 0o600});
  return pair;
}

const deployer = loadKeypair(resolve(keysDir, 'deployer.json'));
const upgrade = loadKeypair(resolve(keysDir, 'upgrade.json'));
const oracle = loadKeypair(resolve(keysDir, 'oracle.json'));
const faucet = loadKeypair(resolve(keysDir, 'faucet.json'));
const keeper = loadKeypair(resolve(keysDir, 'keeper.json'));
if (!deployer || !upgrade || !oracle || !faucet || !keeper) {
  throw new Error('Missing operator keypairs in ops/keys/.');
}

const rpc = createChainRpc(rpcUrl);
const balance = BigInt((await rpc.call('getBalance', [deployer.publicKey, {commitment: 'confirmed'}])).value);
process.stdout.write(JSON.stringify({event: 'deploy.balance', wallet: deployer.publicKey, lamports: balance.toString()}) + '\n');
if (balance < MIN_LAMPORTS) {
  process.stdout.write(JSON.stringify({
    event: 'deploy.needs_sol',
    wallet: deployer.publicKey,
    need: MIN_LAMPORTS.toString(),
    have: balance.toString(),
    faucet: 'https://faucet.solana.com'
  }) + '\n');
  process.exitCode = 2;
} else {
await wsl('/mnt/d/work/meme/rillvane/scripts/wsl-deploy-program.sh');

const pdas = protocolPdas(programId);
const baseMint = writeKeypair(resolve(keysDir, 'base-mint.json'), generateKeypair());
const quoteMint = writeKeypair(resolve(keysDir, 'quote-mint.json'), generateKeypair());
const baseVault = ataAddress(baseMint.publicKey, pdas.market.address);
const quoteVault = ataAddress(quoteMint.publicKey, pdas.market.address);
const mintRent = BigInt(await rpc.call('getMinimumBalanceForRentExemption', [82]));

async function ensureMint(mint) {
  const info = await rpc.call('getAccountInfo', [mint.publicKey, {encoding: 'base64'}]);
  if (info?.value) return;
  const result = await sendIx(rpc, {
    feePayer: deployer,
    signers: [deployer, mint],
    instructions: [
      systemCreateAccount(deployer.publicKey, mint.publicKey, mintRent, 82, TOKEN_PROGRAM),
      initializeMint2(mint.publicKey, 6, deployer.publicKey)
    ]
  });
  process.stdout.write(JSON.stringify({event: 'deploy.mint', mint: mint.publicKey, signature: result.signature}) + '\n');
}

await ensureMint(baseMint);
await ensureMint(quoteMint);

const vaults = [
  [baseVault.address, baseMint.publicKey],
  [quoteVault.address, quoteMint.publicKey]
];
for (const [ata, mint] of vaults) {
  const info = await rpc.call('getAccountInfo', [ata, {encoding: 'base64'}]);
  if (info?.value) continue;
  const result = await sendIx(rpc, {
    feePayer: deployer,
    signers: [deployer],
    instructions: [createAtaIdempotent(deployer.publicKey, ata, pdas.market.address, mint)]
  });
  process.stdout.write(JSON.stringify({event: 'deploy.vault', ata, signature: result.signature}) + '\n');
}

const seed = [
  [baseMint, baseVault.address, UNIT * 10_000n],
  [quoteMint, quoteVault.address, UNIT * 1_000_000n]
];
for (const [mint, dest, amount] of seed) {
  const parsed = await rpc.call('getTokenAccountBalance', [dest]);
  if (BigInt(parsed?.value?.amount || 0) >= amount) continue;
  const result = await sendIx(rpc, {
    feePayer: deployer,
    signers: [deployer],
    instructions: [mintToIx(mint.publicKey, dest, deployer.publicKey, amount)]
  });
  process.stdout.write(JSON.stringify({event: 'deploy.seed', mint: mint.publicKey, amount: amount.toString(), signature: result.signature}) + '\n');
}

const registry = {
  ...(loadRegistry(registryPath) || {}),
  market: 'rlvn-usdc',
  programId,
  baseMint: baseMint.publicKey,
  quoteMint: quoteMint.publicKey,
  baseVault: baseVault.address,
  quoteVault: quoteVault.address,
  oracle: pdas.oracle.address,
  config: pdas.config.address,
  marketAccount: pdas.market.address,
  price: START_PRICE.toString(),
  decimals: 6,
  authorities: {
    upgrade: upgrade.publicKey,
    oracle: oracle.publicKey,
    faucet: faucet.publicKey,
    keeper: keeper.publicKey
  },
  rpcUrl,
  seeded: true
};

const configInfo = await rpc.call('getAccountInfo', [pdas.config.address, {encoding: 'base64'}]);
if (!configInfo?.value) {
  const result = await sendIx(rpc, {
    feePayer: deployer,
    signers: [deployer],
    instructions: [initializeIx(registry, pdas, deployer.publicKey, registry.authorities)]
  });
  process.stdout.write(JSON.stringify({event: 'deploy.initialize', signature: result.signature}) + '\n');
}

for (const mint of [baseMint, quoteMint]) {
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await sendIx(rpc, {
        feePayer: deployer,
        signers: [deployer],
        instructions: [setMintAuthority(mint.publicKey, deployer.publicKey, pdas.config.address)]
      });
      process.stdout.write(JSON.stringify({event: 'deploy.mint_authority', mint: mint.publicKey, signature: result.signature}) + '\n');
      lastError = '';
      break;
    } catch (error) {
      lastError = error.message;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (lastError) {
    process.stdout.write(JSON.stringify({event: 'deploy.mint_authority_skip', mint: mint.publicKey, error: lastError}) + '\n');
  }
}

const oracleTick = await sendIx(rpc, {
  feePayer: deployer,
  signers: [deployer, oracle],
  instructions: [oracleUpdateIx(programId, pdas, oracle.publicKey, START_PRICE)]
});
process.stdout.write(JSON.stringify({event: 'deploy.oracle', signature: oracleTick.signature}) + '\n');

saveRegistry(registryPath, registry);
process.stdout.write(JSON.stringify({
  event: 'deploy.ok',
  programId,
  config: pdas.config.address,
  market: pdas.market.address,
  oracle: pdas.oracle.address,
  baseMint: baseMint.publicKey,
  quoteMint: quoteMint.publicKey,
  registry: registryPath
}) + '\n');
}
