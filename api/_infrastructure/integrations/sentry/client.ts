import * as Sentry from '@sentry/node';
import { safeErrorFields, safeErrorForReport } from '../../../_shared/safe-error.js';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    sampleRate: 1,
    defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
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
    beforeSend(event) {
      event.request = undefined;
      event.user = undefined;
      event.breadcrumbs = [];
      return event;
    },
  });
}

export function captureApiException(
  error: unknown,
  context: { routeName: string; method: string }
): void {
  if (!dsn) return;

  Sentry.withScope((scope) => {
    scope.setTag('component', 'api');
    scope.setTag('route', context.routeName || 'unknown');
    scope.setTag('http.method', context.method || 'UNKNOWN');
    // A mensagem e o `cause` de erros do banco carregam SQL e valores; vai só a cópia segura.
    const { code, constraint, table } = safeErrorFields(error);
    if (code) scope.setTag('error.code', code);
    if (constraint) scope.setTag('db.constraint', constraint);
    if (table) scope.setTag('db.table', table);
    Sentry.captureException(safeErrorForReport(error));
  });
}
