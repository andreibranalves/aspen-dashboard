importScripts('config.js');

(function () {
  /* global chrome, fetch, importScripts, URL */
  'use strict';

  function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    let safe = '';
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code >= 0x20 && code !== 0x7f) safe += character;
    }
    const normalized = safe.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, maxLength);
  }

  function phoneDigits(value) {
    const digits = String(value || '').replace(/\\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? digits : '';
  }

  async function lookupContext(message) {
    const phone = phoneDigits(message.phone);
    const name = cleanText(message.name, 200);
    if (!phone) return { ok: true, data: { match: 'unresolved' } };

    const origin = globalThis.AspenExtensionConfig.origin;
    const url = new URL('/api/whatsapp-context', origin);
    url.searchParams.set('phone', phone);
    if (name) url.searchParams.set('name', name);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.status === 401) {
        return { ok: false, code: 'unauthenticated', error: 'Faça login no Aspen para consultar o contexto.' };
      }
      if (!response.ok || !body || body.success !== true || !body.data) {
        return { ok: false, code: 'request_failed', error: 'Não foi possível consultar o contexto agora.' };
      }
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, code: 'network', error: 'Aspen indisponível no momento.' };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'lookupContext') return false;
    lookupContext(message).then(sendResponse).catch(() => {
      sendResponse({ ok: false, code: 'request_failed', error: 'Não foi possível consultar o contexto agora.' });
    });
    return true;
  });
})();
