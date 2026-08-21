(function () {
  /* global chrome, document, window */
  'use strict';

  if (globalThis.__aspenWhatsAppContextLoaded) return;
  globalThis.__aspenWhatsAppContextLoaded = true;

  let host = null;
  let panel = null;
  let snapshot = globalThis.AspenWhatsAppContactAdapter.readActiveContact(document);
  let lastKey = `${snapshot.status}:${snapshot.phone || ''}:${snapshot.displayName || ''}`;
  let requestVersion = 0;

  function currentSnapshot() {
    snapshot = globalThis.AspenWhatsAppContactAdapter.readActiveContact(document);
    return snapshot;
  }

  function removePanel() {
    requestVersion += 1;
    if (host) host.remove();
    host = null;
    panel = null;
  }

  function ensurePanel() {
    if (panel || snapshot.status !== 'ready') return;
    host = document.createElement('div');
    host.id = 'aspen-whatsapp-context-extension';
    document.documentElement.appendChild(host);
    panel = globalThis.AspenWhatsAppPanel.mount(host, {
      onOpen: () => lookup(),
    });
    panel.renderSnapshot(snapshot);
  }

  function lookup() {
    const current = currentSnapshot();
    if (current.status !== 'ready') {
      removePanel();
      return;
    }
    ensurePanel();
    if (!panel) return;
    panel.renderLoading(current);

    const version = ++requestVersion;
    chrome.runtime.sendMessage(
      {
        type: 'lookupContext',
        phone: current.phone,
        name: current.displayName || '',
      },
      (response) => {
        if (version !== requestVersion || !panel) return;
        if (chrome.runtime.lastError) {
          panel.renderError('Não foi possível consultar o Aspen.', current);
          return;
        }
        if (!response || response.ok !== true) {
          panel.renderError(response?.error || 'Não foi possível consultar o Aspen.', current);
          return;
        }
        panel.renderResult(response.data, current);
      }
    );
  }

  function refreshSnapshot() {
    const next = currentSnapshot();
    const key = `${next.status}:${next.phone || ''}:${next.displayName || ''}`;
    if (key === lastKey) return;
    lastKey = key;
    snapshot = next;
    if (next.status === 'ready') {
      ensurePanel();
      if (panel?.isOpen()) lookup();
    } else {
      removePanel();
    }
  }

  ensurePanel();
  window.setInterval(refreshSnapshot, 1200);
})();
