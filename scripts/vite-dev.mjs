import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

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

async function main() {
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

  function cleanup() {
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
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  apiServer.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error('[vite-dev] API server exited with code', code);
    }
  });
}

main().catch((err) => {
  console.error('[vite-dev]', err?.stack || err?.message || err);
  process.exit(1);
});
