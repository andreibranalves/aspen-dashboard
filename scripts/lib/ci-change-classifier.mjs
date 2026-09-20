// Classificação conservadora do diff do CI.
//
// Somente arquivos Markdown em `docs/` e um conjunto curto de documentos na
// raiz são docs-only. Qualquer configuração, script, teste, runtime ou caminho
// desconhecido mantém as lanes de código ativas.

const DOCUMENTATION_FILES = new Set([
  'AGENTS.md',
  'ARCHITECTURE.md',
  'CLAUDE.md',
  'CONTEXT.md',
  'PRODUCT.md',
  'README.md',
  'aspen-dashboard-plano-refatoracao.md',
  '.github/issue_template.md',
  '.github/pull_request_template.md',
]);

export function isClearlyDocumentary(path) {
  const value = String(path);
  return value.endsWith('.md') && (value.startsWith('docs/') || DOCUMENTATION_FILES.has(value));
}

/**
 * Interpreta `git diff --name-status -z`. Com `-z`, renames/copies trazem as
 * duas pontas como tokens separados; ambas entram na classificação.
 */
export function parseNameStatusZ(output) {
  const tokens = String(output).split('\0');
  const paths = [];
  let index = 0;
  while (index < tokens.length && tokens[index] !== '') {
    const status = tokens[index++];
    if (/^[RC]/.test(status)) {
      if (index + 1 >= tokens.length || tokens[index] === '' || tokens[index + 1] === '') {
        throw new Error('git diff retornou renomeação sem as duas pontas.');
      }
      paths.push(tokens[index++], tokens[index++]);
      continue;
    }
    if (index >= tokens.length || tokens[index] === '') {
      throw new Error('git diff retornou status sem caminho.');
    }
    paths.push(tokens[index++]);
  }
  return paths;
}

export function classifyChangedPaths(paths) {
  const changedPaths = [...paths].map((path) => String(path));
  const docsOnly =
    changedPaths.length > 0 && changedPaths.every((path) => isClearlyDocumentary(path));
  return { code: !docsOnly && changedPaths.length > 0, docsOnly, changedPaths };
}
