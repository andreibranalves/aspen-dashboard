import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { LogIn, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LoginPage — tela de autenticação full-screen.
 * Mostrada quando a API retorna 401 ou quando o usuário acessa #/login.
 */
export default function LoginPage({ navigate }) {
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

  async function handleSubmit(e) {
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

      const data = await res.json().catch(() => null);

      if (res.ok) {
        navigate('/quotations');
      } else {
        setError(data?.error || 'Erro ao autenticar.');
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
          <div
            className={cn(
              'inline-flex items-center justify-center w-14 h-14 rounded-2xl',
              'mb-4 shadow-lg shadow-primary/20'
            )}
            style={{
              background: 'linear-gradient(135deg, var(--accent-ice), var(--accent-twilight))',
            }}
          >
            <ShieldAlert className="w-7 h-7 text-white" />
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
              onChange={(e) => {
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
