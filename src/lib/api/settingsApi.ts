import { apiGet, apiPut } from '@/lib/api/api';

export interface QuotationSectionSettings {
  enabled: boolean;
  title: string;
  body?: string;
  value?: string;
}

export interface QuotationSectionsSettings {
  schema_version: 1;
  show_summary?: boolean;
  rich_text?: boolean;
  prazo_producao: QuotationSectionSettings;
  pagamento: QuotationSectionSettings & { body: string };
  condicoes_gerais: QuotationSectionSettings & { body: string };
}

export interface QuotationCompanyConfiguration {
  schema_version: 1;
  identity: {
    legal_name: string;
    document: string;
  };
  banking: {
    bank_name: string;
    bank_code: string;
    branch: string;
    account: string;
    pix_key: string;
  };
  contacts: {
    website: string;
    phone: string;
    email: string;
    instagram: string;
  };
}

export interface DashboardSettings {
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  aliquota: string;
  observacoes: string;
  template_padrao: string;
  prazo_producao_dias: number;
  prazo_producao_complemento: string;
  secoes: QuotationSectionsSettings;
  empresa: QuotationCompanyConfiguration;
  settings_version: number;
}

export function getSettings(): Promise<DashboardSettings> {
  return apiGet<DashboardSettings>('/settings');
}

export type DashboardSettingsPayload = Omit<
  DashboardSettings,
  'template_padrao' | 'pagamento' | 'observacoes'
> & {
  template_padrao?: string;
};

export function saveSettings(settings: DashboardSettingsPayload): Promise<DashboardSettings> {
  return apiPut<DashboardSettings>('/settings', settings);
}
