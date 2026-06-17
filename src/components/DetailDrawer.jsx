import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

/**
 * DetailDrawer — painel lateral reutilizável para drill-down operacional.
 *
 * Comportamento:
 *   Desktop (lg+): overlay escuro + painel à direita com largura limitada.
 *   Mobile (<lg): tela quase cheia, rolável internamente.
 *
 * Props:
 *   open        — controla visibilidade
 *   onClose     — callback para fechar (Escape também fecha)
 *   title       — título do drawer
 *   description — subtítulo opcional
 *   actions     — nó React opcional (ex: <ContextActions>)
 *   children    — conteúdo principal (rolável)
 *   className   — classe extra para o container
 */

export function DetailDrawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  className,
}) {
  // Fecha ao pressionar Escape
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape' && open) {
        onClose?.();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      // Previne scroll do body quando drawer está aberto
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Painel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex h-full flex-col bg-white shadow-2xl dark:bg-surface',
          // Mobile: tela cheia
          'w-full',
          // Desktop: painel lateral com largura limitada
          'lg:max-w-xl',
          className,
        )}
      >
        {/* Cabeçalho */}
        <div className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 dark:border-line">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold text-fg truncate">
              {title || 'Detalhes'}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-fg-muted line-clamp-2">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-full p-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Ações (se fornecidas) */}
        {actions && (
          <div className="shrink-0 border-b border-line px-5 py-3 dark:border-line">
            {actions}
          </div>
        )}

        {/* Conteúdo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
