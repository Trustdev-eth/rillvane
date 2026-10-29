import {createTransactionWorker} from './transactions.mjs';
import {refreshOracle, liquidateUnhealthy, ensureProtocol} from './protocol.mjs';
import {maintenance} from './db-util.mjs';
import {chainConfigured, protocolPdas, oracleUpdateIx, sendIx} from './chain.mjs';

export function createProtocolWorker({db, rpc, now = () => Date.now(), log = () => {}, faucetLimit, registry, keys, chainRpc} = {}) {
  const confirmation = createTransactionWorker({db, rpc, now, log});
  let running = false, stopping = false, timer, current = Promise.resolve(), heartbeat = 0, oracleAt = 0, keeperAt = 0, chainOracleAt = 0, maintainAt = 0;

  async function protocolTick() {
    const timestamp = now();
    try {
      const market = ensureProtocol(db, timestamp);
      if (timestamp - Number(market.oracleTime) > 20_000) {
        refreshOracle(db, timestamp, BigInt(market.price));
        oracleAt = timestamp;
      }
      if (
        chainConfigured(registry) && chainRpc && keys?.deployer && keys?.oracle &&
        timestamp - chainOracleAt > 12_000
      ) {
        try {
          const live = ensureProtocol(db, timestamp);
          const pdas = protocolPdas(registry.programId);
          await sendIx(chainRpc, {
            feePayer: keys.deployer,
            signers: [keys.deployer, keys.oracle],
            instructions: [oracleUpdateIx(registry.programId, pdas, keys.oracle.publicKey, BigInt(live.price))]
          });
        } catch (error) {
          log({level: 'error', event: 'worker.chain_oracle', error: error.message});
        }
        chainOracleAt = timestamp;
      }
      if (timestamp - keeperAt > 3_000) {
        liquidateUnhealthy(db, timestamp);
        keeperAt = timestamp;
      }
      if (timestamp - maintainAt > 60_000) {
        maintenance(db, timestamp);
        maintainAt = timestamp;
      }
    } catch (error) {
      log({level: 'error', event: 'worker.protocol_tick', error: error.message});
    }
  }

  async function tick() {
    if (running || stopping) return;
    running = true;
    heartbeat = now();
    try {
      await protocolTick();
      await confirmation.tick();
    } finally {
      running = false;
      heartbeat = now();
    }
  }

  return {
    tick,
    confirmation,
    start() {
      if (timer) return;
      stopping = false;
      timer = setInterval(() => { if (!running) current = tick(); }, 1000);
      timer.unref?.();
      current = tick();
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      timer = null;
      await current;
    },
    health() {
      const q = confirmation.health();
      return {...q, running, heartbeat, faucetLimit: faucetLimit || null};
    }
  };
}
