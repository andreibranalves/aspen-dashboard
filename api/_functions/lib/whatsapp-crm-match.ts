// whatsapp-crm-match.ts
// Resolves the best CRM match (Lead / Customer) for a WhatsApp conversation.
//
// Matching order: phone → email → name (conservative).
// Persists the chosen link on the conversation record for reuse.

import { cleanText, type WhatsappConversation, type WhatsappConversationStoreDeps } from './whatsapp-conversations-store.js';
import { updateWhatsappConversation } from './whatsapp-conversations-store.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WhatsappCrmMatch {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}

export interface ResolveCrmMatchDeps extends WhatsappConversationStoreDeps {
  listLeads: (filters: Array<Array<string | number>>) => Promise<Array<Record<string, unknown>>>;
  getDoc: (doctype: string, name: string) => Promise<Record<string, unknown> | null>;
}

// ── Normalization helpers ──────────────────────────────────────────────────

function onlyDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneComparison(phone: unknown): string {
  let digits = onlyDigits(phone);
  // Strip leading 55 country-code for short comparison
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeNameComparison(name: unknown): string {
  return cleanText(name).toLowerCase();
}

// ── Match logic ────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
}

function mapLead(row: Record<string, unknown>): Candidate {
  return {
    id: String(row.name),
    tipo: 'lead',
    nome: String(row.first_name || row.lead_name || ''),
    telefone: (row.mobile_no as string) || null,
    email: (row.email_id as string) || null,
  };
}

async function findCandidates(
  conversation: WhatsappConversation,
  deps: ResolveCrmMatchDeps
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const phoneDigits = normalizePhoneComparison(conversation.phone);

  // 1. Try by phone on Leads
  if (phoneDigits) {
    const leads = await deps.listLeads([['mobile_no', 'like', `%${conversation.phone}%`]]);
    for (const row of leads) {
      if (normalizePhoneComparison(row.mobile_no) === phoneDigits) {
        candidates.push(mapLead(row));
      }
    }
  }

  // 2. Name-based fallback — conservative: requires at least 2 words
  const nameCandidate = normalizeNameComparison(conversation.displayName);
  const nameParts = nameCandidate.split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2 && nameParts.join('').length >= 5) {
    const leads = await deps.listLeads([['lead_name', '=', cleanText(conversation.displayName)]]);
    for (const row of leads) {
      const candidate = mapLead(row);
      // Avoid duplicates
      if (!candidates.some((c) => c.id === candidate.id)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

/**
 * Validate a saved CRM link still resolves to an existing document.
 * Returns the document if valid, null if not.
 */
async function validateSavedLink(
  entityId: string,
  entityType: 'lead' | 'cliente',
  deps: ResolveCrmMatchDeps
): Promise<Candidate | null> {
  const erpDoctype = entityType === 'lead' ? 'Lead' : 'Customer';
  try {
    const doc = await deps.getDoc(erpDoctype, entityId);
    if (!doc) return null;
    const nome = entityType === 'lead'
      ? String(doc.first_name || doc.lead_name || doc.customer_name || '')
      : String(doc.customer_name || '');
    return {
      id: String(doc.name || entityId),
      tipo: entityType,
      nome,
      telefone: (doc.mobile_no as string) || (doc.phone as string) || null,
      email: (doc.email_id as string) || null,
    };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function resolveWhatsappCrmMatch(input: {
  conversation: WhatsappConversation;
  deps: ResolveCrmMatchDeps;
}): Promise<WhatsappCrmMatch | null> {
  const { conversation, deps } = input;

  // 1. If a saved CRM link exists, validate it first
  if (conversation.linkedCrmEntityId && conversation.linkedCrmEntityType) {
    const valid = await validateSavedLink(
      conversation.linkedCrmEntityId,
      conversation.linkedCrmEntityType as 'lead' | 'cliente',
      deps
    );
    if (valid) {
      return {
        id: valid.id,
        tipo: valid.tipo,
        nome: valid.nome,
        telefone: valid.telefone,
        email: valid.email,
        matchSource: (conversation.linkedCrmMatchSource as WhatsappCrmMatch['matchSource']) || 'phone',
      };
    }
    // Link invalid — clear it and fall through to fresh resolution
    await updateWhatsappConversation(
      conversation.id,
      { linkedCrmEntityId: null, linkedCrmEntityType: null, linkedCrmMatchSource: null },
      deps
    );
  }

  // 2. Need phone or name to attempt a match
  const hasPhone = !!normalizePhoneComparison(conversation.phone);
  const nameParts = normalizeNameComparison(conversation.displayName).split(/\s+/).filter(Boolean);
  const hasName = nameParts.length >= 2 && nameParts.join('').length >= 5;

  if (!hasPhone && !hasName) {
    return null;
  }

  // 3. Find candidates
  const candidates = await findCandidates(conversation, deps);

  if (candidates.length === 0) {
    return null;
  }

  // 4. Pick the best candidate and determine match source
  const best = candidates[0];
  let matchSource: WhatsappCrmMatch['matchSource'] = 'name';

  if (hasPhone) {
    const phoneDigits = normalizePhoneComparison(conversation.phone);
    if (normalizePhoneComparison(best.telefone) === phoneDigits) {
      matchSource = 'phone';
    }
  }

  // 5. Persist the link on the conversation
  await updateWhatsappConversation(
    conversation.id,
    {
      linkedCrmEntityId: best.id,
      linkedCrmEntityType: best.tipo,
      linkedCrmMatchSource: matchSource,
    },
    deps
  );

  return {
    id: best.id,
    tipo: best.tipo,
    nome: best.nome,
    telefone: best.telefone,
    email: best.email,
    matchSource,
  };
}
