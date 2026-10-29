import {test} from 'node:test';
import assert from 'node:assert/strict';
import {protocolPdas, generateKeypair, encodeBase58, signBytes, ataAddress, isOnCurve} from './chain.mjs';

test('program PDAs match the deployed program id', () => {
  const pdas = protocolPdas('2GZypcHMjRrfrjimxkB5G4wcisj9MFZpns9gSSZbfrt4');
  assert.equal(pdas.config.address, '7ypfkyPgfMmkiAui3pauUZpYLhKcTpyDRAoyDgXvareW');
  assert.equal(pdas.market.address, 'CuB3DTHwqLTSzcWZtF7WHPt4fgCto8kdjsXcUZJa9BaG');
  assert.equal(pdas.oracle.address, 'AZDp42RCx2fsYYHtqFfBU4hhqDXN1xg5zu2T7m2bVk4Q');
});

test('RFC 8032 ed25519 public key is on curve', () => {
  assert.equal(
    isOnCurve(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex')),
    true
  );
});

test('ATA for off-curve market PDA matches the on-chain associated-token program', () => {
  const ata = ataAddress(
    'GHKc9Vigvn5murV4Bhf9QXni3m9yHkbMZS6Se6FtmZDb',
    'CuB3DTHwqLTSzcWZtF7WHPt4fgCto8kdjsXcUZJa9BaG'
  );
  assert.equal(ata.address, 'E3s7qHhsFFPXgsckHceWg3m6Uh9rRdH14H9aNMWkjZEC');
  assert.equal(ata.bump, 254);
});

test('generated keypair round-trips through base58', () => {
  const pair = generateKeypair();
  assert.equal(pair.secretKey.length, 64);
  assert.equal(pair.publicKey, encodeBase58(pair.publicKeyBytes));
});

test('signBytes accepts a generated keypair', () => {
  const pair = generateKeypair();
  const sig = signBytes(pair, Buffer.from('rillvane'));
  assert.equal(sig.length, 64);
});
