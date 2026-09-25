// Diagnóstico de erro sem dados. O Postgres e o Drizzle copiam valores das
// linhas (telefone, e-mail, texto da mensagem) para `message`, `detail`,
// `query` e `params`; nada disso sai daqui. Saem só nomes de classe, o código
// (SQLSTATE, driver ou Node) e identificadores do schema.

const MAX_DEPTH = 6;
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_$]{0,62}$/;
const ROUTINE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface SafeErrorFields {
  /** Classes do erro mais externo ao mais interno, seguindo `cause`. */
  chain: string[];
  /** SQLSTATE (`23505`), código do driver (`CONNECT_TIMEOUT`) ou do Node (`ECONNRESET`). */
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  /** Função interna do Postgres que levantou o erro (`_bt_check_unique`). */
  routine?: string;
}

function className(value: unknown): string {
  if (value instanceof Error) {
    // DrizzleQueryError não define `name`; a classe identifica melhor que "Error".
    const constructorName = value.constructor?.name ?? '';
    if (value.name !== 'Error' && CLASS_NAME.test(value.name)) return value.name;
    if (CLASS_NAME.test(constructorName)) return constructorName;
    return 'Error';
  }
  return value === null ? 'null' : typeof value;
}

function pick(value: unknown, key: string, pattern: RegExp): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && pattern.test(field) ? field : undefined;
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  const fields: SafeErrorFields = { chain: [] };
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (fields.chain.length < MAX_DEPTH && !seen.has(current)) {
    seen.add(current);
    fields.chain.push(className(current));
    // O erro mais interno que traz o campo é o que veio do banco ou da rede.
    fields.code = pick(current, 'code', CODE) ?? fields.code;
    fields.constraint = pick(current, 'constraint_name', IDENTIFIER) ?? fields.constraint;
    fields.table = pick(current, 'table_name', IDENTIFIER) ?? fields.table;
    fields.column = pick(current, 'column_name', IDENTIFIER) ?? fields.column;
    fields.routine = pick(current, 'routine', ROUTINE) ?? fields.routine;
    if (typeof current !== 'object' || current === null || !('cause' in current)) break;
    current = (current as { cause?: unknown }).cause;
    if (current === undefined) break;
  }
  return fields;
}

/** Uma linha para `console.error`: `RepositoryError > PostgresError code=23505 table=x`. */
export function safeErrorSummary(error: unknown): string {
  const { chain, ...details } = safeErrorFields(error);
  const pairs = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  return [chain.join(' > '), ...pairs].join(' ');
}

/**
 * Cópia reportável (Sentry): mesma classe e mesmas linhas de stack, mensagem
 * trocada pelo resumo seguro e sem `cause`, que levaria a mensagem original.
 */
export function safeErrorForReport(error: unknown): Error {
  const fields = safeErrorFields(error);
  const report = new Error(safeErrorSummary(error));
  report.name = fields.chain[0] ?? 'Error';
  const frames =
    error instanceof Error && typeof error.stack === 'string'
      ? // Só linhas de frame (`at fn (arquivo:linha:coluna)`); a mensagem, que pode
        // ter várias linhas de SQL, fica de fora.
        error.stack.split('\n').filter((line) => /^\s+at \S.*:\d+:\d+\)?$/.test(line))
      : [];
  report.stack = [`${report.name}: ${report.message}`, ...frames].join('\n');
  return report;
}

/** Texto de log de um erro capturado: o `logMessage` escrito no código ou o resumo seguro. */
export function safeLogMessage(error: unknown): string {
  const logMessage =
    typeof error === 'object' && error !== null ? (error as { logMessage?: unknown }).logMessage : undefined;
  return typeof logMessage === 'string' && logMessage ? logMessage : safeErrorSummary(error);
}
