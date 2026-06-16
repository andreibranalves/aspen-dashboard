import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

  const child = spawn(process.execPath, [viteBin, '--port', String(port)], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[vite-dev]', err?.stack || err?.message || err);
  process.exit(1);
});
