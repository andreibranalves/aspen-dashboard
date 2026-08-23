import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NotFoundPageProps {
  navigate: (hash: string) => void;
}

/** Tela 404 para rotas sem match — nunca cair silenciosamente no fluxo Auto. */
export default function NotFoundPage({ navigate }: NotFoundPageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface-muted mb-4">
        <Compass size={32} className="text-fg-muted" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold text-fg">Página não encontrada</h1>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        O endereço acessado não existe ou foi movido.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
          Ir para o Início
        </Button>
        <Button size="sm" onClick={() => navigate('/auto')}>
          Abrir Auto
        </Button>
      </div>
    </div>
  );
}
