import type { QuotationSectionsSettings } from '@/lib/api/settingsApi';
import { Button } from '@/components/ui/button';

export interface QuotationSectionsSnapshot {
  schema_version: 1;
  prazo_producao: { base: QuotationSectionsSettings['prazo_producao']; current: QuotationSectionsSettings['prazo_producao'] };
  pagamento: { base: QuotationSectionsSettings['pagamento']; current: QuotationSectionsSettings['pagamento'] };
  condicoes_gerais: { base: QuotationSectionsSettings['condicoes_gerais']; current: QuotationSectionsSettings['condicoes_gerais'] };
}

type EditorSections = QuotationSectionsSettings | QuotationSectionsSnapshot;
type SectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais';

export interface QuotationSectionsEditorProps<T extends EditorSections = EditorSections> {
  mode: 'settings' | 'revision';
  sections: T;
  editable: boolean;
  onChange: (sections: T) => void;
  productionDeadline?: string;
  onProductionDeadlineChange?: (value: string) => void;
  onRestore?: (key?: SectionKey) => void;
}

const TEXTAREA_CLASS =
  'w-full resize-y rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50';

export function QuotationSectionsEditor<T extends EditorSections>({
  mode,
  sections,
  editable,
  onChange,
  productionDeadline,
  onProductionDeadlineChange,
  onRestore,
}: QuotationSectionsEditorProps<T>) {
  const isSnapshot = mode === 'revision';
  const currentSections = isSnapshot
    ? Object.fromEntries(
        (['prazo_producao', 'pagamento', 'condicoes_gerais'] as const).map((key) => [
          key,
          (sections[key] as QuotationSectionsSnapshot[typeof key]).current,
        ])
      ) as unknown as QuotationSectionsSettings
    : (sections as QuotationSectionsSettings);
  const update = (
    key: SectionKey,
    field: 'enabled' | 'title' | 'body',
    value: string | boolean
  ) => {
    if (isSnapshot) {
      const snapshot = sections as QuotationSectionsSnapshot;
      onChange({
        ...snapshot,
        [key]: {
          ...snapshot[key],
          current: { ...snapshot[key].current, [field]: value },
        },
      } as T);
      return;
    }
    onChange({
      ...currentSections,
      [key]: { ...currentSections[key], [field]: value },
    } as T);
  };

  const cards = [
    { key: 'prazo_producao' as const, label: 'Prazo de produção', body: false },
    { key: 'pagamento' as const, label: 'Pagamento', body: true },
    { key: 'condicoes_gerais' as const, label: 'Condições Gerais', body: true },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map(({ key, label, body }) => {
        const section = currentSections[key];
        return (
          <article key={key} className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-fg">
              <input
                type="checkbox"
                aria-label={`Exibir seção - ${label}`}
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
                className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                )}
              </>
            )}
            {mode === 'revision' && onRestore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRestore(key)}
                disabled={!editable}
              >
                Restaurar padrão
              </Button>
            )}
            {mode === 'revision' && (
              <span className="block text-xs text-fg-muted">
                {JSON.stringify(section) ===
                JSON.stringify((sections as QuotationSectionsSnapshot)[key].base)
                  ? 'Padrão'
                  : 'Personalizado'}
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}
