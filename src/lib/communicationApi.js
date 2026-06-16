/**
 * Communication API client — centralized fetch helpers for:
 *   - Media assets (communication-media endpoints)
 *   - Communication flows (communication-flows endpoints)
 *   - Send events history
 *
 * All functions return { success, ...data } or throw with Portuguese error messages.
 */

// ── Media endpoints ────────────────────────────────────────────────────────

/**
 * Fetch all media assets, optionally filtered.
 * @param {{ product_group?: string, active?: boolean, kind?: string }} filters
 * @returns {Promise<{ success: boolean, items: Array }>}
 */
export async function fetchMedia(filters = {}) {
  const params = new URLSearchParams();
  if (filters.product_group) params.set('product_group', filters.product_group);
  if (filters.active !== undefined) params.set('active', filters.active ? '1' : '0');
  if (filters.kind) params.set('kind', filters.kind);

  const qs = params.toString();
  const url = `/api/communication-media${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erro ${res.status} ao carregar mídias.`);
  }
  return res.json();
}

/**
 * Fetch a single media asset by ID.
 */
export async function fetchMediaById(id) {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Mídia não encontrada.');
  }
  return res.json();
}

/**
 * Create a media asset record after Blob upload completes.
 */
export async function createMedia(payload) {
  const res = await fetch('/api/communication-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao salvar mídia.');
  return data;
}

/**
 * Update a media asset.
 */
export async function updateMedia(id, payload) {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao atualizar mídia.');
  return data;
}

/**
 * Delete a media asset.
 */
export async function deleteMedia(id) {
  const res = await fetch(`/api/communication-media?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao remover mídia.');
  return data;
}

// ── Flow endpoints ─────────────────────────────────────────────────────────

/**
 * Fetch communication flows from KV.
 */
export async function fetchFlows() {
  const res = await fetch('/api/communication-flows');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao carregar fluxos.');
  }
  return res.json();
}

/**
 * Save communication flows to KV.
 */
export async function saveFlows(flows, selectedFlowId) {
  const res = await fetch('/api/communication-flows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flows, selectedFlowId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao salvar fluxos.');
  return data;
}

// ── Send endpoints ─────────────────────────────────────────────────────────

/**
 * Execute a WhatsApp flow for a quotation.
 */
export async function executeFlow(payload) {
  const res = await fetch('/api/send-whatsapp-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao enviar WhatsApp.');
  return data;
}

// ── Product group utilities ────────────────────────────────────────────────

export const PRODUCT_GROUPS = ['canga', 'lenço', 'boné', 'toalha', 'chapéu', 'ecobag', 'cachecol'];

export const GROUP_LABELS = {
  canga: 'Canga',
  lenço: 'Lenço',
  boné: 'Boné',
  toalha: 'Toalha',
  chapéu: 'Chapéu',
  ecobag: 'Ecobag',
  cachecol: 'Cachecol',
};
