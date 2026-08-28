import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { QuotationSectionsSnapshot } from '@/features/quotations/components/QuotationSectionsEditor';
import { quotationContentHasText } from '@/lib/quotationDisplay';

interface SectionCard {
  key: keyof Pick<QuotationSectionsSnapshot, 'prazo_producao' | 'pagamento' | 'condicoes_gerais'>;
  bodyKey: 'value' | 'body';
  label: string;
  aliases: string[];
}

const SECTION_CARDS: SectionCard[] = [
  {
    key: 'prazo_producao',
    bodyKey: 'value',
    label: 'Prazo de produção',
    aliases: ['prazo', 'prazo de produção', 'produção e entrega'],
  },
  {
    key: 'pagamento',
    bodyKey: 'body',
    label: 'Dados para pagamento',
    aliases: ['pagamento', 'dados para pagamento'],
  },
  {
    key: 'condicoes_gerais',
    bodyKey: 'body',
    label: 'Condições gerais',
    aliases: ['condições', 'condições gerais'],
  },
];

function displayTitle(label: string, aliases: string[], value: string): string {
  const clean = value.trim().replace(/:+$/, '');
  return aliases.includes(clean.toLocaleLowerCase('pt-BR')) ? label : clean || label;
}

export interface QuotationSectionsDocumentProps {
  sections: QuotationSectionsSnapshot;
  editable: boolean;
  hideProductionDeadline?: boolean;
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
  hideProductionDeadline = false,
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
        {SECTION_CARDS.map(({ key, bodyKey, label, aliases }) => {
          const section = sections[key].current;
          const html = String((section as { value?: string; body?: string })[bodyKey] || '');
          if (
            !section.enabled ||
            !quotationContentHasText(html) ||
            (key === 'prazo_producao' && hideProductionDeadline)
          ) return null;
          return (
            <section
              key={key}
              aria-labelledby={`quote-section-${key}-title`}
              className="border-t border-line py-5"
            >
              <h2
                id={`quote-section-${key}-title`}
                className="text-sm font-semibold text-fg"
              >
                {displayTitle(label, aliases, section.title)}
              </h2>
              <div
                className="rich-text-read mt-2 max-w-[68ch] text-sm leading-6 text-fg [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-1 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </section>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {SECTION_CARDS.map(({ key, bodyKey, label, aliases }) => {
        const section = sections[key].current;
        const isEmpty = !quotationContentHasText(
          String((section as { value?: string; body?: string })[bodyKey] || '')
        );
        return (
          <section
            key={key}
            aria-labelledby={`quote-section-edit-${key}-title`}
            className="border-t border-line pt-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`quote-section-edit-${key}-title`} className="flex items-center gap-2 text-sm font-semibold text-fg">
                {section.enabled ? (
                  displayTitle(label, aliases, section.title)
                ) : (
                  <span className="text-fg-muted">
                    {displayTitle(label, aliases, section.title)}
                    <span className="ml-2 text-xs font-normal text-warning">— oculto no orçamento</span>
                  </span>
                )}
              </h2>
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  role="switch"
                  checked={section.enabled}
                  onChange={(event) => update(key, 'enabled', event.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--primary))]"
                />
                <span>Visível<span className="sr-only">: {label}</span></span>
              </label>
            </div>
            <input
              aria-label={`Título da seção ${label}`}
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