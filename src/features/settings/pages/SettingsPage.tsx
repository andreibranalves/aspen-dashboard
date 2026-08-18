import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
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
  return message || fallback;
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
    <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
      <PageHeader title="Configurações" />

      <QuotationTemplateManager />

      <section className="rounded-xl border border-line bg-surface p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <SlidersHorizontal size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-fg">Padrões de orçamento</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Estes dados serão usados como ponto de partida nos novos orçamentos.
            </p>
          </div>
        </div>

        {loading && (
          <div className="space-y-3" aria-label="Carregando configurações">
            <div className="h-10 rounded-[10px] bg-surface-muted animate-pulse" />
            <div className="h-10 rounded-[10px] bg-surface-muted animate-pulse" />
            <div className="h-24 rounded-[10px] bg-surface-muted animate-pulse" />
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-fg">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Não foi possível carregar as configurações.</p>
                <p className="mt-1 text-fg-muted">{loadError}</p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadSettings()}
                >
                  <RefreshCw size={14} />
                  Tentar novamente
                </Button>
              </div>
            </div>
          </div>
        )}

        {!loading && !loadError && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
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

            <label className="space-y-1.5 text-sm text-fg">
              <span className="font-medium">Prazo de entrega</span>
              <textarea
                value={form.entrega}
                onChange={(event) => updateField('entrega', event.target.value)}
                disabled={saving}
                maxLength={500}
                rows={3}
                className="w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>

            <QuotationSectionsEditor
              mode="settings"
              sections={form.secoes}
              editable={!saving}
              onChange={updateSections}
            />

            {saveError && (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
                role="alert"
              >
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
                <span>{saveError}</span>
              </div>
            )}

            {savedMessage && (
              <div
                className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-fg"
                role="status"
              >
                <CheckCircle2 size={18} className="shrink-0 text-success" />
                <span>{savedMessage}</span>
              </div>
            )}

            <div className="flex justify-end border-t border-line pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {saving ? 'Salvando...' : 'Salvar configurações'}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* WhatsApp flows moved notice */}
      <div className="rounded-xl border border-line bg-surface p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <MessageCircle size={20} className="text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Fluxos de WhatsApp</h3>
            <p className="text-sm text-fg-muted">
              A configuração de fluxos de WhatsApp, biblioteca de mídias e histórico de envios agora
              está disponível na página dedicada de Comunicação.
            </p>
            <a
              href="#/comunicacao"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={14} />
              Ir para Comunicação
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
