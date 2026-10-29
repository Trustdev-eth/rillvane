import {CLUSTER_GENESIS} from './config.mjs';

export {CLUSTER_GENESIS};
export const DEVNET_GENESIS = CLUSTER_GENESIS;

const methods = new Set([
  'getBalance', 'getTokenAccountsByOwner', 'getSignatureStatuses', 'getTransaction',
  'getSlot', 'getHealth', 'getLatestBlockhash', 'getGenesisHash'
]);
const fail = message => Object.assign(new Error(message), {status: 503});

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

export function createRpc({urls = ['https://api.devnet.solana.com'], fetchRpc = globalThis.fetch.bind(globalThis), now = () => Date.now(), timeout = 8000, genesis = CLUSTER_GENESIS} = {}) {
  const verified = new Map(), verifying = new Map();
  let healthyAt = 0, attempts = 0, failures = 0, lastError = '';
  async function call(url, method, params = []) {
    attempts++;
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined;
    let response;
    try {
      response = await fetchRpc(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
        ...(signal ? {signal} : {}),
        redirect: 'follow'
      });
    } catch (error) {
      throw fail('Solana RPC fetch failed: ' + (error.message || 'network error'));
    }
    if (!response.ok) throw fail('Solana RPC is unavailable (' + response.status + ').');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw fail('Solana RPC rejected the read request.');
    return data.result;
  }
  async function read(method, params = []) {
    if (!methods.has(method)) throw fail('Only explicitly permitted read-only RPC methods are available.');
    for (const url of urls) {
      try {
        if (!verified.has(url) || verified.get(url) <= now()) {
          if (!verifying.has(url)) {
            verifying.set(url, (async () => {
              if (isLoopback(url)) {
                verified.set(url, now() + 60000);
                return;
              }
              const hash = await call(url, 'getGenesisHash');
              if (hash !== genesis) throw fail('RPC network verification failed.');
              verified.set(url, now() + 60000);
            })().finally(() => verifying.delete(url)));
          }
          await verifying.get(url);
        }
        const result = await call(url, method, params);
        healthyAt = now();
        lastError = '';
        return result;
      } catch (error) {
        lastError = error.message || 'Verified RPC is unavailable. Try again later.';
        verified.delete(url);
        failures++;
      }
    }
    throw Object.assign(new Error('Verified RPC is unavailable. Try again later.'), {status: 503, cause: lastError});
  }
  return {
    read,
    check: () => read('getSlot', [{commitment: 'finalized'}]),
    stats: () => ({healthyAt, attempts, failures, lastError, verifiedEndpoints: [...verified.values()].filter(t => t > now()).length})
  };
}
