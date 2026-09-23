import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import ErrorState from './components/shared/ErrorState';
import { applyTheme, readTheme } from './lib/theme';
import { Sentry } from './lib/sentry';
import './index.css';

applyTheme(readTheme());

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <main className="grid min-h-dvh place-items-center bg-canvas p-6">
          <ErrorState
            className="w-full max-w-2xl"
            title="Não foi possível exibir esta tela."
            onRetry={() => window.location.reload()}
          />
        </main>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);
