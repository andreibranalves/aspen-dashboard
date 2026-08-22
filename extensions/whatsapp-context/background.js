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

  async function lookup(phone) {
    const appOrigin = safeOrigin(config.appOrigin);
    if (!appOrigin || !PHONE_RE.test(phone)) return { status: 'unresolved', message: 'Telefone não confirmado.' };
    const endpoint = new URL(config.endpointPath || '/api/whatsapp-context', appOrigin);
    endpoint.searchParams.set('phone', phone);
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.json().catch(function () { return null; });
      if (!response.ok) return publicError(response.status);
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
    if (message.type === 'aspen-context:lookup') {
      lookup(String(message.phone || '')).then(sendResponse);
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
