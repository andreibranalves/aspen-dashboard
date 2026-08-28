import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { QuotationSectionsSnapshot } from '@/features/quotations/components/QuotationSectionsEditor';

interface SectionCard {
  key: keyof Pick<QuotationSectionsSnapshot, 'prazo_producao' | 'pagamento' | 'condicoes_gerais'>;
  bodyKey: 'value' | 'body';
}

const SECTION_CARDS: SectionCard[] = [
  { key: 'prazo_producao', bodyKey: 'value' },
  { key: 'pagamento', bodyKey: 'body' },
  { key: 'condicoes_gerais', bodyKey: 'body' },
];

export interface QuotationSectionsDocumentProps {
  sections: QuotationSectionsSnapshot;
  editable: boolean;
  onChange: (sections: QuotationSectionsSnapshot) => void;
}

/**
 * Apresentação em documento das seções textuais do orçamento: cada seção
 * ocupa uma linha vertical, sem cards. Em leitura, renderiza apenas o
 * conteúdo final; em edição, alterna visibilidade e campos inline.
 */
export function QuotationSectionsDocument({
  sections,
  editable,
  onChange,
}: QuotationSectionsDocumentProps) {
  const update = (key: SectionCard['key'], field: 'enabled' | 'title' | 'body' | 'value', value: string | boolean) => {
    onChange({
      ...sections,
      [key]: {
        ...sections[key],
        current: { ...sections[key].current, [field]: value },
      },
    } as QuotationSectionsSnapshot);
  };

  if (!editable) {
    return (
      <>
        {SECTION_CARDS.map(({ key, bodyKey }) => {
          const section = sections[key].current;
          const html = String((section as { value?: string; body?: string })[bodyKey] || '');
          if (!section.enabled || !html.trim()) return null;
          return (
            <section
              key={key}
              aria-labelledby={`quote-section-${key}-title`}
              className="border-t border-line py-7"
            >
              <h2
                id={`quote-section-${key}-title`}
                className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                {section.title}
              </h2>
              <div
                className="rich-text-read mt-3 max-w-[68ch] text-sm text-fg [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-1 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </section>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-8">
      {SECTION_CARDS.map(({ key, bodyKey }) => {
        const section = sections[key].current;
        const isEmpty = !String((section as { value?: string; body?: string })[bodyKey] || '').trim();
        return (
          <section
            key={key}
            aria-labelledby={`quote-section-edit-${key}-title`}
            className="border-t border-line pt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`quote-section-edit-${key}-title`} className="flex items-center gap-2 text-sm font-semibold text-fg">
                {section.enabled ? (
                  section.title || (key === 'prazo_producao' ? 'Produção e entrega' : key === 'pagamento' ? 'Pagamento' : 'Condições gerais')
                ) : (
                  <span className="text-fg-muted">
                    {key === 'prazo_producao' ? 'Produção e entrega' : key === 'pagamento' ? 'Pagamento' : 'Condições gerais'}
                    <span className="ml-2 text-xs font-normal text-warning">— oculto no orçamento</span>
                  </span>
                )}
              </h2>
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Exibir seção ${key === 'prazo_producao' ? 'Produção e entrega' : key === 'pagamento' ? 'Pagamento' : 'Condições gerais'}`}
                  checked={section.enabled}
                  onChange={(event) => update(key, 'enabled', event.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--primary))]"
                />
                Visível
              </label>
            </div>
            <input
              aria-label="Título da seção"
              value={section.title}
              onChange={(event) => update(key, 'title', event.target.value)}
              placeholder="Título"
              className="mt-3 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {bodyKey === 'value' ? (
              <RichTextEditor
                ariaLabel="Prazo de produção do orçamento"
                value={'value' in sections[key].current ? String(sections[key].current.value || '') : ''}
                onChange={(value) => update(key, 'value', value)}
                placeholder="Ex.: 15 a 20 dias úteis após a aprovação"
              />
            ) : (
              <RichTextEditor
                ariaLabel={key === 'pagamento' ? 'Condição de pagamento' : 'Condições gerais'}
                value={section.body || ''}
                onChange={(value) => update(key, 'body', value)}
              />
            )}
            {isEmpty && (
              <p className="mt-2 text-xs text-fg-muted">Seção sem conteúdo — não será exibida no orçamento.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}