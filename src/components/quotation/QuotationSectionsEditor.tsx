import type { QuotationSectionsSettings } from '@/lib/settingsApi';
import { Button } from '@/components/ui/button';

export interface QuotationSectionsEditorProps {
  mode: 'settings' | 'revision';
  sections: QuotationSectionsSettings;
  editable: boolean;
  onChange: (sections: QuotationSectionsSettings) => void;
  productionDeadline?: string;
  onProductionDeadlineChange?: (value: string) => void;
  onRestore?: () => void;
}

const TEXTAREA_CLASS =
  'w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50';

export function QuotationSectionsEditor({
  mode,
  sections,
  editable,
  onChange,
  productionDeadline,
  onProductionDeadlineChange,
  onRestore,
}: QuotationSectionsEditorProps) {
  const update = (
    key: 'prazo_producao' | 'pagamento' | 'condicoes_gerais',
    field: 'enabled' | 'title' | 'body',
    value: string | boolean
  ) => {
    const section = sections[key];
    onChange({
      ...sections,
      [key]: { ...section, [field]: value },
    });
  };

  const cards = [
    { key: 'prazo_producao' as const, label: 'Prazo de produção', body: false },
    { key: 'pagamento' as const, label: 'Pagamento', body: true },
    { key: 'condicoes_gerais' as const, label: 'Condições Gerais', body: true },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map(({ key, label, body }) => {
        const section = sections[key];
        return (
          <article key={key} className="space-y-3 rounded-xl border border-line bg-surface-muted p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-fg">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(event) => update(key, 'enabled', event.target.checked)}
                disabled={!editable}
              />
              Exibir seção
            </label>
            <label className="block space-y-1.5 text-sm text-fg">
              <span className="font-medium">Título</span>
              <input
                aria-label={`Título - ${label}`}
                value={section.title}
                onChange={(event) => update(key, 'title', event.target.value)}
                disabled={!editable}
                className="w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            {body && (
              <label className="block space-y-1.5 text-sm text-fg">
                <span className="font-medium">Conteúdo</span>
                <textarea
                  aria-label={key === 'pagamento' ? 'Condição de pagamento' : 'Observações padrão'}
                  value={section.body}
                  onChange={(event) => update(key, 'body', event.target.value)}
                  disabled={!editable}
                  maxLength={4000}
                  rows={5}
                  className={TEXTAREA_CLASS}
                />
              </label>
            )}
            {key === 'prazo_producao' && (
              <>
                <p className="text-xs text-fg-muted">
                  O prazo de produção usa o campo do orçamento.
                </p>
                {mode === 'revision' && onProductionDeadlineChange && (
                  <label className="block space-y-1.5 text-sm text-fg">
                    <span className="font-medium">Prazo desta revisão</span>
                    <input
                      value={productionDeadline || ''}
                      onChange={(event) => onProductionDeadlineChange(event.target.value)}
                      disabled={!editable}
                      className="w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                )}
              </>
            )}
            {mode === 'revision' && onRestore && (
              <Button type="button" variant="outline" size="sm" onClick={onRestore} disabled={!editable}>
                Restaurar padrão
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}
