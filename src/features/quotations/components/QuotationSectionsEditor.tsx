import type { QuotationSectionsSettings } from '@/lib/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/ui/heading';

type ProductionDeadlineSection = QuotationSectionsSettings['prazo_producao'] & { value: string };

export interface QuotationSectionsSnapshot {
  schema_version: 1;
  show_summary?: boolean;
  rich_text?: boolean;
  prazo_producao: { base: ProductionDeadlineSection; current: ProductionDeadlineSection };
  pagamento: {
    base: QuotationSectionsSettings['pagamento'];
    current: QuotationSectionsSettings['pagamento'];
  };
  condicoes_gerais: {
    base: QuotationSectionsSettings['condicoes_gerais'];
    current: QuotationSectionsSettings['condicoes_gerais'];
  };
}

type EditorSections = QuotationSectionsSettings | QuotationSectionsSnapshot;
type SectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais';

export interface QuotationSectionsEditorProps<T extends EditorSections = EditorSections> {
  mode: 'settings' | 'revision';
  sections: T;
  editable: boolean;
  onChange: (sections: T) => void;
  onRestore?: (key?: SectionKey) => void;
}

export function QuotationSectionsEditor<T extends EditorSections>({
  mode,
  sections,
  editable,
  onChange,
  onRestore,
}: QuotationSectionsEditorProps<T>) {
  const isSnapshot = mode === 'revision';
  const currentSections = isSnapshot
    ? (Object.fromEntries(
        (['prazo_producao', 'pagamento', 'condicoes_gerais'] as const).map((key) => [
          key,
          (sections[key] as QuotationSectionsSnapshot[typeof key]).current,
        ])
      ) as unknown as QuotationSectionsSettings)
    : (sections as QuotationSectionsSettings);
  const update = (
    key: SectionKey,
    field: 'enabled' | 'title' | 'body' | 'value',
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
    <div className={cn('grid gap-4', mode === 'revision' && 'md:grid-cols-3')}>
      {cards.map(({ key, label, body }) => {
        const section = currentSections[key];
        return (
          <article
            key={key}
            className={cn(
              'space-y-3',
              mode === 'revision'
                ? 'rounded-control border border-border-subtle bg-surface p-4'
                : 'border-t border-line pt-4 first:border-0 first:pt-0'
            )}
          >
            <Heading level="subsection">{label}</Heading>
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
            <label className="flex flex-col gap-1.5 text-sm text-fg">
              <span className="font-medium">Título</span>
              <Input
                aria-label={`Título - ${label}`}
                value={section.title}
                onChange={(event) => update(key, 'title', event.target.value)}
                disabled={!editable}
                className="font-medium"
              />
            </label>
            {body && (
              <label className="flex flex-col gap-1.5 text-sm text-fg">
                <span className="font-medium">
                  {key === 'pagamento' ? 'Texto adicional' : 'Conteúdo'}
                </span>
                <RichTextEditor
                  ariaLabel={key === 'pagamento' ? 'Condição de pagamento' : 'Observações padrão'}
                  value={section.body || ''}
                  onChange={(value) => update(key, 'body', value)}
                  disabled={!editable}
                />
              </label>
            )}
            {mode === 'revision' && onRestore && (
              <Button
                type="button"
                variant="outline"
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
