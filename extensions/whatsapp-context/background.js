/* global importScripts, URL, fetch, chrome, AbortController, clearTimeout, setTimeout */
importScripts('./config.js');

(function installAspenWhatsappBackground(global) {
  'use strict';

  const config = global.ASPEN_WHATSAPP_CONTEXT_CONFIG || {};
  const PHONE_RE = /^\d{10,15}$/;
  const REQUEST_TIMEOUT_MS = 8000;

  function safeOrigin(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
      return parsed.origin;
    } catch {
      return '';
    }
  }

  function publicError(status) {
    if (status === 401) return { status: 'login_required', message: 'Faça login no Aspen para consultar o contexto.' };
    if (status >= 500) return { status: 'error', message: 'Aspen indisponível. Tente novamente.' };
    return { status: 'error', message: 'Não foi possível consultar o contexto.' };
  }

  async function lookup(message) {
    const appOrigin = safeOrigin(config.appOrigin);
    const phone = String(message.phone || '');
    if (!appOrigin || phone && !PHONE_RE.test(phone) || !phone && !message.conversationId) return { status: 'unresolved', message: 'Telefone não confirmado.' };
    const endpoint = new URL(config.endpointPath || '/api/whatsapp-context', appOrigin);
    if (phone) endpoint.searchParams.set('phone', phone);
    for (const key of ['accountId', 'conversationId', 'search', 'phoneSource']) {
      if (message[key]) endpoint.searchParams.set(key, String(message[key]));
    }
    const method = message.type === 'aspen-context:link' ? 'PUT' : message.type === 'aspen-context:unlink' ? 'DELETE' : 'GET';
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.toString(), {
        method,
        ...(method !== 'GET' ? { body: JSON.stringify({ clientId: message.clientId, expectedVersion: message.expectedVersion, expectedClientPhone: message.expectedClientPhone, expectedClientName: message.expectedClientName }) } : {}),
        credentials: 'include',
        mode: 'cors',
        headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
        signal: controller.signal,
      });
      const body = await response.json().catch(function () { return null; });
      if (!response.ok) return response.status === 409 ? { status: 'error', message: 'O vínculo mudou. Atualize o painel e tente novamente.' } : publicError(response.status);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'error', message: 'Resposta inválida do Aspen.' };
      return body;
    } catch (error) {
      return { status: 'error', message: error && error.name === 'AbortError' ? 'Aspen indisponível. Tente novamente.' : 'Não foi possível conectar ao Aspen.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  function openApp(path) {
    const origin = safeOrigin(config.appOrigin);
    if (!origin) return;
    const target = new URL(path || '/', origin).toString();
    chrome.tabs.create({ url: target });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || typeof message !== 'object') return false;
    if (['aspen-context:lookup', 'aspen-context:link', 'aspen-context:unlink'].includes(message.type)) {
      if (message.type !== 'aspen-context:lookup' && (!_sender || !String(_sender.url || '').startsWith('https://web.whatsapp.com/'))) return false;
      lookup(message).then(sendResponse);
      return true;
    }
    if (message.type === 'aspen-context:open') {
      openApp(String(message.path || '/'));
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})(globalThis);
