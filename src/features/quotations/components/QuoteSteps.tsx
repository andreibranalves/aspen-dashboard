import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type QuoteStep = 'order' | 'review' | 'send';

const STEPS: ReadonlyArray<{ id: QuoteStep; label: string }> = [
  { id: 'order', label: 'Pedido' },
  { id: 'review', label: 'Revisão' },
  { id: 'send', label: 'Envio' },
];

interface QuoteStepsProps {
  current: QuoteStep;
  /** Etapa que o operador pode reabrir a partir da atual. */
  reachable?: QuoteStep | null;
  onSelect?: (step: QuoteStep) => void;
}

/** Trilho do card de novo orçamento: etapas concluídas, a atual e as seguintes. */
export default function QuoteSteps({ current, reachable = null, onSelect }: QuoteStepsProps) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Etapas do orçamento" className="-mx-3 flex items-center">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const content = (
          <>
            {done && <Check size={14} className="text-success" aria-hidden="true" />}
            <span className={cn(active && 'border-b-2 border-primary py-1')}>
              {step.label}
              {done && <span className="sr-only"> (concluída)</span>}
            </span>
          </>
        );
        return (
          <li key={step.id} aria-current={active ? 'step' : undefined}>
            {reachable === step.id && onSelect ? (
              // eslint-disable-next-line no-restricted-syntax -- etapa do trilho, no mesmo tipo das vizinhas
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                className="flex h-8 items-center gap-2 rounded-control px-3 text-compact font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                {content}
              </button>
            ) : (
              <span
                // Sem cn: o tailwind-merge descarta text-compact ao lado de text-fg.
                className={`flex h-8 items-center gap-2 px-3 text-compact ${active ? 'font-semibold text-fg' : 'text-fg-muted'}`}
              >
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
