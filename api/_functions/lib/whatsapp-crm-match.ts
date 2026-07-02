// whatsapp-crm-match.ts
// Resolves the best CRM match (Lead / Customer) for a WhatsApp conversation.
//
// Matching order: phone → email → name (conservative).
// Persists the chosen link on the conversation record for reuse.

import {
  cleanText,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

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

function normalizeEmailComparison(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeNameComparison(name: unknown): string {
  return cleanText(name).toLowerCase();
}

function extractEmailsFromMessages(messages: Array<{ body: string; direction: string }>): string[] {
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const found = new Set<string>();
  for (const msg of messages) {
    if (msg.direction !== 'inbound') continue;
    const matches = msg.body.match(emailRe);
    if (matches) {
      for (const m of matches) {
        found.add(normalizeEmailComparison(m));
      }
    }
  }
  return [...found];
}

function normalizePhoneVariants(phone: unknown): string[] {
  const digits = onlyDigits(phone);
  if (!digits) return [];
  const variants = new Set<string>();
  variants.add(digits);
  // With 55 prefix (full international)
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    variants.add(`55${digits}`);
  }
  // Without 55 prefix (local)
  if (digits.startsWith('55') && digits.length >= 12) {
    variants.add(digits.slice(2));
  }
  return [...variants];
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
  const seenIds = new Set<string>();

  const addUnique = (c: Candidate) => {
    if (!seenIds.has(c.id)) {
      seenIds.add(c.id);
      candidates.push(c);
    }
  };

  // 1. Try by phone on Leads — query both with and without 55 prefix
  const phoneVariants = normalizePhoneVariants(conversation.canonicalPhone);
  const phoneDigits = phoneVariants[0] || '';
  if (phoneDigits) {
    for (const variant of phoneVariants) {
      const leads = await deps.listLeads([['mobile_no', 'like', `%${variant}%`]]);
      for (const row of leads) {
        if (normalizePhoneComparison(row.mobile_no) === normalizePhoneComparison(phoneDigits)) {
          addUnique(mapLead(row));
        }
      }
    }
  }

  // 2. Try by email extracted from conversation messages
  const messages = await deps.readMessages(conversation.id);
  const emails = extractEmailsFromMessages(messages);
  for (const email of emails) {
    const leads = await deps.listLeads([['email_id', '=', email]]);
    for (const row of leads) {
      addUnique(mapLead(row));
    }
  }

  // 3. Name-based fallback — conservative: requires at least 2 words
  const nameCandidate = normalizeNameComparison(conversation.displayName);
  const nameParts = nameCandidate.split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2 && nameParts.join('').length >= 5) {
    const leads = await deps.listLeads([['lead_name', '=', cleanText(conversation.displayName)]]);
    for (const row of leads) {
      addUnique(mapLead(row));
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
    const nome =
      entityType === 'lead'
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
        matchSource:
          (conversation.linkedCrmMatchSource as WhatsappCrmMatch['matchSource']) || 'phone',
      };
    }
    // Link invalid - just fall through to fresh resolution, do not clear link on GET
  }

  // 2. If identity is too weak, don't auto-match
  if (conversation.identityStatus === 'unresolved' || conversation.identityStatus === 'conflict') {
    return null;
  }

  // 3. Find candidates (phone, email from messages, then name fallback)
  const candidates = await findCandidates(conversation, deps);

  if (candidates.length === 0) {
    return null;
  }

  // 3. Pick the best candidate and determine match source
  const best = candidates[0];
  let matchSource: WhatsappCrmMatch['matchSource'] = 'name';

  const phoneDigits = normalizePhoneComparison(conversation.canonicalPhone);
  if (phoneDigits && normalizePhoneComparison(best.telefone) === phoneDigits) {
    matchSource = 'phone';
  } else if (best.email) {
    // Check if the best candidate's email was found in conversation messages
    const messages = await deps.readMessages(conversation.id);
    const emails = extractEmailsFromMessages(messages);
    if (emails.includes(normalizeEmailComparison(best.email))) {
      matchSource = 'email';
    }
  }

  // 4. Return the match (do not persist automatically on read)
  return {
    id: best.id,
    tipo: best.tipo,
    nome: best.nome,
    telefone: best.telefone,
    email: best.email,
    matchSource,
  };
}
