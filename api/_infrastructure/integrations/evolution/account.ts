import { conversationId } from '../../../_shared/contact-phone.js';
import { getEvolutionClient, type EvolutionClient } from './client.js';

const ACCOUNT_TIMEOUT_MS = 5_000;
const ACCOUNT_CACHE_MS = 60_000;

let cached: { instance: string; accountId: string; at: number } | null = null;

/**
 * The phone JID of the account connected to the instance. It is the same
 * identifier the extension reads as the logged-in user, so both scope client
 * links alike; a reconnect to another number yields another scope. Returns ''
 * when the provider cannot tell, and the caller must then refuse to link.
 */
export async function readConnectedAccountId(
  client: EvolutionClient = getEvolutionClient(),
  clock: () => number = Date.now,
): Promise<string> {
  const instance = client.config().instance;
  if (!instance) return '';
  if (cached && cached.instance === instance && clock() - cached.at < ACCOUNT_CACHE_MS) return cached.accountId;
  try {
    const response = await client.request(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
      undefined,
      { externalWrite: false, signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS) },
    );
    if (!response.ok) return '';
    const payload: unknown = await response.json();
    const entry = (Array.isArray(payload) ? payload : [payload]).find(
      (item) => item && typeof item === 'object' && (item as Record<string, unknown>).name === instance,
    ) as Record<string, unknown> | undefined;
    // The device suffix is dropped, as the extension does for the same JID.
    const owner = typeof entry?.ownerJid === 'string' ? entry.ownerJid.replace(/:\d+@/, '@') : '';
    const accountId = entry?.connectionStatus === 'open' ? conversationId(owner) : '';
    // Only a phone JID identifies the account; anything else is not cached.
    if (!accountId.endsWith('@s.whatsapp.net')) return '';
    cached = { instance, accountId, at: clock() };
    return accountId;
  } catch {
    return '';
  }
}

export function resetConnectedAccountCache(): void {
  cached = null;
}
