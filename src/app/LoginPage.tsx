import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDarkMode } from '@/hooks/useDarkMode';
import { LogIn, ShieldAlert } from 'lucide-react';

interface LoginPageProps {
  navigate: (hash: string) => void;
}

const LOGIN_ERROR_MESSAGES = new Set([
  'Senha incorreta.',
  'Autenticação indisponível. Tente novamente mais tarde.',
  'Método não permitido.',
  'JSON inválido.',
]);

function formatLoginError(data: Record<string, unknown> | null): string {
  const message = typeof data?.error === 'string' ? data.error : '';
  return LOGIN_ERROR_MESSAGES.has(message)
    ? message
    : 'Não foi possível entrar. Confira a senha e tente novamente.';
}

/**
 * LoginPage — tela de autenticação full-screen.
 * Mostrada quando a API retorna 401 ou quando o usuário acessa #/login.
 */
export default function LoginPage({ navigate }: LoginPageProps) {
  useDarkMode();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Se já tem cookie válido, redireciona
  useEffect(() => {
    fetch('/api/quotations?limit=1')
      .then((res) => {
        if (res.status === 200 || res.status === 404) {
          navigate('/quotations');
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password.trim()) return;

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (res.ok) {
        navigate('/quotations');
      } else {
        setError(formatLoginError(data));
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-8 sm:py-12">
      <main className="w-full max-w-md" aria-labelledby="login-title">
        <section className="rounded-lg border border-line bg-surface p-6 sm:p-8">
          <div className="text-center">
            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary">
              <ShieldAlert className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
            </div>
            <h1 id="login-title" className="text-xl font-semibold tracking-tight text-fg">
              Aspen Orçamento
            </h1>
            <p className="mt-1 text-sm text-fg-muted">Entre com a senha para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-sm font-medium text-fg">
                Senha de acesso
              </label>
              <Input
                id="login-password"
                name="password"
                type="password"
                placeholder="Senha de acesso"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                autoComplete="current-password"
                autoFocus
                disabled={loading}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                className="text-lg tracking-widest"
              />
            </div>

            {error && (
              <p
                id="login-error"
                role="alert"
                className="text-sm text-destructive animate-in fade-in"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !password.trim()}
              aria-busy={loading}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                  aria-hidden="true"
                />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
