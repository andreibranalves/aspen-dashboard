(function () {
  /* global chrome, document, window */
  'use strict';

  if (globalThis.__aspenWhatsAppContextLoaded) return;
  globalThis.__aspenWhatsAppContextLoaded = true;

  const host = document.createElement('div');
  host.id = 'aspen-whatsapp-context-extension';
  document.documentElement.appendChild(host);

  let snapshot = globalThis.AspenWhatsAppContactAdapter.readActiveContact(document);
  let lastKey = `${snapshot.status}:${snapshot.phone || ''}:${snapshot.displayName || ''}`;
  let requestVersion = 0;

  const panel = globalThis.AspenWhatsAppPanel.mount(host, {
    onOpen: () => lookup(),
  });

  function currentSnapshot() {
    snapshot = globalThis.AspenWhatsAppContactAdapter.readActiveContact(document);
    return snapshot;
  }

  function lookup() {
    const current = currentSnapshot();
    panel.renderLoading(current);
    if (current.status !== 'ready') {
      panel.renderSnapshot(current);
      return;
    }

    const version = ++requestVersion;
    chrome.runtime.sendMessage(
      {
        type: 'lookupContext',
        phone: current.phone,
        name: current.displayName || '',
      },
      (response) => {
        if (version !== requestVersion) return;
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
    if (panel.isOpen()) lookup();
  }

  panel.renderSnapshot(snapshot);
  window.setInterval(refreshSnapshot, 1200);
})();
