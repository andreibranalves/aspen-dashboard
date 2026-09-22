import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/shared/PageShell';

interface NotFoundPageProps {
  navigate: (hash: string) => void;
}

/** Tela 404 para rotas sem match — nunca cair silenciosamente no fluxo Auto. */
export default function NotFoundPage({ navigate }: NotFoundPageProps) {
  return (
    <PageShell
      className="flex min-h-[65vh] flex-col items-center justify-center px-4 py-16 text-center space-y-0"
      aria-labelledby="not-found-title"
    >
      <span className="text-[90px] font-bold leading-none tracking-[-0.06em] text-sage" aria-hidden="true">404</span>
      <h1 id="not-found-title" className="mt-4 text-2xl font-bold text-fg">
        Esta página não foi encontrada.
      </h1>
      <p className="mt-2 max-w-md text-sm leading-5 text-fg-muted">
        Volte aos orçamentos ou escolha outra tela no menu.
      </p>
      <div className="mt-6">
        <Button
          onClick={() => navigate('/quotations')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar aos orçamentos
        </Button>
      </div>
    </PageShell>
  );
}
