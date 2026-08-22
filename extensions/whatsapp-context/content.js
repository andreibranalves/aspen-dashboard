/* global chrome, document, navigator, MutationObserver, clearTimeout, setTimeout */
(function installAspenWhatsappPanel(global) {
  'use strict';

  const HOST_ID = 'aspen-whatsapp-context-extension';
  const provider = global.AspenWhatsappProvider;
  const state = {
    open: true,
    conversation: { status: 'idle' },
    context: null,
    loading: false,
    error: '',
    generation: 0,
  };
  let host;
  let root;
  let lastFingerprint = '';
  let observer;
  let syncTimer;
  let syncSequence = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function messageForStatus(status) {
    return {
      idle: ['Aspen pronto', 'Abra uma conversa para consultar o contexto comercial.'],
      resolving: ['Identificando conversa', 'Lendo apenas a identidade disponível no WhatsApp Web…'],
      ready: ['Contato identificado', 'Consultando o contexto comercial Aspen…'],
      unresolved: ['Contato não resolvido', 'Telefone confirmado não encontrado. O painel continua disponível.'],
      unsupported: ['Conversa não suportada', 'Grupos e comunidades não possuem contexto comercial automático.'],
      login_required: ['Faça login no Aspen', state.error || 'Abra o Aspen, faça login e tente novamente.'],
      error: ['Aspen indisponível', state.error || 'Tente novamente.'],
    }[status] || ['Aspen', ''];
  }

  function send(message, callback) {
    try { chrome.runtime.sendMessage(message, callback); } catch { callback({ status: 'error', message: 'Extensão indisponível.' }); }
  }

  function openApp(path) { send({ type: 'aspen-context:open', path }); }

  function renderContext(context) {
    if (!context || context.match === 'not_found') {
      const name = state.conversation.displayName || 'este contato';
      const link = context && context.actions && context.actions.createContact;
      return `<section class="aspen-card"><strong>Nenhum cadastro encontrado</strong><p>Não há contato confirmado para ${escapeHtml(name)}.</p>${link ? `<button data-action="open" data-path="${escapeHtml(link)}">Criar cadastro</button>` : ''}</section>`;
    }
    if (context.match === 'ambiguous') return '<section class="aspen-card"><strong>Match ambíguo</strong><p>Mais de um cadastro usa este telefone. Nenhum histórico foi exibido.</p></section>';
    if (context.match !== 'matched' || !context.contact) return '<section class="aspen-card"><strong>Sem histórico</strong><p>Nenhum orçamento ainda.</p></section>';
    const contact = context.contact;
    const latest = context.latestQuotation;
    const previous = Array.isArray(context.quotations) ? context.quotations : [];
    const deliveries = Array.isArray(context.deliveries) ? context.deliveries : [];
    const quotation = (item, prominent) => `<a class="aspen-quote ${prominent ? 'aspen-quote-latest' : ''}" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer"><span><strong>${escapeHtml(item.businessNumber)}</strong><small>${escapeHtml(item.status || '')} · ${escapeHtml(item.date || '')}</small></span><span>${escapeHtml(item.total || '')}</span></a>`;
    return `<section class="aspen-card"><div class="aspen-contact"><strong>${escapeHtml(contact.nome)}</strong><span>${escapeHtml(contact.tipo)} · ${escapeHtml(contact.telefone || '')}</span>${contact.email ? `<span>${escapeHtml(contact.email)}</span>` : ''}<div><button data-action="open" data-path="${escapeHtml(context.actions && context.actions.openContact || '#')}">Abrir cadastro</button><button data-action="copy" data-value="${escapeHtml(contact.telefone || '')}">Copiar telefone</button></div></div>${latest ? `<h3>Último orçamento</h3>${quotation(latest, true)}` : '<div class="aspen-empty">Nenhum orçamento ainda.</div>'}${previous.length > 0 ? `<h3>Histórico</h3><div class="aspen-list">${previous.filter(item => !latest || item.id !== latest.id).map(item => quotation(item, false)).join('')}</div>` : ''}${deliveries.length > 0 ? `<h3>Entregas</h3><div class="aspen-list">${deliveries.map(item => `<div class="aspen-delivery"><span>${escapeHtml(item.businessNumber || '')}</span><span>${escapeHtml(item.status || 'sem entrega registrada')}</span></div>`).join('')}</div>` : ''}</section>`;
  }

  function render() {
    if (!root) return;
    const conversation = state.conversation || { status: 'idle' };
    const status = conversation.status || 'idle';
    const [title, description] = messageForStatus(status);
    const visible = state.open ? 'aspen-open' : 'aspen-closed';
    root.innerHTML = `<aside class="aspen-panel ${visible}" aria-label="Contexto comercial Aspen"><header><div><strong>Aspen</strong><small>Contexto comercial</small></div><button data-action="toggle" aria-label="${state.open ? 'Fechar' : 'Abrir'} painel">${state.open ? '×' : '‹'}</button></header>${state.open ? `<main>${conversation.status === 'ready' && state.loading ? '<div class="aspen-state"><strong>Consultando Aspen</strong><span>Carregando contexto comercial…</span></div>' : conversation.status === 'ready' && state.context ? renderContext(state.context) : `<div class="aspen-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span>${conversation.displayName ? `<small>${escapeHtml(conversation.displayName)}</small>` : ''}${conversation.status === 'unresolved' ? '<button data-action="retry">Tentar novamente</button><button data-action="search">Pesquisar no Aspen</button>' : conversation.status === 'login_required' ? '<button data-action="open" data-path="/">Abrir Aspen</button><button data-action="retry">Tentar novamente</button>' : conversation.status === 'error' ? '<button data-action="retry">Tentar novamente</button>' : ''}</div>`}</main>` : ''}</aside>`;
  }

  function mount() {
    if (document.getElementById(HOST_ID)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    root = host;
    render();
    root.addEventListener('click', function (event) {
      const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (action === 'toggle') { state.open = !state.open; render(); return; }
      if (action === 'retry') { sync(true); return; }
      if (action === 'search') { openApp(`/#/leads?search=${encodeURIComponent(state.conversation.displayName || '')}`); return; }
      if (action === 'open') { const path = target.getAttribute('data-path'); if (path && path !== '#') openApp(path); return; }
      if (action === 'copy') { navigator.clipboard && navigator.clipboard.writeText(target.getAttribute('data-value') || ''); return; }
    });
    observer = new MutationObserver(function () { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 250); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label', 'data-id', 'title'] });
    sync();
  }

  function lookupContext(conversation, generation) {
    state.loading = true; state.error = ''; render();
    send({ type: 'aspen-context:lookup', phone: conversation.phone }, function (result) {
      if (generation !== state.generation) return;
      state.loading = false;
      if (!result || result.status === 'error' || result.status === 'login_required') {
        state.error = result && result.message || 'Aspen indisponível.';
        state.conversation = { ...conversation, status: result && result.status === 'login_required' ? 'login_required' : 'error' };
      } else {
        state.context = result;
      }
      render();
    });
  }

  async function sync(force) {
    if (!provider) { state.conversation = { status: 'unsupported' }; render(); return; }
    const sequence = ++syncSequence;
    const previousConversation = state.conversation;
    state.conversation = { status: 'resolving', displayName: state.conversation.displayName || null };
    render();
    let conversation;
    try { conversation = await provider.resolveConversation({ force: Boolean(force) }); } catch { conversation = { status: 'error' }; }
    if (sequence !== syncSequence) return;
    const fingerprint = JSON.stringify([conversation.status, conversation.phone, conversation.technicalId, conversation.displayName]);
    if (!force && fingerprint === lastFingerprint) {
      state.conversation = state.loading || state.context ? conversation : previousConversation;
      render();
      return;
    }
    const generation = ++state.generation;
    lastFingerprint = fingerprint;
    state.conversation = conversation;
    state.context = null;
    state.loading = false;
    state.error = '';
    render();
    if (conversation.status === 'ready' && conversation.phone) lookupContext(conversation, generation);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})(globalThis);
