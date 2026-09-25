// Resolve a URL da branch Neon `preview/<branch-git>` que a integração Vercel +
// Neon cria para o Preview do PR. Usada só por `migrate:apply --target preview`;
// a prova de que o alvo não é produção fica no preflight do apply.
import { execFileSync } from 'node:child_process';
import { parsePostgresUrl } from '../postgres-target.mjs';

// Mesmo projeto de .github/workflows/neon-preview-prune.yml.
const NEON_PROJECT_API = 'https://console.neon.tech/api/v2/projects/dawn-art-45435232';

export function currentGitBranch(execute = execFileSync) {
  return String(execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })).trim();
}

async function neonGet(path, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${NEON_PROJECT_API}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    throw new Error('Falha ao consultar a API do Neon.', { cause: error });
  }
  if (!response.ok) throw new Error(`API do Neon respondeu ${response.status}.`);
  return response.json();
}

export async function resolvePreviewDatabaseUrl({ env = process.env, gitBranch, fetchImpl = fetch } = {}) {
  const branch = String(gitBranch || '').trim();
  if (!branch || branch === 'HEAD' || branch === 'master') {
    throw new Error('Rode o apply preview a partir da branch Git do PR.');
  }
  // A branch Neon herda databases e roles de produção; o apply usa os mesmos.
  const production = parsePostgresUrl(env.PRODUCTION_DATABASE_URL, 'PRODUCTION_DATABASE_URL');
  const name = `preview/${branch}`;
  const { branches = [] } = await neonGet(
    `/branches?search=${encodeURIComponent(name)}`,
    env.NEON_API_KEY,
    fetchImpl,
  );
  const target = branches.find((candidate) => candidate.name === name);
  if (!target) throw new Error(`Branch Neon ${name} não existe; o Preview do PR precisa ter sido criado.`);
  if (target.default || target.primary || target.protected) {
    throw new Error(`Branch Neon ${name} não é descartável.`);
  }
  const query = new URLSearchParams({
    branch_id: target.id,
    database_name: production.database,
    role_name: production.user,
    pooled: 'false',
  });
  const { uri } = await neonGet(`/connection_uri?${query}`, env.NEON_API_KEY, fetchImpl);
  return uri;
}
