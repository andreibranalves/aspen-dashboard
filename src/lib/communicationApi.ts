/**
 * Communication API client — centralized fetch helpers for:
 *   - Media assets (communication-media endpoints)
 *   - Communication flows (communication-flows endpoints)
 *   - Send events history
 *
 * All functions return { success, ...data } or throw with Portuguese error messages.
 */

export type ProductGroup =
  | 'canga'
  | 'lenço'
  | 'boné'
  | 'toalha'
  | 'chapéu'
  | 'ecobag'
  | 'cachecol';

export const PRODUCT_GROUPS: ProductGroup[] = [
  'canga',
  'lenço',
  'boné',
  'toalha',
  'chapéu',
  'ecobag',
  'cachecol',
];

export const GROUP_LABELS: Record<ProductGroup, string> = {
  canga: 'Canga',
  lenço: 'Lenço',
  boné: 'Boné',
  toalha: 'Toalha',
  chapéu: 'Chapéu',
  ecobag: 'Ecobag',
  cachecol: 'Cachecol',
};

export interface MediaFilters {
  product_group?: string;
  active?: boolean;
  kind?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  description: string;
  product_group: ProductGroup;
  product_code: string | null;
  kind: 'image' | 'video';
  blob_url: string;
  pathname: string;
  content_type: string;
  size_bytes: number;
  caption: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface MediaListResponse {
  success: boolean;
  items: MediaItem[];
}

export interface MediaSingleResponse {
  success: boolean;
  item: MediaItem;
}

export interface MediaDeleteResponse {
  success: boolean;
  deleted: string;
}

export interface MediaCreatePayload {
  id?: string;
  title: string;
  description?: string;
  product_group: ProductGroup;
  product_code?: string | null;
  kind?: 'image' | 'video';
  blob_url: string;
  pathname?: string;
  content_type?: string;
  size_bytes?: number;
  caption?: string;
  active?: boolean;
  sort_order?: number;
  created_at?: string;
  created_by?: string;
}

export type MediaUpdatePayload = Partial<MediaCreatePayload>;

export type FlowContext =
  | 'already_talking'
  | 'email_first_contact'
  | 'form_first_contact'
  | 'manual';

export type FlowChannel = 'whatsapp';

export interface TextFlowStep {
  id: string;
  type: 'text';
  template: string;
}

export interface DocumentFlowStep {
  id: string;
  type: 'document';
  source: 'quotation_pdf';
  caption?: string;
}

export interface ProductMediaFlowStep {
  id: string;
  type: 'product_media';
  selection?: string;
  max_items?: number;
  caption_template?: string;
}

export type CommunicationFlowStep =
  | TextFlowStep
  | DocumentFlowStep
  | ProductMediaFlowStep;

export interface CommunicationFlow {
  id: string;
  name: string;
  description?: string;
  context: FlowContext;
  channel: FlowChannel;
  vendor_name: string;
  enabled: boolean;
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_media_per_product_group: number;
  steps: CommunicationFlowStep[];
  created_at?: string;
  updated_at?: string;
}

export interface FlowsResponse {
  success: boolean;
  flows: CommunicationFlow[];
  selectedFlowId: string | null;
  source: string;
}

export interface SaveFlowsPayload {
  flows: CommunicationFlow[];
  selectedFlowId?: string | null;
}

export interface SaveFlowsResponse {
  success: boolean;
  source: string;
}

export interface ExecuteFlowPayload {
  quotation_id: string;
  flow_id: string;
  telefone: string;
  nome: string;
  deal_id?: string | null;
  items?: unknown[];
}

export interface ExecuteFlowResponse {
  success: boolean;
  dry_run: boolean;
  duplicate_warning: boolean;
  duplicate_message: string;
  flow_id: string;
  flow_name: string;
  quotation_id: string | null;
  deal_id: string | null;
  phone: string;
  product_summary: string;
  categories: string[];
  steps_count: number;
  steps: unknown[];
  evolution: unknown[];
  send_event_id: string | null;
}

// ── Media endpoints ────────────────────────────────────────────────────────

/**
 * Fetch all media assets, optionally filtered.
 */
export async function fetchMedia(
  filters: MediaFilters = {},
): Promise<MediaListResponse> {
  const params = new URLSearchParams();
  if (filters.product_group) params.set('product_group', filters.product_group);
  if (filters.active !== undefined) params.set('active', filters.active ? '1' : '0');
  if (filters.kind) params.set('kind', filters.kind);

  const qs = params.toString();
  const url = `/api/communication-media${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Erro ${res.status} ao carregar mídias.`);
  }
  return res.json() as Promise<MediaListResponse>;
}

/**
 * Fetch a single media asset by ID.
 */
export async function fetchMediaById(id: string): Promise<MediaSingleResponse> {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Mídia não encontrada.');
  }
  return res.json() as Promise<MediaSingleResponse>;
}

/**
 * Create a media asset record after Blob upload completes.
 */
export async function createMedia(
  payload: MediaCreatePayload,
): Promise<MediaSingleResponse> {
  const res = await fetch('/api/communication-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { error?: string } & Partial<MediaSingleResponse>;
  if (!res.ok) throw new Error(data.error || 'Erro ao salvar mídia.');
  return data as MediaSingleResponse;
}

/**
 * Update a media asset.
 */
export async function updateMedia(
  id: string,
  payload: MediaUpdatePayload,
): Promise<MediaSingleResponse> {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { error?: string } & Partial<MediaSingleResponse>;
  if (!res.ok) throw new Error(data.error || 'Erro ao atualizar mídia.');
  return data as MediaSingleResponse;
}

/**
 * Delete a media asset.
 */
export async function deleteMedia(id: string): Promise<MediaDeleteResponse> {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = (await res.json()) as { error?: string } & Partial<MediaDeleteResponse>;
  if (!res.ok) throw new Error(data.error || 'Erro ao remover mídia.');
  return data as MediaDeleteResponse;
}

// ── Flow endpoints ─────────────────────────────────────────────────────────

/**
 * Fetch communication flows from KV.
 */
export async function fetchFlows(): Promise<FlowsResponse> {
  const res = await fetch('/api/communication-flows');
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Erro ao carregar fluxos.');
  }
  return res.json() as Promise<FlowsResponse>;
}

/**
 * Save communication flows to KV.
 */
export async function saveFlows(
  flows: CommunicationFlow[],
  selectedFlowId?: string | null,
): Promise<SaveFlowsResponse> {
  const res = await fetch('/api/communication-flows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flows, selectedFlowId } satisfies SaveFlowsPayload),
  });
  const data = (await res.json()) as { error?: string } & Partial<SaveFlowsResponse>;
  if (!res.ok) throw new Error(data.error || 'Erro ao salvar fluxos.');
  return data as SaveFlowsResponse;
}

// ── Send endpoints ─────────────────────────────────────────────────────────

/**
 * Execute a WhatsApp flow for a quotation.
 */
export async function executeFlow(
  payload: ExecuteFlowPayload,
): Promise<ExecuteFlowResponse> {
  const res = await fetch('/api/send-whatsapp-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { error?: string } & Partial<ExecuteFlowResponse>;
  if (!res.ok) throw new Error(data.error || 'Erro ao enviar WhatsApp.');
  return data as ExecuteFlowResponse;
}
