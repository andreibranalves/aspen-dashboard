import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QuotationSectionsEditor } from '@/features/quotations/components/QuotationSectionsEditor';
import { QuotationTemplateManager } from '@/features/quotations/components/QuotationTemplateManager';
import { getSettings, saveSettings, type DashboardSettings } from '@/lib/api/settingsApi';

interface SettingsForm {
  validade_dias: string;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  observacoes: string;
  secoes: DashboardSettings['secoes'];
}

const EMPTY_SECTIONS: DashboardSettings['secoes'] = {
  schema_version: 1,
  prazo_producao: { enabled: true, title: 'Prazo de produção' },
  pagamento: { enabled: true, title: 'Pagamento', body: '' },
  condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
};

const EMPTY_FORM: SettingsForm = {
  validade_dias: '',
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  secoes: EMPTY_SECTIONS,
};

function toForm(settings: DashboardSettings): SettingsForm {
  return {
    validade_dias: String(settings.validade_dias),
    pagamento: settings.secoes.pagamento.body,
    entrega: settings.entrega,
    frete_padrao: settings.frete_padrao,
    observacoes: settings.secoes.condicoes_gerais.body,
    secoes: settings.secoes,
  };
}

function formatApiError(error: unknown, fallback: string): string {
  const message = (error as { message?: string })?.message;
  if (
    !message ||
    message.length > 180 ||
    /[\r\n<>]/.test(message) ||
    /(?:stack|trace|secret|password|token|authorization|bearer|postgres|sql)/i.test(message)
  ) {
    return fallback;
  }
  return message;
}

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setForm(toForm(await getSettings()));
    } catch (error) {
      setLoadError(formatApiError(error, 'Não foi possível carregar as configurações.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateField(field: 'validade_dias' | 'entrega' | 'frete_padrao', value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    setSavedMessage(null);
  }

  function updateSections(secoes: DashboardSettings['secoes']) {
    setForm((current) => ({
      ...current,
      pagamento: secoes.pagamento.body,
      observacoes: secoes.condicoes_gerais.body,
      secoes,
    }));
    setSaveError(null);
    setSavedMessage(null);
  }

  async function handleSave() {
    const validadeDias = Number(form.validade_dias);
    if (!Number.isInteger(validadeDias) || validadeDias < 1 || validadeDias > 365) {
      setSaveError('Informe uma validade em dias entre 1 e 365.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      const saved = await saveSettings({
        validade_dias: validadeDias,
        entrega: form.entrega,
        frete_padrao: form.frete_padrao,
        secoes: form.secoes,
      });
      setForm(toForm(saved));
      setSavedMessage('Configurações salvas com sucesso.');
    } catch (error) {
      setSaveError(formatApiError(error, 'Não foi possível salvar as configurações.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1060px] space-y-6 animate-fade-in">
      <PageHeader
        title="Configurações"
        description="Defina os padrões usados na criação de novos orçamentos."
      />

      <section
        className="space-y-6 rounded-lg border border-line bg-surface p-4 sm:p-6"
        aria-labelledby="quotation-settings-title"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <SlidersHorizontal size={18} className="text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="quotation-settings-title" className="text-base font-semibold text-fg">
              Padrões de orçamento
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Estes valores e textos serão usados como ponto de partida nos novos orçamentos.
            </p>
          </div>
        </div>

        {loading && (
          <div className="space-y-3" aria-label="Carregando configurações">
            <div className="skeleton h-10" />
            <div className="skeleton h-10" />
            <div className="skeleton h-24" />
          </div>
        )}

        {!loading && loadError && (
          <div
            className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-fg"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <AlertCircle
                size={18}
                className="mt-0.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium">Não foi possível carregar as configurações.</p>
                <p className="mt-1 text-fg-muted">{loadError}</p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadSettings()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Tentar novamente
                </Button>
              </div>
            </div>
          </div>
        )}

        {!loading && !loadError && (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-fg">Prazos e valores padrão</legend>
              <p className="-mt-2 text-sm text-fg-muted">
                Defina os valores aplicados automaticamente em cada novo orçamento.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Validade padrão (dias)</span>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={form.validade_dias}
                    onChange={(event) => updateField('validade_dias', event.target.value)}
                    disabled={saving}
                    required
                  />
                </label>

                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Frete padrão (R$)</span>
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.frete_padrao}
                    onChange={(event) => updateField('frete_padrao', event.target.value)}
                    disabled={saving}
                    required
                  />
                  <span className="block text-xs text-fg-muted">
                    Use ponto e até duas casas decimais.
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-line pt-5">
              <legend className="text-sm font-semibold text-fg">Conteúdo comercial</legend>
              <p className="-mt-2 text-sm text-fg-muted">
                Organize os prazos e as informações exibidas no documento do orçamento.
              </p>
              <label className="space-y-1.5 text-sm text-fg">
                <span className="font-medium">Prazo de entrega</span>
                <textarea
                  value={form.entrega}
                  onChange={(event) => updateField('entrega', event.target.value)}
                  disabled={saving}
                  maxLength={500}
                  rows={3}
                  className="w-full resize-y rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>

              <QuotationSectionsEditor
                mode="settings"
                sections={form.secoes}
                editable={!saving}
                onChange={updateSections}
              />
            </fieldset>

            {saveError && (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
                role="alert"
              >
                <AlertCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <span>{saveError}</span>
              </div>
            )}

            {savedMessage && (
              <div
                className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-fg"
                role="status"
                aria-live="polite"
              >
                <CheckCircle2 size={18} className="shrink-0 text-success" aria-hidden="true" />
                <span>{savedMessage}</span>
              </div>
            )}

            <div className="flex justify-end border-t border-line pt-4">
              <Button type="submit" disabled={saving} aria-busy={saving}>
                {saving ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {saving ? 'Salvando...' : 'Salvar configurações'}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="advanced-settings-title" className="space-y-3">
        <div className="px-1">
          <h2 id="advanced-settings-title" className="text-base font-semibold text-fg">
            Configurações avançadas
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Modelos HTML e versões ficam separados dos padrões usados no dia a dia.
          </p>
        </div>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">Modelos de orçamento</span>
              <span className="mt-1 block text-sm text-fg-muted">
                Edite o HTML somente quando precisar ajustar o documento.
              </span>
            </span>
            <ChevronDown
              size={18}
              className="shrink-0 text-fg-muted transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3">
            <QuotationTemplateManager />
          </div>
        </details>
      </section>
    </div>
  );
}
