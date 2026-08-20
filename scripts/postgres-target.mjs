import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parsePostgresUrl(raw, name = 'DATABASE_URL') {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} inválida.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${name} deve usar o esquema PostgreSQL.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database || !parsed.hostname) {
    throw new Error(`${name} precisa informar host e database.`);
  }
  return {
    raw,
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get('sslmode') || undefined,
  };
}

export function postgresIdentity(connection) {
  return [connection.host.toLowerCase(), connection.port, connection.database].join('|');
}

export function assertProtectedFile(filepath, label) {
  let stat;
  try {
    stat = lstatSync(resolve(filepath));
  } catch {
    throw new Error(`${label} não pôde ser lido.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} deve ser arquivo regular com permissão 0600.`);
  }
}

export function readPostgresServiceTarget({ serviceName, serviceFile, expectedDatabase, label }) {
  let active = false;
  const values = {};
  try {
    for (const rawLine of readFileSync(serviceFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        active = section[1].trim() === serviceName;
        continue;
      }
      if (!active || !line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator !== -1) {
        values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
    }
  } catch {
    throw new Error('PGSERVICEFILE não pôde ser lido.');
  }
  const target = {
    host: values.host,
    port: values.port || '5432',
    database: values.dbname || values.database,
  };
  if (values.hostaddr && values.hostaddr !== target.host) {
    throw new Error(`${label} não pode sobrescrever host com hostaddr.`);
  }
  if (!target.host || !target.database) {
    throw new Error(`${label} não informa host e database.`);
  }
  if (expectedDatabase && target.database !== expectedDatabase) {
    throw new Error(`Database esperado não corresponde a ${label}.`);
  }
  return { name: serviceName, file: serviceFile, expectedDatabase, target };
}

export function assertSamePostgresTarget(connection, service, message) {
  if (postgresIdentity(connection) !== postgresIdentity(service.target)) throw new Error(message);
}

export function postgresServiceEnvironment(service, inheritedEnv = process.env) {
  const env = { ...inheritedEnv };
  const passFile = env.PGPASSFILE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('PG')) delete env[key];
  }
  for (const key of [
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'RESTORE_DATABASE_URL',
    'STAGING_DATABASE_URL',
    'PRODUCTION_DATABASE_URL',
  ]) {
    delete env[key];
  }
  env.PGSERVICEFILE = service.file;
  env.PGSERVICE = service.name;
  if (passFile) env.PGPASSFILE = passFile;
  return env;
}
