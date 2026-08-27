import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { isApiBuildStale } from './build-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteBin = path.resolve(__dirname, '../node_modules/vite/bin/vite.js');
const appServerScript = path.resolve(__dirname, './app-server.mjs');

function runProcess(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Process exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

// ponytail: free-port pick-then-close has a small race window; fine for E2E
// where microsecond collisions are negligible. Swap to passing the port into
// app-server directly if it ever observes EADDRINUSE.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Compiled API output lives next to the TS sources and is git-ignored, so a
// clean checkout has no node-adapter.js, and stale output can survive source
// deletions or moves. Rebuild whenever output is missing or not fresher than
// the sources so any local E2E entry point (npm run test:e2e, npx playwright
// test) is self-contained against the CURRENT code.
const BUILD_API_SCRIPT = path.resolve(__dirname, './build-api.mjs');

async function ensureApiBuilt() {
  if (!isApiBuildStale()) return;
  console.log('[vite-dev] API compilada ausente ou desatualizada; recompilando...');
  const code = await runProcess(process.execPath, [BUILD_API_SCRIPT], process.env);
  if (code !== 0) {
    console.error(
      `[vite-dev] Falha ao compilar a API (exit ${code}). Corrija o erro de compilação antes de executar o E2E.`
    );
    process.exit(code);
  }
}

async function main() {
  await ensureApiBuilt();

  const port = process.env.PORT || '5173';
  const isVercelDev = Boolean(process.env.PORT && process.env.VERCEL);

  if (isVercelDev) {
    const buildCode = await runProcess(process.execPath, [viteBin, 'build'], process.env);
    if (buildCode !== 0) {
      process.exit(buildCode);
    }

    const server = spawn(process.execPath, [appServerScript], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
      },
    });

    server.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
    return;
  }

  // Default API port 8888; when API_PORT=0 pick a free port so local E2E never
  // collides with another worktree's hardcoded 8888 server.
  const apiPort = process.env.API_PORT === '0' ? await getFreePort() : '8888';
  const apiServer = spawn(process.execPath, [appServerScript], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(apiPort) },
  });
  apiServer.on('error', (err) => console.error('[vite-dev] API server error:', err.message));

  const child = spawn(process.execPath, [viteBin, '--port', String(port)], {
    stdio: 'inherit',
    env: { ...process.env, VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
  });

  // Fail-fast guard: once we start shutting down normally, API termination is
  // expected. Any earlier API death must kill the whole bootstrap instead of
  // leaving E2E to fail later with confusing timeout errors.
  let shuttingDown = false;

  function cleanup() {
    shuttingDown = true;
    try {
      apiServer.kill();
    } catch {}
    try {
      child.kill();
    } catch {}
  }
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  child.on('exit', (code, signal) => {
    shuttingDown = true;
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  apiServer.on('exit', (code, signal) => {
    if (shuttingDown || child.exitCode !== null) return;
    console.error(
      `[vite-dev] Servidor API terminou inesperadamente (${signal ? `sinal ${signal}` : `código ${code}`}); encerrando o bootstrap do E2E imediatamente.`
    );
    try {
      child.kill();
    } catch {}
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[vite-dev]', err?.stack || err?.message || err);
  process.exit(1);
});
