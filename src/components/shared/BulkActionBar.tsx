import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * BulkActionBar — barra fixa inferior para seleção em massa em listas.
 * Visível enquanto houver seleção; conteúdo (resumo + ações) fica na página.
 */
export interface BulkActionBarProps {
  visible: boolean;
  children: ReactNode;
}

export default function BulkActionBar({ visible, children }: BulkActionBarProps) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 transition-all duration-300',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none',
      )}
    >
      <div className="mx-auto max-w-[1060px] px-4">
        <div className="overflow-hidden rounded-t-lg border border-b-0 border-line bg-surface/95 backdrop-blur shadow-[0_-12px_24px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
