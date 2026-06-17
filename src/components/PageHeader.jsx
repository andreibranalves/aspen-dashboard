import { cn } from '@/lib/utils.js';

/**
 * PageHeader — cabeçalho de página reutilizável.
 * Título padronizado em text-2xl (igual à página de Produtos).
 *
 * @param {string}  title     — título da página (obrigatório)
 * @param {node}    action    — ação primária (botão/link, opcional)
 * @param {string}  className — classes extras
 */
export default function PageHeader({ title, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      </div>
      {action && (
        <div className="shrink-0">{action}</div>
      )}
    </div>
  );
}
