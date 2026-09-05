import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
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
  aliquota: string;
  observacoes: string;
  secoes: DashboardSettings['secoes'];
  empresa: DashboardSettings['empresa'];
  settings_version: number;
}

const EMPTY_SECTIONS: DashboardSettings['secoes'] = {
  schema_version: 1,
  show_summary: true,
  rich_text: true,
  prazo_producao: { enabled: true, title: 'Prazo de produção' },
  pagamento: { enabled: true, title: 'Pagamento', body: '' },
  condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
};

const EMPTY_FORM: SettingsForm = {
  validade_dias: '',
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  aliquota: '4.00',
  observacoes: '',
  secoes: EMPTY_SECTIONS,
  empresa: {
    schema_version: 1,
    identity: { legal_name: '', document: '' },
    banking: { bank_name: '', bank_code: '', branch: '', account: '', pix_key: '' },
    contacts: { website: '', phone: '', email: '', instagram: '' },
  },
  settings_version: 1,
};

function toForm(settings: DashboardSettings): SettingsForm {
  return {
    validade_dias: String(settings.validade_dias),
    pagamento: settings.secoes.pagamento.body,
    entrega: settings.entrega,
    frete_padrao: settings.frete_padrao,
    aliquota: settings.aliquota ?? '4.00',
    observacoes: settings.secoes.condicoes_gerais.body,
    secoes: settings.secoes,
    empresa: settings.empresa || EMPTY_FORM.empresa,
    settings_version: settings.settings_version || 1,
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

  function updateField(field: 'validade_dias' | 'entrega' | 'frete_padrao' | 'aliquota', value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    setSavedMessage(null);
  }

  function updateSections(secoes: DashboardSettings['secoes']) {
    const richSections = { ...secoes, rich_text: true };
    setForm((current) => ({
      ...current,
      pagamento: richSections.pagamento.body,
      observacoes: richSections.condicoes_gerais.body,
      secoes: richSections,
    }));
    setSaveError(null);
    setSavedMessage(null);
  }

  function updateCompanyField(
    group: 'identity' | 'banking' | 'contacts',
    field: string,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      empresa: {
        ...current.empresa,
        [group]: { ...current.empresa[group], [field]: value },
      },
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
        aliquota: form.aliquota,
        secoes: form.secoes,
        empresa: form.empresa,
        settings_version: form.settings_version,
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
      <PageHeader title="Configurações" />

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
            <details name="quotation-settings" open className="group overflow-hidden rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-surface-muted px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span><span className="text-sm font-semibold text-fg">Prazos e valores</span><span className="ml-3 text-xs text-fg-muted">Validade, frete, alíquota e produção</span></span>
                <ChevronDown size={18} className="text-fg-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <fieldset className="space-y-4 p-5">
                <legend className="sr-only">Prazos e valores</legend>
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
                </label>

                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Alíquota de imposto (%)</span>
                  <Input
                    inputMode="decimal"
                    placeholder="4.00"
                    value={form.aliquota}
                    onChange={(event) => updateField('aliquota', event.target.value)}
                    disabled={saving}
                    required
                    aria-label="Alíquota de imposto (%)"
                  />
                </label>
              </div>
              </fieldset>
            </details>

            <details name="quotation-settings" className="group overflow-hidden rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-surface-muted px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span><span className="text-sm font-semibold text-fg">Conteúdo do documento</span><span className="ml-3 text-xs text-fg-muted">{Object.values(form.secoes).filter((section) => typeof section === 'object' && 'enabled' in section && section.enabled).length} seções ativas · resumo {form.secoes.show_summary ? 'visível' : 'oculto'}</span></span>
                <ChevronDown size={18} className="text-fg-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <fieldset className="space-y-5 p-5">
                <legend className="sr-only">Conteúdo do documento</legend>
              <QuotationSectionsEditor
                mode="settings"
                sections={form.secoes}
                editable={!saving}
                onChange={updateSections}
              />
              <label className="flex items-start gap-3 rounded-md border border-line bg-surface-muted p-4 text-sm text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  aria-label="Exibir resumo financeiro"
                  checked={form.secoes.show_summary}
                  onChange={(event) => updateSections({ ...form.secoes, show_summary: event.target.checked })}
                  disabled={saving}
                />
                <span className="block font-medium">Exibir resumo financeiro</span>
              </label>
              </fieldset>
            </details>

            <details name="quotation-settings" className="group overflow-hidden rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-surface-muted px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span><span className="text-sm font-semibold text-fg">Identidade e contatos</span><span className="ml-3 text-xs text-fg-muted">Dados institucionais</span></span>
                <ChevronDown size={18} className="text-fg-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <section className="space-y-4 p-5">
                <div className="flex items-start gap-3"><Building2 size={20} className="mt-0.5 text-primary" /><p className="text-xs text-fg-muted">Capturados em novos orçamentos sem alterar revisões emitidas.</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5 text-sm text-fg"><span className="font-medium">Razão social</span><Input value={form.empresa.identity.legal_name} onChange={(event) => updateCompanyField('identity', 'legal_name', event.target.value)} disabled={saving} maxLength={255} required /></label>
                  <label className="space-y-1.5 text-sm text-fg"><span className="font-medium">CNPJ</span><Input value={form.empresa.identity.document} onChange={(event) => updateCompanyField('identity', 'document', event.target.value)} disabled={saving} maxLength={18} required /></label>
                </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Site</span>
                  <Input
                    type="url"
                    value={form.empresa.contacts.website}
                    onChange={(event) => updateCompanyField('contacts', 'website', event.target.value)}
                    disabled={saving}
                    maxLength={500}
                  />
                </label>
                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Telefone</span>
                  <Input
                    value={form.empresa.contacts.phone}
                    onChange={(event) => updateCompanyField('contacts', 'phone', event.target.value)}
                    disabled={saving}
                    maxLength={500}
                  />
                </label>
                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">E-mail</span>
                  <Input
                    type="email"
                    value={form.empresa.contacts.email}
                    onChange={(event) => updateCompanyField('contacts', 'email', event.target.value)}
                    disabled={saving}
                    maxLength={500}
                  />
                </label>
                <label className="space-y-1.5 text-sm text-fg">
                  <span className="font-medium">Instagram</span>
                  <Input
                    type="url"
                    value={form.empresa.contacts.instagram}
                    onChange={(event) => updateCompanyField('contacts', 'instagram', event.target.value)}
                    disabled={saving}
                    maxLength={500}
                  />
                </label>
              </div>
              </section>
            </details>

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

            <div className="sticky bottom-4 z-10 flex justify-end rounded-lg border border-line bg-surface/95 p-3 shadow-sm backdrop-blur">
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

      <section aria-labelledby="quotation-models-title">
        <details open className="group overflow-hidden rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <h2 id="quotation-models-title" className="text-base font-semibold text-fg">
              Modelos de orçamento
            </h2>
            <ChevronDown
              size={18}
              className="shrink-0 text-fg-muted transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="border-t border-line p-4 sm:p-6">
            <QuotationTemplateManager />
          </div>
        </details>
      </section>
    </div>
  );
}
