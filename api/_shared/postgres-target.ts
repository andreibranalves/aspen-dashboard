export interface PostgresRuntimeConnection {
  raw: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

const ALLOWED_URL_PARAMETERS = new Set(['sslmode']);
const ENCODED_HOST_DELIMITER = /%(?:25)*(?:3a|5b|5d)/i;
const AMBIGUOUS_ENVIRONMENT_KEYS = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGUSERNAME',
  'PGPASSWORD',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
  'PGOPTIONS',
  'PGSSL',
  'PGSSLMODE',
  'PGSSLROOTCERT',
  'PGSSLNEGOTIATION',
  'PGTARGETSESSIONATTRS',
  'PGAPPNAME',
  'PGIDLE_TIMEOUT',
  'PGCONNECT_TIMEOUT',
  'PGMAX_LIFETIME',
  'PGMAX_PIPELINE',
  'PGBACKOFF',
  'PGKEEP_ALIVE',
  'PGPREPARE',
  'PGDEBUG',
  'PGFETCH_TYPES',
  'PGPUBLICATIONS',
] as const;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parsePostgresRuntimeUrl(
  raw: unknown,
  env: Readonly<Record<string, unknown>> = process.env
): PostgresRuntimeConnection {
  let parsed: URL;
  try {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error();
    parsed = new URL(raw);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error();
    const decodedHostname = decodeURIComponent(parsed.hostname);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (
      !parsed.hostname ||
      decodedHostname.includes(':') ||
      decodedHostname.includes('[') ||
      decodedHostname.includes(']') ||
      parsed.hostname.includes(',') ||
      ENCODED_HOST_DELIMITER.test(decodedHostname) ||
      !parsed.port ||
      !database ||
      !user ||
      parsed.hash
    ) {
      throw new Error();
    }
    const parameters = [...parsed.searchParams.keys()];
    if (parameters.some((key) => !ALLOWED_URL_PARAMETERS.has(key))) throw new Error();
    if (parsed.searchParams.has('sslmode') && !clean(parsed.searchParams.get('sslmode'))) {
      throw new Error();
    }
    if (AMBIGUOUS_ENVIRONMENT_KEYS.some((key) => clean(env[key]))) throw new Error();
    return {
      raw: raw.trim(),
      host: parsed.hostname.toLowerCase(),
      port: parsed.port,
      user,
      password,
      database,
      sslmode: parsed.searchParams.get('sslmode') || undefined,
    };
  } catch {
    throw new Error('DATABASE_URL precisa informar um alvo PostgreSQL explícito e não ambíguo.');
  }
}

export function postgresRuntimeIdentity(connection: PostgresRuntimeConnection): string {
  return JSON.stringify([connection.host, connection.port, connection.database, connection.user]);
}

export function postgresRuntimeOptions(connection: PostgresRuntimeConnection) {
  return {
    host: connection.host,
    port: Number(connection.port),
    database: connection.database,
    username: connection.user,
    password: connection.password,
    ssl: connection.sslmode || false,
  };
}
