import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {UNIT} from '../backend/math.mjs';
import {loadRegistry} from '../backend/registry.mjs';
import {
  loadKeypair, generateKeypair, createChainRpc, sendIx, protocolPdas, ataAddress, userPda,
  chainConfigured,   faucetMintIx, swapIx, createAtaIdempotent, readUserNonce, SYSTEM_PROGRAM, u64le
} from '../backend/chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const registry = loadRegistry(resolve(process.env.REGISTRY_PATH || 'ops/registry.json'));
if (!chainConfigured(registry)) {
  throw new Error('Registry is not on-chain yet. Run node scripts/deploy-devnet.mjs first.');
}
const keysDir = resolve(process.env.KEYS_DIR || 'ops/keys');
const deployer = loadKeypair(resolve(keysDir, 'deployer.json'));
const faucet = loadKeypair(resolve(keysDir, 'faucet.json'));
const rpc = createChainRpc(registry.rpcUrl || 'https://api.devnet.solana.com');
const user = generateKeypair();
const pdas = protocolPdas(registry.programId);
const userBase = ataAddress(registry.baseMint, user.publicKey).address;
const userQuote = ataAddress(registry.quoteMint, user.publicKey).address;
const userAccount = userPda(registry.programId, user.publicKey).address;

function transferSol(from, to, lamports) {
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [
      {pubkey: from, isSigner: true, isWritable: true},
      {pubkey: to, isSigner: false, isWritable: true}
    ],
    data: Buffer.concat([Buffer.from([2, 0, 0, 0]), u64le(lamports)])
  };
}

const fund = await sendIx(rpc, {
  feePayer: deployer,
  signers: [deployer],
  instructions: [transferSol(deployer.publicKey, user.publicKey, 50_000_000n)]
});
process.stdout.write(JSON.stringify({event: 'verify.fund_user', wallet: user.publicKey, signature: fund.signature}) + '\n');

const minted = await sendIx(rpc, {
  feePayer: deployer,
  signers: [deployer, faucet],
  instructions: [
    createAtaIdempotent(deployer.publicKey, userQuote, user.publicKey, registry.quoteMint),
    createAtaIdempotent(deployer.publicKey, userBase, user.publicKey, registry.baseMint),
    faucetMintIx(registry.programId, pdas, faucet.publicKey, registry.quoteMint, userQuote, UNIT * 1_000n, false)
  ]
});
process.stdout.write(JSON.stringify({event: 'verify.faucet_usdc', signature: minted.signature}) + '\n');

const nonce = await readUserNonce(rpc, registry.programId, user.publicKey);
const deadline = Math.floor(Date.now() / 1000) + 90;
const swapped = await sendIx(rpc, {
  feePayer: user,
  signers: [user],
  instructions: [
    swapIx(
      registry.programId, registry, pdas, user.publicKey, userAccount, userBase, userQuote,
      UNIT * 100n, true, 0n, nonce, deadline
    )
  ]
});
const quote = await rpc.call('getTokenAccountBalance', [userQuote]);
const base = await rpc.call('getTokenAccountBalance', [userBase]);
process.stdout.write(JSON.stringify({
  event: 'verify.ok',
  swap: swapped.signature,
  usdc: quote.value.uiAmountString,
  rlvn: base.value.uiAmountString,
  explorer: 'https://explorer.solana.com/tx/' + swapped.signature + '?cluster=devnet'
}) + '\n');
