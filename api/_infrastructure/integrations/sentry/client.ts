import * as Sentry from '@sentry/node';

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
    Sentry.captureException(error);
  });
}
