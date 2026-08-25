import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NotFoundPageProps {
  navigate: (hash: string) => void;
}

/** Tela 404 para rotas sem match — nunca cair silenciosamente no fluxo Auto. */
export default function NotFoundPage({ navigate }: NotFoundPageProps) {
  return (
    <section
      className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-16 text-center animate-fade-in sm:py-24"
      aria-labelledby="not-found-title"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-surface-muted">
        <Compass size={28} className="text-fg-muted" aria-hidden="true" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Erro 404</p>
      <h1 id="not-found-title" className="mt-2 text-xl font-semibold text-fg">
        Página não encontrada
      </h1>
      <p className="mt-2 max-w-md text-sm leading-5 text-fg-muted">
        Não encontramos este endereço. Volte para uma área válida ou abra o fluxo de orçamento para
        continuar.
      </p>
      <div className="mt-6 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => navigate('/dashboard')}
        >
          Ir para o Início
        </Button>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => navigate('/auto')}>
          Abrir Auto
        </Button>
      </div>
    </section>
  );
}
