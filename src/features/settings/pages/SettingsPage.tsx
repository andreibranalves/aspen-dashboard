import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CheckCircle2,
  FileCode2,
  MessageSquare,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import Skeleton from '@/components/shared/Skeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import { TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { QuotationSectionsEditor } from '@/features/quotations/components/QuotationSectionsEditor';
import { QuotationTemplateManager } from '@/features/quotations/components/QuotationTemplateManager';
import FlowEditorTab from '@/features/communication/components/FlowEditorTab';
import ChannelsTab from '@/features/communication/components/ChannelsTab';
import { getSettings, saveSettings, type DashboardSettings } from '@/lib/api/settingsApi';
import {
  DEFAULT_PRODUCTION_DAYS,
  MAX_PRODUCTION_DAYS,
  isProductionDays,
  productionDeadlineText,
} from '@/lib/productionDeadline';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';
import { useRouteGuardContext } from '@/hooks/useHashRoute';
import { Heading } from '@/components/ui/heading';
import { Field } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import StickySaveBar from '@/components/shared/StickySaveBar';
import { fromApiDecimal, toApiDecimal } from '@/lib/formatting/formatters';

type SettingsTab = 'patterns' | 'templates' | 'flows' | 'company' | 'channels';

interface TabItem {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}
const TABS: TabItem[] = [
  { id: 'patterns', label: 'Padrões', icon: SlidersHorizontal },
  { id: 'templates', label: 'Modelos de documento', icon: FileCode2 },
  { id: 'flows', label: 'Fluxos WhatsApp', icon: MessageSquare },
  { id: 'company', label: 'Empresa', icon: Building2 },
  { id: 'channels', label: 'Canais', icon: Settings2 },
];
const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  patterns: 'Padrões aplicados a novos orçamentos',
  templates: 'Modelos de documento e suas versões',
  flows: 'Fluxos operacionais do WhatsApp',
  company: 'Dados da empresa usados nos documentos',
  channels: 'Conexões configuradas fora do painel',
};
const parseSettingsTab = parseHashOption<SettingsTab>(TABS.map((tab) => tab.id));

interface SettingsForm {
  validade_dias: string;
  prazo_producao_dias: string;
  prazo_producao_complemento: string;
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
  prazo_producao_dias: '',
  prazo_producao_complemento: '',
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
    prazo_producao_dias: String(settings.prazo_producao_dias ?? DEFAULT_PRODUCTION_DAYS),
    prazo_producao_complemento: settings.prazo_producao_complemento ?? '',
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
  const [activeTab, setActiveTab] = useHashQueryState<SettingsTab>(
    'tab',
    'patterns',
    parseSettingsTab
  );
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState<SettingsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flowsDirty, setFlowsDirty] = useState(false);
  const [templatesDirty, setTemplatesDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const { setNavigationGuard } = useRouteGuardContext();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const nextForm = toForm(await getSettings());
      setForm(nextForm);
      setSavedForm(nextForm);
    } catch (error) {
      setLoadError(formatApiError(error, 'Não foi possível carregar as configurações.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const formDirty = !loading && !loadError && JSON.stringify(form) !== JSON.stringify(savedForm);
  const isDirty = formDirty || flowsDirty || templatesDirty;

  const handleTabChange = useCallback(
    (nextTab: SettingsTab) => {
      if (nextTab === activeTab) return;
      if (isDirty) {
        setPendingTab(nextTab);
        return;
      }
      setActiveTab(nextTab);
    },
    [activeTab, isDirty, setActiveTab]
  );

  useEffect(() => {
    if (!isDirty) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard((nextRoute) => {
      setPendingRoute(nextRoute);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [isDirty, setNavigationGuard]);

  useEffect(() => {
    if (!isDirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [isDirty]);

  function updateField(
    field:
      | 'validade_dias'
      | 'prazo_producao_dias'
      | 'prazo_producao_complemento'
      | 'frete_padrao'
      | 'aliquota',
    value: string
  ) {
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
    value: string
  ) {
    setForm((current) => ({
      ...current,
      empresa: { ...current.empresa, [group]: { ...current.empresa[group], [field]: value } },
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
    const productionDays = Number(form.prazo_producao_dias);
    if (!isProductionDays(productionDays)) {
      setSaveError(`Informe um prazo de produção entre 1 e ${MAX_PRODUCTION_DAYS} dias úteis.`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      const saved = await saveSettings({
        validade_dias: validadeDias,
        prazo_producao_dias: productionDays,
        prazo_producao_complemento: form.prazo_producao_complemento,
        entrega: form.entrega,
        frete_padrao: form.frete_padrao,
        aliquota: form.aliquota,
        secoes: form.secoes,
        empresa: form.empresa,
        settings_version: form.settings_version,
      });
      const nextForm = toForm(saved);
      setForm(nextForm);
      setSavedForm(nextForm);
      setSavedMessage(
        activeTab === 'company' ? 'Dados da empresa salvos.' : 'Configurações salvas com sucesso.'
      );
    } catch (error) {
      setSaveError(formatApiError(error, 'Não foi possível salvar as configurações.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="space-y-6 pb-24">
      <PageHeader title="Configurações" />
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabList
          label="Seções de configurações"
          items={TABS.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon }))}
        />
        <TabPanel value={activeTab}>
          {loading && (activeTab === 'patterns' || activeTab === 'company') && (
            <div className="space-y-5" role="status" aria-busy="true" aria-label="Carregando configurações">
              <Skeleton className="h-10" />
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_285px]">
                <div className="space-y-5">
                  <Skeleton className="h-[280px]" variant="card" />
                  <Skeleton className="h-[360px]" variant="card" />
                </div>
                <Skeleton className="h-[260px]" variant="card" />
              </div>
            </div>
          )}

          {!loading && loadError && (activeTab === 'patterns' || activeTab === 'company') && (
            <InlineAlert title="Não foi possível carregar as configurações."
              action={
                <Button variant="outline" size="sm" onClick={() => void loadSettings()}>
                  Tentar novamente
                </Button>
              }
            >
              {loadError}
            </InlineAlert>
          )}

          {!loading && !loadError && activeTab === 'patterns' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
              className="space-y-5"
            >
              <p className="text-xs text-fg-muted">{TAB_DESCRIPTIONS.patterns}.</p>
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_285px]">
                <div className="min-w-0 space-y-5">
                  <section
                    className="space-y-2 rounded-card bg-surface p-5 sm:p-5.5"
                    aria-labelledby="patterns-title"
                  >
                    <Heading level="section" id="patterns-title">
                      Condições padrão
                    </Heading>
                    <fieldset className="space-y-4">
                      <legend className="sr-only">Prazos e valores</legend>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-1.5 text-sm text-fg">
                          <span className="text-xs font-medium text-fg-muted">Validade (dias)</span>
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
                        <label className="flex flex-col gap-1.5 text-sm text-fg">
                          <span className="text-xs font-medium text-fg-muted">Prazo de produção (dias úteis)</span>
                          <Input
                            type="number"
                            min="1"
                            max={MAX_PRODUCTION_DAYS}
                            step="1"
                            value={form.prazo_producao_dias}
                            onChange={(event) => updateField('prazo_producao_dias', event.target.value)}
                            disabled={saving}
                            required
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-fg md:col-span-2">
                          <span className="text-xs font-medium text-fg-muted">Complemento do prazo</span>
                          <Input
                            maxLength={300}
                            value={form.prazo_producao_complemento}
                            onChange={(event) => updateField('prazo_producao_complemento', event.target.value)}
                            disabled={saving}
                          />
                          <span className="text-2xs text-fg-muted">
                            {productionDeadlineText(
                              isProductionDays(Number(form.prazo_producao_dias))
                                ? Number(form.prazo_producao_dias)
                                : DEFAULT_PRODUCTION_DAYS,
                              form.prazo_producao_complemento
                            )}
                          </span>
                        </label>
                        <Field label="Frete padrão (R$)">
                          <MoneyInput
                            placeholder="0,00"
                            value={fromApiDecimal(form.frete_padrao)}
                            onValueChange={(value) => updateField('frete_padrao', value === null ? '' : toApiDecimal(value))}
                            disabled={saving}
                            required
                          />
                        </Field>
                        <Field label="Alíquota (%)">
                          <MoneyInput
                            placeholder="4,00"
                            value={fromApiDecimal(form.aliquota)}
                            onValueChange={(value) => updateField('aliquota', value === null ? '' : toApiDecimal(value))}
                            disabled={saving}
                            required
                          />
                        </Field>
                      </div>
                    </fieldset>
                  </section>
                  <section
                    className="space-y-5 rounded-card bg-surface p-5 sm:p-5.5"
                    aria-labelledby="document-sections-title"
                  >
                    <Heading level="section" id="document-sections-title">
                      Seções do documento
                    </Heading>
                    <fieldset className="space-y-5">
                      <legend className="sr-only">Conteúdo do documento</legend>
                      <QuotationSectionsEditor
                        mode="settings"
                        sections={form.secoes}
                        editable={!saving}
                        onChange={updateSections}
                      />
                      <label className="flex min-h-9 items-center gap-3 text-sm text-fg">
                        <input
                          type="checkbox"
                          aria-label="Exibir resumo financeiro"
                          checked={form.secoes.show_summary}
                          onChange={(event) =>
                            updateSections({ ...form.secoes, show_summary: event.target.checked })
                          }
                          disabled={saving}
                        />
                        <span className="font-medium">Exibir resumo financeiro</span>
                      </label>
                    </fieldset>
                  </section>
                </div>
                <aside
                  className="rounded-card bg-surface p-5 sm:p-5.5"
                  aria-labelledby="patterns-usage-title"
                >
                  <Heading level="section" id="patterns-usage-title">
                    Aplicação dos padrões
                  </Heading>
                  <p className="mt-5 text-sm leading-6 text-fg-muted">
                    Os valores são aplicados a novos orçamentos e podem ser revisados antes da
                    emissão.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-5 w-full"
                    onClick={() => handleTabChange('templates')}
                  >
                    Ver modelos de documento
                  </Button>
                </aside>
              </div>
              <SettingsFeedback error={saveError} success={savedMessage} />
              <StickySaveBar dirty={formDirty} saving={saving} onSave={() => void handleSave()} onDiscard={() => setForm(savedForm)} saveLabel="Salvar configurações" />
            </form>
          )}

          {activeTab === 'templates' && (
            <section
              className="rounded-card bg-surface p-5 sm:p-5.5"
              aria-labelledby="document-templates-title"
            >
              <h2 id="document-templates-title" className="sr-only">
                Modelos de documento
              </h2>
              <QuotationTemplateManager onDirtyChange={setTemplatesDirty} />
            </section>
          )}
          {activeTab === 'flows' && <FlowEditorTab onDirtyChange={setFlowsDirty} />}

          {!loading && !loadError && activeTab === 'company' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
              className="space-y-5"
            >
              <p className="text-xs text-fg-muted">Dados apresentados nos documentos comerciais.</p>
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_285px]">
                <div className="min-w-0 space-y-5">
                  <section
                    className="space-y-5 rounded-card bg-surface p-5 sm:p-5.5"
                    aria-labelledby="company-title"
                  >
                    <Heading level="section" id="company-title">
                      Identificação da empresa
                    </Heading>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Razão social</span>
                        <Input
                          value={form.empresa.identity.legal_name}
                          onChange={(event) =>
                            updateCompanyField('identity', 'legal_name', event.target.value)
                          }
                          disabled={saving}
                          maxLength={255}
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">CNPJ</span>
                        <Input
                          value={form.empresa.identity.document}
                          onChange={(event) =>
                            updateCompanyField('identity', 'document', event.target.value)
                          }
                          disabled={saving}
                          maxLength={18}
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Site</span>
                        <Input
                          type="url"
                          value={form.empresa.contacts.website}
                          onChange={(event) =>
                            updateCompanyField('contacts', 'website', event.target.value)
                          }
                          disabled={saving}
                          maxLength={500}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Instagram</span>
                        <Input
                          type="url"
                          value={form.empresa.contacts.instagram}
                          onChange={(event) =>
                            updateCompanyField('contacts', 'instagram', event.target.value)
                          }
                          disabled={saving}
                          maxLength={500}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">E-mail</span>
                        <Input
                          type="email"
                          value={form.empresa.contacts.email}
                          onChange={(event) =>
                            updateCompanyField('contacts', 'email', event.target.value)
                          }
                          disabled={saving}
                          maxLength={500}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Telefone</span>
                        <Input
                          value={form.empresa.contacts.phone}
                          onChange={(event) =>
                            updateCompanyField('contacts', 'phone', event.target.value)
                          }
                          disabled={saving}
                          maxLength={500}
                        />
                      </label>
                    </div>
                  </section>
                  <section
                    className="space-y-5 rounded-card bg-surface p-5 sm:p-5.5"
                    aria-labelledby="company-banking-title"
                  >
                    <Heading level="section" id="company-banking-title">
                      Dados bancários
                    </Heading>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Banco</span>
                        <Input
                          value={form.empresa.banking.bank_name}
                          onChange={(event) =>
                            updateCompanyField('banking', 'bank_name', event.target.value)
                          }
                          disabled={saving}
                          maxLength={255}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Código do banco</span>
                        <Input
                          value={form.empresa.banking.bank_code}
                          onChange={(event) =>
                            updateCompanyField('banking', 'bank_code', event.target.value)
                          }
                          disabled={saving}
                          maxLength={20}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Agência</span>
                        <Input
                          value={form.empresa.banking.branch}
                          onChange={(event) =>
                            updateCompanyField('banking', 'branch', event.target.value)
                          }
                          disabled={saving}
                          maxLength={100}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg">
                        <span className="font-medium">Conta</span>
                        <Input
                          value={form.empresa.banking.account}
                          onChange={(event) =>
                            updateCompanyField('banking', 'account', event.target.value)
                          }
                          disabled={saving}
                          maxLength={100}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm text-fg md:col-span-2">
                        <span className="font-medium">Chave Pix</span>
                        <Input
                          value={form.empresa.banking.pix_key}
                          onChange={(event) =>
                            updateCompanyField('banking', 'pix_key', event.target.value)
                          }
                          disabled={saving}
                          maxLength={255}
                        />
                      </label>
                    </div>
                  </section>
                </div>
                <aside
                  className="rounded-card bg-surface p-5 sm:p-5.5"
                  aria-labelledby="company-usage-title"
                >
                  <Heading level="section" id="company-usage-title">
                    Onde esses dados aparecem
                  </Heading>
                  <ul className="mt-5 divide-y divide-line text-sm text-fg">
                    {[
                      'Identificação do documento',
                      'Condições de pagamento',
                      'Contatos comerciais',
                    ].map((label) => (
                      <li
                        key={label}
                        className="flex items-center justify-between gap-3 py-3 first:pt-0"
                      >
                        <span>{label}</span>
                        <CheckCircle2
                          size={16}
                          className="shrink-0 text-light-sage"
                          aria-hidden="true"
                        />
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-5 w-full"
                    onClick={() => handleTabChange('templates')}
                  >
                    Ver modelos de documento
                  </Button>
                </aside>
              </div>
              <SettingsFeedback error={saveError} success={savedMessage} />
              <StickySaveBar dirty={formDirty} saving={saving} onSave={() => void handleSave()} onDiscard={() => setForm(savedForm)} saveLabel="Salvar empresa" />
            </form>
          )}
          {activeTab === 'channels' && <ChannelsTab />}
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={pendingTab !== null}
        title="Sair sem salvar?"
        message="As alterações não salvas serão perdidas."
        confirmLabel="Sair da aba"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingTab;
          setPendingTab(null);
          setForm(savedForm);
          setFlowsDirty(false);
          setTemplatesDirty(false);
          if (target) setActiveTab(target);
        }}
        onCancel={() => setPendingTab(null)}
      />
      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem salvar?"
        message="As alterações não salvas serão perdidas."
        confirmLabel="Sair da página"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingRoute;
          setPendingRoute(null);
          setForm(savedForm);
          setFlowsDirty(false);
          setTemplatesDirty(false);
          setNavigationGuard(null);
          if (target) window.location.hash = target;
        }}
        onCancel={() => setPendingRoute(null)}
      />
    </PageShell>
  );
}

function SettingsFeedback({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}
      {success && (
        <div
          className="flex items-center gap-2 rounded-control border border-success/25 bg-success/10 p-3 text-sm text-fg"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={20} className="shrink-0 text-success" aria-hidden="true" />
          <span>{success}</span>
        </div>
      )}
    </>
  );
}
