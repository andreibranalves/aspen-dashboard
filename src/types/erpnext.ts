// src/types/erpnext.ts
// Shapes brutos vindos do ERPNext/Frappe. Campos opcionais e aliases são permitidos aqui.

export interface OrcamentoResponse {
  cliente?: string;
  quotation_id?: string;
  // outros campos retornados pelo endpoint /orcamento podem ser adicionados conforme necessário
}

export interface LeadCreateResponse {
  created?: string;
  name?: string;
  id?: string;
}
