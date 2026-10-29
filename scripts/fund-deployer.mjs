const pubkey = '4SZspk1U5y65dcn5UFsGKb1wuEonm6hHQa7hKjhoh9zE';
const attempts = [
  {
    name: 'official-rpc-1sol',
    url: 'https://api.devnet.solana.com',
    body: {jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [pubkey, 1_000_000_000]}
  },
  {
    name: 'official-rpc-2sol',
    url: 'https://api.devnet.solana.com',
    body: {jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [pubkey, 2_000_000_000, {commitment: 'confirmed'}]}
  },
  {
    name: 'solana-labs-faucet',
    url: 'https://faucet.solana.com/api/request',
    body: {pubkey, amount: 2, cluster: 'devnet'}
  },
  {
    name: 'solana-labs-faucet-alt',
    url: 'https://faucet.solana.com/api/airdrop',
    body: {pubkey, lamports: 2_000_000_000, cluster: 'devnet'}
  },
  {
    name: 'devnetfaucet-org',
    url: 'https://www.devnetfaucet.org/api/request',
    body: {walletAddress: pubkey, amount: 1}
  },
  {
    name: 'solfaucet',
    url: 'https://solfaucet.com/api/request',
    body: {address: pubkey, network: 'devnet'}
  }
];

for (const attempt of attempts) {
  try {
    const response = await fetch(attempt.url, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify(attempt.body),
      signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    process.stdout.write(JSON.stringify({name: attempt.name, status: response.status, body: text.slice(0, 500)}) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({name: attempt.name, error: error.message}) + '\n');
  }
}
