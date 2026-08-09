// Local environment loader shared by development servers.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function localEnvPaths(env = process.env) {
  const configuredPath = env.DOTENV_CONFIG_PATH?.trim();
  if (configuredPath) return [configuredPath];

  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return [join(configHome, 'aspen-dashboard', '.env'), '.env'];
}

export function loadLocalEnv(env = process.env) {
  const envPath = localEnvPaths(env).find(existsSync);
  if (!envPath) return null;

  const envFile = readFileSync(envPath, 'utf8');
  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }

  return envPath;
}
