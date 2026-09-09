/* Reads only the open conversation and connected account. */
(function installAspenWhatsappProvider(global) {
  'use strict';

  const MAX_MESSAGE_NODES = 40;
  const JID_RE = /^(\d{10,15})@(s\.whatsapp\.net|c\.us)$/i;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizePhone(value) {
    const raw = clean(value);
    if (!raw || raw.includes('@') && !JID_RE.test(raw)) return '';
    let digits = raw.split('@')[0].replace(/\D/g, '');
    if (!raw.startsWith('+') && !raw.includes('@') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
    return /^\d{10,15}$/.test(digits) ? digits : '';
  }

  function textFromElement(element) {
    if (!element) return '';
    return clean(element.getAttribute('title') || element.textContent || '');
  }

  function selectedHeader(documentRef) {
    const selectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-header"]',
      '[role="main"] header',
    ];
    for (const selector of selectors) {
      const element = documentRef.querySelector(selector);
      if (element && textFromElement(element)) return element;
    }
    return null;
  }

  function jid(value) {
    const raw = clean(value);
    const match = raw.match(/^(?:true_|false_)?(\d{5,20})(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)(?:_|$)/i);
    return match ? match[1] + '@' + (match[2] === 'c.us' ? 's.whatsapp.net' : match[2]) : '';
  }

  function accountIdentity(storage) {
    try {
      const value = JSON.parse(storage.getItem('last-wid-md') || 'null');
      return jid(typeof value === 'string' ? value : value && value._serialized);
    } catch { return ''; }
  }

  function technicalId(documentRef, header) {
    const main = documentRef.querySelector('[role="main"]') || documentRef.querySelector('#main');
    const nodes = [header, main];
    if (main && main.querySelectorAll) nodes.push(...Array.from(main.querySelectorAll('[data-id], [data-message-id]')).slice(-MAX_MESSAGE_NODES));
    const ids = new Set();
    for (const node of nodes) {
      for (const attr of ['data-id', 'data-message-id']) {
        const value = node && node.getAttribute && node.getAttribute(attr);
        if (/@(?:g\.us|broadcast)/i.test(value || '')) return 'unsupported@g.us';
        const id = jid(value);
        if (id) ids.add(id);
      }
    }
    return ids.size === 1 ? [...ids][0] : '';
  }

  function displayName(header) {
    if (!header) return '';
    const labelled = header.querySelector('[title], [aria-label]');
    return clean(labelled && (labelled.getAttribute('title') || labelled.getAttribute('aria-label'))) || textFromElement(header);
  }

  function isGroup(id, headerText) {
    return /@(g\.us|broadcast)$/i.test(id) || /\b(grupo|group|comunidade|community)\b/i.test(headerText);
  }


  async function resolveConversation(options) {
    const opts = options || {};
    const documentRef = opts.documentRef || global.document;
    const accountId = accountIdentity(opts.storageRef || global.localStorage);
    if (!documentRef || !documentRef.querySelector) return { status: 'unsupported' };

    const header = selectedHeader(documentRef);
    const technical = technicalId(documentRef, header);
    const headerText = textFromElement(header);
    if (!header && !technical) return { status: 'idle' };
    const remember = function (value) {
      value.accountId = accountId || null;
      return value;
    };
    if (isGroup(technical, headerText)) {
      return remember({ status: 'unsupported', technicalId: technical || null, displayName: displayName(header) || null });
    }

    const visiblePhone = /^[+\d\s().-]+$/.test(headerText) ? normalizePhone(headerText) : '';
    const directPhone = /@s\.whatsapp\.net$/.test(technical) ? technical.split('@')[0] : '';
    if (visiblePhone || directPhone) {
      return remember({
        status: 'ready',
        displayName: displayName(header) || null,
        phone: visiblePhone || directPhone,
        technicalId: technical || null,
        source: visiblePhone ? 'visible-phone' : 'conversation-id',
      });
    }

    return remember({ status: 'unresolved', displayName: displayName(header) || null, technicalId: technical || null, reason: technical ? 'lid-only' : 'phone-not-visible' });
  }
  global.AspenWhatsappProvider = Object.freeze({ clean, normalizePhone, resolveConversation, accountIdentity, jid });
})(globalThis);
