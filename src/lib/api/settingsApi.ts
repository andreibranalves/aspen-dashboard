import { apiGet, apiPut } from '@/lib/api/api';

export interface QuotationSectionSettings {
  enabled: boolean;
  title: string;
  body?: string;
}

export interface QuotationSectionsSettings {
  schema_version: 1;
  prazo_producao: QuotationSectionSettings;
  pagamento: QuotationSectionSettings & { body: string };
  condicoes_gerais: QuotationSectionSettings & { body: string };
}

export interface DashboardSettings {
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  observacoes: string;
  template_padrao: string;
  secoes: QuotationSectionsSettings;
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
