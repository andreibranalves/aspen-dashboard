import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogIn, ShieldAlert } from 'lucide-react';

interface LoginPageProps {
  navigate: (hash: string) => void;
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
    fetch('/api/quotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
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
        setError(typeof data?.error === 'string' ? data.error : 'Erro ao autenticar.');
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page p-4">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/20">
            <ShieldAlert className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Aspen Orçamento</h1>
          <p className="text-sm text-fg-muted mt-1">Entre com a senha para continuar</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              placeholder="Senha de acesso"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPassword(e.target.value);
                setError('');
              }}
              autoFocus
              disabled={loading}
              className="text-center text-lg tracking-widest"
            />
          </div>

          {error && (
            <p className="text-center text-sm text-destructive/60 animate-in fade-in">{error}</p>
          )}

          <Button type="submit" disabled={loading || !password.trim()} className="w-full" size="lg">
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
