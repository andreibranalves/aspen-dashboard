// api/_functions/lib/customer-resolution.js
// Resolve Customer/Lead/Contact/Address for the quotation pipeline.
// Extracted from orcamento.js — no behavior changes.

import { createHttpError, erpGetList, erpGetDoc, erpPost, erpPut } from './erpnext.js';
import { normalizeCnpj } from './client-metadata.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

function sanitizeName(name) {
  return name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPhone(phone) {
  if (!phone) return '';
  const d = phone
    .replace(/\D/g, '')
    .replace(/^55(\d{10,11})$/, '$1')
    .replace(/^0(\d{10,11})$/, '$1');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

// ── Party resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the party (Customer or Lead) for a quotation.
 *
 * @param {object} opts
 * @param {string} opts.nome - raw client name
 * @param {string} opts.email - client email (may be empty)
 * @param {string} opts.telefone - raw phone (may be empty)
 * @param {string} opts.cnpj - normalized CNPJ (may be empty)
 * @param {string} opts.origem - validated lead source
 * @param {boolean} opts.utmSourceExists - whether UTM Source record exists
 * @returns {Promise<{ entityId: string, entityType: 'Customer'|'Lead', contactId: string|null, customerIsNew: boolean }>}
 */
export async function resolveParty({ nome, email, telefone, cnpj, origem, utmSourceExists }) {
  const nomeCliente = sanitizeName(nome);
  const phoneFormatted = formatPhone(telefone);
  const emailNormalized = email?.trim().toLowerCase() || '';

  let entityId;
  let entityType = 'Customer';
  let contactId = null;
  let customerIsNew = false;

  // 1. Look up by email → Contact → Customer
  if (emailNormalized) {
    const contData = await erpGetList('Contact', {
      filters: [['email_id', '=', emailNormalized]],
    });
    if (contData.length > 0) {
      contactId = contData[0].name;
      const fullContact = await erpGetDoc('Contact', contactId);
      const customerLink = fullContact?.links?.find((l) => l.link_doctype === 'Customer');
      if (customerLink) {
        entityId = customerLink.link_name;
        entityType = 'Customer';
      }
    }
  }

  // 2. Fallback: Lead by email
  if (!entityId && emailNormalized) {
    const leadData = await erpGetList('Lead', {
      filters: [['email_id', '=', emailNormalized]],
    });
    if (leadData.length > 0) {
      entityId = leadData[0].name;
      entityType = 'Lead';
    }
  }

  // 3. CNPJ conflict check (only for existing Customers)
  if (cnpj && entityType === 'Customer') {
    const custData = await erpGetList('Customer', {
      filters: [['name', '=', entityId]],
      fields: ['name', 'tax_id'],
      limit: 1,
    });
    if (custData.length > 0) {
      const existingTaxId = normalizeCnpj(custData[0].tax_id || '');
      if (existingTaxId && existingTaxId !== cnpj) {
        throw createHttpError(
          409,
          `CNPJ informado (${cnpj}) difere do CNPJ já cadastrado para este cliente. Verifique os dados ou entre em contato com o suporte.`,
        );
      }
    }
  }

  // 4. Create Lead if no match
  if (!entityId) {
    customerIsNew = true;
    entityType = 'Lead';
    const l = await erpPost('Lead', {
      first_name: nomeCliente,
      email_id: emailNormalized,
      mobile_no: phoneFormatted,
      status: 'Lead',
      type: 'Client',
      ...(utmSourceExists ? { utm_source: origem } : {}),
    });
    entityId = l.name;
  } else if (entityType === 'Customer') {
    // Update existing Customer name if changed
    const custData = await erpGetList('Customer', {
      filters: [['name', '=', entityId]],
    });
    if (custData.length > 0 && custData[0].customer_name !== nomeCliente) {
      await erpPut('Customer', entityId, { customer_name: nomeCliente });
    }
    // Fill tax_id if blank and CNPJ provided
    if (cnpj) {
      const existingTaxId = normalizeCnpj(custData[0]?.tax_id || '');
      if (!existingTaxId) {
        await erpPut('Customer', entityId, { tax_id: cnpj });
      }
    }
  } else if (entityType === 'Lead') {
    // Update existing Lead name if changed
    const leadData = await erpGetList('Lead', {
      filters: [['name', '=', entityId]],
    });
    if (leadData.length > 0 && leadData[0].first_name !== nomeCliente) {
      await erpPut('Lead', entityId, { first_name: nomeCliente });
    }
    // Fill utm_source if blank
    if (utmSourceExists && !leadData[0]?.utm_source) {
      await erpPut('Lead', entityId, { utm_source: origem });
    }
  }

  // 5. Contact upsert
  if (contactId) {
    const upd = {};
    if (emailNormalized)
      upd.email_ids = [{ email_id: emailNormalized, is_primary: 1 }];
    if (phoneFormatted)
      upd.phone_nos = [{ phone: phoneFormatted, is_primary_mobile_no: 1 }];
    if (Object.keys(upd).length) await erpPut('Contact', contactId, upd);
  } else {
    const cp = {
      first_name: nomeCliente,
      links: [{ link_doctype: entityType, link_name: entityId }],
    };
    if (emailNormalized)
      cp.email_ids = [{ email_id: emailNormalized, is_primary: 1 }];
    if (phoneFormatted)
      cp.phone_nos = [{ phone: phoneFormatted, is_primary_mobile_no: 1 }];
    const con = await erpPost('Contact', cp);
    contactId = con.name || null;
  }

  return { entityId, entityType, contactId, customerIsNew, nomeCliente, phoneFormatted, emailNormalized };
}

// ── Address resolution ───────────────────────────────────────────────────────

/**
 * Create an ERPNext Address for the resolved party if minimum data is present.
 *
 * @param {object} opts
 * @param {object} opts.endereco - normalized address payload
 * @param {string} opts.nomeCliente - sanitized client name
 * @param {string} opts.email - normalized email
 * @param {string} opts.telefone - formatted phone
 * @param {string} opts.entityType - 'Customer' or 'Lead'
 * @param {string} opts.entityId - ERPNext entity ID
 * @returns {Promise<{ addressId: string|null, warnings: Array }>}
 */
export async function resolveAddress({
  endereco,
  nomeCliente,
  email,
  telefone,
  entityType,
  entityId,
}) {
  // We import these lazily to avoid circular deps — the function already
  // requires them via the parent module imports.
  const { hasMinimumAddressForErp, buildAddressPayload } = await import('./client-metadata.js');

  let addressId = null;
  const warnings = [];

  if (hasMinimumAddressForErp(endereco)) {
    try {
      const addrPayload = buildAddressPayload({
        address: endereco,
        nomeCliente,
        email,
        telefone,
        entityType,
        entityId,
      });
      const addr = await erpPost('Address', addrPayload);
      addressId = addr.name || null;
    } catch (addrErr) {
      console.error(
        '[customer-resolution] Address creation failed:',
        addrErr?.message || addrErr,
      );
      warnings.push({
        code: 'address_create_failed',
        message:
          'Não foi possível criar o endereço no ERPNext. O orçamento foi criado sem endereço vinculado.',
      });
    }
  } else if (Object.values(endereco).some((v) => v.length > 0)) {
    warnings.push({
      code: 'address_incomplete',
      message: 'Endereço incompleto; orçamento criado sem Address no ERPNext.',
    });
  }

  return { addressId, warnings };
}
