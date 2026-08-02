import { apiGet, apiPut } from '@/lib/api';

export interface DashboardSettings {
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  observacoes: string;
  template_padrao: string;
}

export function getSettings(): Promise<DashboardSettings> {
  return apiGet<DashboardSettings>('/settings');
}

export function saveSettings(settings: DashboardSettings): Promise<DashboardSettings> {
  return apiPut<DashboardSettings>('/settings', settings);
}
