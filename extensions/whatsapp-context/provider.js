/* global setTimeout, clearTimeout */
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

  function visibleConversationKey(documentRef) {
    if (!documentRef?.querySelector) return '';
    const header = selectedHeader(documentRef);
    const composer = documentRef.querySelector('#main [contenteditable="true"][aria-label]');
    return [textFromElement(header), clean(composer?.getAttribute('aria-label'))].join('|');
  }

  function activeMatchesDom(active, domTechnical) {
    if (!domTechnical) return true;
    const modelTechnical = jid(active?.technicalId);
    if (modelTechnical === domTechnical) return true;
    return modelTechnical.endsWith('@lid') && domTechnical.endsWith('@s.whatsapp.net')
      && clean(active?.phone) === domTechnical.split('@')[0];
  }

  function isGroup(id, headerText) {
    return /@(g\.us|broadcast)$/i.test(id) || /\b(grupo|group|comunidade|community)\b/i.test(headerText);
  }

  function readActiveIdentity() {
    if (!global.addEventListener || !global.postMessage) return Promise.resolve(null);
    return new Promise(function (resolve) {
      const requestId = global.crypto.randomUUID();
      const finish = function (value) { clearTimeout(timer); global.removeEventListener('message', receive); resolve(value); };
      const receive = function (event) {
        if (event.source !== global || event.origin !== 'https://web.whatsapp.com' || event.data?.type !== 'aspen:identity-response' || event.data.requestId !== requestId) return;
        finish(event.data.identity);
      };
      const timer = setTimeout(function () { finish(null); }, 800);
      global.addEventListener('message', receive);
      global.postMessage({ type: 'aspen:identity-request', requestId }, 'https://web.whatsapp.com');
    });
  }


  async function resolveConversation(options) {
    const opts = options || {};
    const documentRef = opts.documentRef || global.document;
    const activeReader = opts.readActiveIdentity || readActiveIdentity;
    let active = await activeReader();
    if (!documentRef || !documentRef.querySelector) return { status: 'unsupported' };

    let header = selectedHeader(documentRef);
    let domTechnical = technicalId(documentRef, header);
    let headerText = textFromElement(header);
    const visibleBefore = visibleConversationKey(documentRef);
    if (active?.status === 'resolved') {
      const confirmed = await activeReader();
      const stable = confirmed?.status === 'resolved' && ['accountId', 'technicalId', 'phone'].every(function (key) {
        return clean(active[key]) === clean(confirmed[key]);
      });
      header = selectedHeader(documentRef);
      domTechnical = technicalId(documentRef, header);
      headerText = textFromElement(header);
      const visibleAfter = visibleConversationKey(documentRef);
      if (!stable || visibleBefore !== visibleAfter || !activeMatchesDom(confirmed, domTechnical)) {
        return { status: 'resolving', displayName: displayName(header) || null };
      }
      active = confirmed;
    }
    const accountId = active?.status === 'resolved' ? jid(active.accountId) : accountIdentity(opts.storageRef || global.localStorage);
    const technical = active?.status === 'resolved' ? jid(active.technicalId) : domTechnical;
    if (!header && !technical) return { status: 'idle' };
    const remember = function (value) {
      value.accountId = accountId || null;
      return value;
    };
    if (active?.status === 'idle') return { status: 'idle' };
    if (isGroup(active?.technicalId || technical, headerText)) {
      return remember({ status: 'unsupported', technicalId: technical || null, displayName: displayName(header) || null });
    }

    const visiblePhone = /^[+\d\s().-]+$/.test(headerText) ? normalizePhone(headerText) : '';
    const directPhone = /@s\.whatsapp\.net$/.test(technical) ? technical.split('@')[0] : '';
    const modelPhone = active?.status === 'resolved' && /^\d{10,15}$/.test(active.phone || '') ? active.phone : '';
    if (modelPhone || visiblePhone || directPhone) {
      return remember({
        status: 'ready',
        displayName: displayName(header) || null,
        phone: modelPhone || visiblePhone || directPhone,
        technicalId: technical || null,
        source: modelPhone ? 'active-model' : visiblePhone ? 'visible-phone' : 'conversation-id',
      });
    }

    return remember({ status: 'unresolved', displayName: displayName(header) || null, technicalId: technical || null, reason: technical ? 'lid-only' : 'phone-not-visible' });
  }
  global.AspenWhatsappProvider = Object.freeze({ clean, normalizePhone, resolveConversation, visibleConversationKey, accountIdentity, jid });
})(globalThis);
