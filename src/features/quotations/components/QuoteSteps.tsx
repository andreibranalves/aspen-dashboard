import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <ol aria-label="Etapas do orçamento" className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const content = (
          <>
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-2xs font-semibold tabular-nums',
                done && 'bg-success-fill text-success-foreground',
                active && 'bg-primary text-on-solid',
                !done && !active && 'border border-line text-fg-muted'
              )}
            >
              {done ? <Check size={14} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}
            </span>
            <span
              className={cn(
                'text-sm',
                active ? 'font-semibold text-primary-text' : done ? 'font-medium text-fg' : 'text-fg-muted',
                !active && 'max-sm:sr-only'
              )}
            >
              {step.label}
              {done && <span className="sr-only"> (concluída)</span>}
            </span>
          </>
        );
        return (
          <li key={step.id} aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn('h-px w-4 sm:w-6', index <= currentIndex ? 'bg-success' : 'bg-line')}
              />
            )}
            {reachable === step.id && onSelect ? (
              <Button type="button" variant="ghost" onClick={() => onSelect(step.id)}>
                {content}
              </Button>
            ) : (
              <span
                className={cn(
                  'flex h-8 items-center gap-2 rounded-control',
                  active ? 'bg-surface-selected px-3' : 'px-1'
                )}
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
