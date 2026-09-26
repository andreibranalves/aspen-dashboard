import { Fragment, type Ref } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from './Layout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TopBarProps {
  isMobile?: boolean;
  breadcrumbItems: BreadcrumbItem[];
  onNavigate: (hash: string) => void;
  /** Slot onde o PageHeader renderiza as ações da página. */
  actionsRef?: Ref<HTMLDivElement>;
}

/** TopBar — o breadcrumb nomeia a página; à direita ficam só as ações dela. */
export default function TopBar({ isMobile = false, breadcrumbItems, onNavigate, actionsRef }: TopBarProps) {
  // No celular o breadcrumb vira só "voltar" para o item-pai; o nome da página fica oculto.
  const parent = breadcrumbItems.length > 2 ? breadcrumbItems[breadcrumbItems.length - 2] : null;

  return (
    <header
      className={cn(
        'mb-4 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-page md:mb-workspace',
        // Sem voltar nem ações da página, o celular não reserva a faixa.
        isMobile && 'hidden has-[>:not(:empty)]:flex'
      )}
    >
      {isMobile ? (
        parent?.hash && (
          <Button
            type="button"
            variant="ghost-muted"
            size="icon"
            onClick={() => onNavigate(parent.hash!)}
            aria-label={`Voltar para ${parent.label}`}
            title={`Voltar para ${parent.label}`}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        )
      ) : (
        <nav
          className="flex min-w-0 items-center gap-2 overflow-hidden text-compact text-fg-muted"
          aria-label="Trilha de navegação"
        >
          {breadcrumbItems.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight size={14} className="shrink-0" aria-hidden="true" />}
              {item.hash ? (
                <button
                  type="button"
                  onClick={() => onNavigate(item.hash!)}
                  className="truncate rounded-control py-1 transition-colors hover:text-fg"
                >
                  {item.label}
                </button>
              ) : (
                <span className="truncate font-semibold text-fg" aria-current="page">
                  {item.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      )}

      <div ref={actionsRef} className="ml-auto flex flex-wrap items-center justify-end gap-2 empty:hidden" />
    </header>
  );
}
