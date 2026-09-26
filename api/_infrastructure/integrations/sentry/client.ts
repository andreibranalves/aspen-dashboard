import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';
import {
  safeErrorFields,
  safeErrorForReport,
  safeErrorSummary,
} from '../../../_shared/safe-error.js';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.ASPEN_WORKER_SHA,
    sampleRate: 1,
    defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
    // O modo padrão ("warn") imprime o stack cru da rejeição no log.
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'none' })],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: () => null,
    beforeSend(event, hint) {
      event.request = undefined;
      event.user = undefined;
      event.breadcrumbs = [];
      return scrubUnhandledException(event, hint);
    },
  });
}

/**
 * Exceção não tratada que o próprio SDK captura (processo do worker, promise
 * solta) chega com a mensagem crua, que pode trazer SQL e valores; fica só o
 * resumo seguro. As capturas do código já passam por `safeErrorForReport`.
 */
export function scrubUnhandledException(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const values = event.exception?.values ?? [];
  if (!values.some((value) => value.mechanism?.handled === false)) return event;
  const summary = safeErrorSummary(hint.originalException);
  for (const value of values) value.value = summary;
  // Rejeição com valor que não é Error vai serializada em `extra`.
  event.extra = undefined;
  return event;
}

function captureSafely(error: unknown, tags: Record<string, string>): void {
  if (!dsn) return;

  Sentry.withScope((scope) => {
    for (const [name, value] of Object.entries(tags)) scope.setTag(name, value);
    // A mensagem e o `cause` de erros do banco carregam SQL e valores; vai só a cópia segura.
    const { code, constraint, table } = safeErrorFields(error);
    if (code) scope.setTag('error.code', code);
    if (constraint) scope.setTag('db.constraint', constraint);
    if (table) scope.setTag('db.table', table);
    Sentry.captureException(safeErrorForReport(error));
  });
}

export function captureApiException(
  error: unknown,
  context: { routeName: string; method: string }
): void {
  captureSafely(error, {
    component: 'api',
    route: context.routeName || 'unknown',
    'http.method': context.method || 'UNKNOWN',
  });
}

/** Erro do aspen-worker no VPS; `task` nomeia o trabalho (ex.: `startup`). */
export function captureWorkerException(error: unknown, context: { task: string }): void {
  captureSafely(error, { component: 'worker', task: context.task });
}

/** Espera o envio dos eventos pendentes antes de o processo sair. */
export async function flushErrorReports(timeoutMs: number): Promise<void> {
  if (!dsn) return;
  await Sentry.flush(timeoutMs);
}
