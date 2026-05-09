import { cn } from '@/lib/utils.js';

/**
 * PageHeader — cabeçalho de página reutilizável.
 * Substitui h1 duplicado com a TopBar e padroniza título + descrição + ação.
 *
 * @param {string}  title       — título da página (obrigatório)
 * @param {string}  description — descrição curta (opcional)
 * @param {node}    action      — ação primária (botão/link, opcional)
 * @param {string}  className   — classes extras
 */
export default function PageHeader({ title, description, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="shrink-0">{action}</div>
      )}
    </div>
  );
}
