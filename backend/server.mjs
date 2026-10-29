import {createServer} from 'node:http';
import {openDatabase} from './database.mjs';
import {loadConfig} from './config.mjs';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireRegistry} from './registry.mjs';
import {loadKeypair} from './chain.mjs';
import {createApplication as createOrigin} from './app.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};

function loadKeys(keysDir) {
  if (!keysDir) return null;
  return {
    deployer: loadKeypair(join(keysDir, 'deployer.json')),
    oracle: loadKeypair(join(keysDir, 'oracle.json')),
    faucet: loadKeypair(join(keysDir, 'faucet.json')),
    keeper: loadKeypair(join(keysDir, 'keeper.json'))
  };
}

function nodeRequest(req, origin) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  const init = {method: req.method, headers};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }
  return new Request(new URL(req.url, origin), init);
}

async function writeNodeResponse(response, req, res) {
  res.statusCode = response.status;
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue;
    res.setHeader(key, value);
  }
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  if (req.method === 'HEAD' || response.status === 204 || response.status === 304) {
    res.end();
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

export function createApplication(options = {}) {
  const db = options.db || openDatabase(options.dbPath || 'rillvane.sqlite');
  const registry = options.registry || requireRegistry(options.registryPath, options.production);
  const keys = options.keys !== undefined ? options.keys : loadKeys(options.keysDir);
  const app = createOrigin({...options, db, registry, keys, streamTimers: options.streamTimers !== false});
  const server = createServer(async (req, res) => {
    try {
      const request = nodeRequest(req, app.origin());
      const response = await app.handleFetch(request, {ip: req.socket.remoteAddress || 'unknown'});
      if (response) {
        await writeNodeResponse(response, req, res);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        await writeNodeResponse(new Response(JSON.stringify({error: 'Method not allowed.'}), {
          status: 405,
          headers: {'content-type': 'application/json; charset=utf-8'}
        }), req, res);
        return;
      }
      let name = decodeURIComponent(new URL(req.url, app.origin()).pathname);
      if (name.endsWith('/')) name += 'index.html';
      const file = resolve(root, '.' + name);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
        await writeNodeResponse(new Response(JSON.stringify({error: 'Forbidden.'}), {
          status: 403,
          headers: {'content-type': 'application/json; charset=utf-8'}
        }), req, res);
        return;
      }
      let bytes;
      try { bytes = await readFile(file); } catch {
        await writeNodeResponse(new Response(JSON.stringify({error: 'Not found.'}), {
          status: 404,
          headers: {'content-type': 'application/json; charset=utf-8'}
        }), req, res);
        return;
      }
      const type = mime[extname(file)] || 'application/octet-stream';
      const headers = {'content-type': type};
      if (['.js', '.css', '.html'].includes(extname(file))) headers['cache-control'] = 'no-store';
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, {'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: 'The server could not complete this request.'}));
      } else {
        res.destroy();
      }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.on('upgrade', (req, socket, head) => app.stream.onUpgrade(req, socket, head));
  return {
    ...app,
    server,
    close: () => (async () => {
      app.stream.stop();
      await new Promise(resolve => {
        const force = setTimeout(() => server.closeAllConnections(), 10000);
        force.unref?.();
        server.close(() => { clearTimeout(force); resolve(); });
      });
      await app.close();
    })()
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const config = loadConfig();
  const app = createApplication({...config, workerEnabled: config.worker, logger: entry => process.stdout.write(JSON.stringify({...entry, time: new Date().toISOString()}) + '\n')});
  if (config.production && !await app.ready()) {
    await app.close();
    throw new Error('Startup check failed: verified RPC is unavailable.');
  }
  app.server.listen(config.port, config.host, () => process.stdout.write(JSON.stringify({event: 'server.listening', host: config.host, port: config.port}) + '\n'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
