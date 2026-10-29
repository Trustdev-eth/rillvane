import {createHash, createPublicKey, randomBytes, verify} from 'node:crypto';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function decodePublicKey(key) {
  if (typeof key !== 'string' || key.length < 32 || key.length > 44) throw Object.assign(new Error('Invalid Solana address.'), {status: 400});
  let n = 0n;
  for (const c of key) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw Object.assign(new Error('Invalid Solana address.'), {status: 400});
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of key) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  if (bytes.length !== 32) throw Object.assign(new Error('Invalid Solana address.'), {status: 400});
  return Buffer.from(bytes);
}

export function challengeMessage(origin, wallet, nonce) {
  return `${origin} requests a Rillvane sign-in.\nWallet: ${wallet}\nNonce: ${nonce}`;
}

export function verifyEd25519(address, message, signatureB64) {
  if (typeof signatureB64 !== 'string' || signatureB64.length > 100) return false;
  const signature = Buffer.from(signatureB64, 'base64');
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), decodePublicKey(address)]),
    format: 'der',
    type: 'spki'
  });
  return signature.length === 64 && verify(null, Buffer.from(message), publicKey, signature);
}

export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
