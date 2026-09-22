import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import AspenBrand from '@/components/shared/AspenBrand';

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
    <div className="min-h-dvh bg-canvas md:p-frame">
      <main className="grid min-h-dvh items-center gap-10 bg-page p-6 text-fg md:min-h-[calc(100dvh-36px)] md:grid-cols-2 md:rounded-shell md:px-[6%]" aria-labelledby="login-title">
        <div className="max-w-lg py-8 md:p-10">
          <AspenBrand />
          <h1 id="login-title" className="mt-10 max-w-[430px] text-[32px] font-bold leading-[1.18] tracking-[-0.04em] md:text-5xl">
            Da conversa ao próximo bom negócio.
          </h1>
          <p className="mt-5 max-w-[330px] text-sm text-fg-muted">
            Acompanhe clientes, propostas e pedidos em um único lugar.
          </p>
        </div>
        <section className="w-full max-w-[390px] rounded-card bg-surface p-6 md:p-9">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[23px] font-bold leading-tight">Bem-vindo à Aspen</h2>
              <p className="mt-2 text-xs text-fg-muted">Entre com a senha para continuar.</p>
            </div>
            <LockKeyhole size={20} className="text-sage" aria-hidden="true" />
          </div>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
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
                className="tracking-widest"
              />
            </div>

            {error && (
              <p
                id="login-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !password.trim()}
              aria-busy={loading}
              className="mt-2 w-full"
              size="lg"
            >
              {loading ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-on-solid/30 border-t-on-solid"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
