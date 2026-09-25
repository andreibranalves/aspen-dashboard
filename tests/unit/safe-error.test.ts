import assert from 'node:assert/strict';
import test from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { safeErrorFields, safeErrorForReport, safeErrorSummary } from '../../api/_shared/safe-error.js';

const PHONE = '5511987654321';

class RepositoryError extends Error {
  constructor(options?: ErrorOptions) {
    super('Não foi possível atualizar a fila de follow-up. Tente novamente.', options);
    this.name = 'RepositoryError';
  }
}

// Mesmo formato do PostgresError do driver `postgres`: Object.assign dos campos do servidor.
function postgresError(fields: Record<string, unknown>): Error {
  const error = new Error(String(fields.message));
  error.name = 'PostgresError';
  return Object.assign(error, fields);
}

function wrappedUniqueViolation(): Error {
  const database = postgresError({
    message: `duplicate key value violates unique constraint "commercial_inbound_events_provider_message_unique"`,
    detail: `Key (instance, provider_message_id)=(aspen, ${PHONE}) already exists.`,
    code: '23505',
    constraint_name: 'commercial_inbound_events_provider_message_unique',
    table_name: 'commercial_inbound_events',
    schema_name: 'public',
    routine: '_bt_check_unique',
    query: 'insert into "commercial_inbound_events" values ($1, $2)',
    parameters: ['aspen', PHONE],
  });
  const query = new DrizzleQueryError('insert into "commercial_inbound_events" values ($1, $2)', ['aspen', PHONE], database);
  return new RepositoryError({ cause: query });
}

test('segue a cadeia de cause e extrai só código e identificadores do schema', () => {
  assert.deepEqual(safeErrorFields(wrappedUniqueViolation()), {
    chain: ['RepositoryError', 'DrizzleQueryError', 'PostgresError'],
    code: '23505',
    constraint: 'commercial_inbound_events_provider_message_unique',
    table: 'commercial_inbound_events',
    column: undefined,
    routine: '_bt_check_unique',
  });
});

test('o resumo nunca carrega mensagem, detail, query ou parâmetros', () => {
  const summary = safeErrorSummary(wrappedUniqueViolation());
  assert.equal(
    summary,
    'RepositoryError > DrizzleQueryError > PostgresError code=23505 constraint=commercial_inbound_events_provider_message_unique table=commercial_inbound_events routine=_bt_check_unique',
  );
  assert.doesNotMatch(summary, new RegExp(PHONE));
  assert.doesNotMatch(summary, /insert|Key \(|Tente novamente/);
});

test('descarta campos fora do formato esperado em vez de repassá-los', () => {
  const hostile = postgresError({ message: 'x', code: `23505 ${PHONE}`, table_name: `clients where phone='${PHONE}'` });
  assert.deepEqual(safeErrorFields(hostile), { chain: ['PostgresError'], code: undefined, constraint: undefined, table: undefined, column: undefined, routine: undefined });
});

test('aceita valores que não são Error, códigos de rede e ciclos de cause', () => {
  assert.equal(safeErrorSummary('texto solto com ' + PHONE), 'string');
  assert.equal(safeErrorSummary(null), 'null');
  const network = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }) });
  assert.equal(safeErrorSummary(network), 'TypeError > Error code=ECONNREFUSED');
  const loop = new Error('a');
  (loop as { cause?: unknown }).cause = loop;
  assert.equal(safeErrorSummary(loop), 'Error');
});

test('a cópia para o Sentry mantém classe e frames, sem mensagem original nem cause', () => {
  const original = wrappedUniqueViolation();
  const report = safeErrorForReport(original);
  assert.equal(report.name, 'RepositoryError');
  assert.equal(report.message, safeErrorSummary(original));
  assert.equal(report.cause, undefined);
  assert.doesNotMatch(report.stack ?? '', new RegExp(PHONE));
  assert.doesNotMatch(report.stack ?? '', /Tente novamente/);
  assert.match(report.stack ?? '', /\n\s+at \S.*:\d+:\d+\)?$/m);
});
