import type { ReactNode } from 'react';

/**
 * BulkActionBar — barra fixa inferior para seleção em massa em listas.
 * Visível enquanto houver seleção; conteúdo (resumo + ações) fica na página.
 */
export interface BulkActionBarProps {
  visible: boolean;
  children: ReactNode;
}

export default function BulkActionBar({ visible, children }: BulkActionBarProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-floating">
      <div className="w-full px-4">
        <div className="overflow-hidden rounded-t-card border border-b-0 border-line bg-surface/95 backdrop-blur shadow-bar">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
