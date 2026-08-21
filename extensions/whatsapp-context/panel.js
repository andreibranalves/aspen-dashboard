(function (root) {
  /* global URL */
  'use strict';

  const PANEL_STYLE = `
    :host { all: initial; font-family: Arial, sans-serif; }
    * { box-sizing: border-box; }
    button, a { font: inherit; }
    .trigger { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 10px 14px; background: #1e3159; color: white; box-shadow: 0 6px 20px #0003; cursor: pointer; font-weight: 700; }
    .panel { position: fixed; top: 16px; right: 16px; z-index: 2147483645; display: none; width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; border: 1px solid #dfe5ef; border-radius: 14px; background: #fff; color: #202936; box-shadow: 0 14px 40px #0003; }
    .panel.open { display: block; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e8ecf2; padding: 14px 16px; }
    .title { margin: 0; font-size: 14px; font-weight: 700; }
    .close { border: 0; background: transparent; color: #687385; cursor: pointer; font-size: 20px; line-height: 1; }
    .content { padding: 16px; }
    .muted { color: #687385; font-size: 13px; line-height: 1.45; }
    .card { border: 1px solid #e8ecf2; border-radius: 10px; padding: 12px; }
    .name { margin: 0 0 4px; font-size: 16px; font-weight: 700; }
    .meta { margin: 3px 0; color: #687385; font-size: 12px; }
    .badge { display: inline-block; margin-top: 8px; border-radius: 999px; background: #eef2f8; color: #46536a; padding: 3px 8px; font-size: 11px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .action { display: inline-flex; align-items: center; border: 1px solid #cdd6e5; border-radius: 8px; padding: 8px 10px; color: #1e3159; background: #fff; text-decoration: none; cursor: pointer; font-size: 12px; font-weight: 700; }
    .primary { border-color: #1e3159; background: #1e3159; color: #fff; }
    .refresh { margin-top: 12px; border: 0; background: transparent; color: #1e3159; cursor: pointer; font-size: 12px; font-weight: 700; }
  `;

  function text(rootNode, tag, value, className) {
    const element = rootNode.ownerDocument.createElement(tag);
    if (className) element.className = className;
    element.textContent = value || '';
    return element;
  }

  function safeHref(path) {
    if (typeof path !== 'string' || !path.startsWith('/#/')) return '';
    try {
      return new URL(path, root.AspenExtensionConfig.origin).toString();
    } catch {
      return '';
    }
  }

  function mount(host, callbacks) {
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${PANEL_STYLE}</style><button class="trigger" type="button">Aspen</button><aside class="panel" aria-label="Contexto comercial Aspen"><div class="header"><h2 class="title">Contexto comercial</h2><button class="close" type="button" aria-label="Fechar">×</button></div><div class="content"></div></aside>`;
    const trigger = shadow.querySelector('.trigger');
    const close = shadow.querySelector('.close');
    const panel = shadow.querySelector('.panel');
    const content = shadow.querySelector('.content');
    let open = false;

    function setOpen(next) {
      open = next;
      panel.classList.toggle('open', open);
      trigger.textContent = open ? 'Fechar Aspen' : 'Aspen';
      if (open && callbacks.onOpen) callbacks.onOpen();
    }

    trigger.addEventListener('click', () => setOpen(!open));
    close.addEventListener('click', () => setOpen(false));

    function clear() {
      while (content.firstChild) content.removeChild(content.firstChild);
    }

    function renderSnapshot(snapshot) {
      clear();
      if (!snapshot || snapshot.status !== 'ready') {
        content.appendChild(text(content, 'p', 'Abra uma conversa individual com telefone visível.', 'muted'));
        return;
      }
      content.appendChild(text(content, 'p', snapshot.displayName || 'Contato identificado', 'name'));
      content.appendChild(text(content, 'p', snapshot.phone, 'meta'));
      content.appendChild(text(content, 'p', 'Clique em atualizar para consultar o Aspen.', 'muted'));
      const refresh = text(content, 'button', 'Consultar agora', 'action primary');
      refresh.type = 'button';
      refresh.addEventListener('click', () => callbacks.onOpen && callbacks.onOpen());
      content.appendChild(refresh);
    }

    function renderLoading(snapshot) {
      clear();
      if (snapshot?.displayName) content.appendChild(text(content, 'p', snapshot.displayName, 'name'));
      if (snapshot?.phone) content.appendChild(text(content, 'p', snapshot.phone, 'meta'));
      content.appendChild(text(content, 'p', 'Consultando o Aspen…', 'muted'));
    }

    function renderResult(data, snapshot) {
      clear();
      if (snapshot?.displayName) content.appendChild(text(content, 'p', snapshot.displayName, 'name'));
      if (snapshot?.phone) content.appendChild(text(content, 'p', snapshot.phone, 'meta'));

      if (data?.match === 'matched' && data.contact) {
        const card = content.ownerDocument.createElement('div');
        card.className = 'card';
        card.appendChild(text(card, 'p', data.contact.nome || 'Cadastro encontrado', 'name'));
        card.appendChild(text(card, 'p', data.contact.tipo === 'lead' ? 'Lead' : 'Cliente', 'meta'));
        if (data.contact.telefone) card.appendChild(text(card, 'p', data.contact.telefone, 'meta'));
        if (data.contact.email) card.appendChild(text(card, 'p', data.contact.email, 'meta'));
        card.appendChild(text(card, 'span', 'Match por telefone', 'badge'));
        content.appendChild(card);
        const actions = content.ownerDocument.createElement('div');
        actions.className = 'actions';
        if (data.contact.telefone) {
          const copy = text(actions, 'button', 'Copiar telefone', 'action');
          copy.type = 'button';
          copy.addEventListener('click', async () => {
            try {
              await root.navigator.clipboard.writeText(data.contact.telefone);
              copy.textContent = 'Telefone copiado';
            } catch {
              copy.textContent = `Copie: ${data.contact.telefone}`;
            }
          });
          actions.appendChild(copy);
        }
        const href = safeHref(data.actions?.openContact);
        if (href) {
          const link = text(actions, 'a', 'Abrir cadastro', 'action primary');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          actions.appendChild(link);
        }
        content.appendChild(actions);
      } else if (data?.match === 'not_found') {
        content.appendChild(text(content, 'p', 'Nenhum cadastro encontrado para este telefone.', 'muted'));
        const href = safeHref(data.actions?.openNewContact);
        if (href) {
          const link = text(content, 'a', 'Criar cadastro no Aspen', 'action primary');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          content.appendChild(link);
        }
      } else if (data?.match === 'ambiguous') {
        content.appendChild(text(content, 'p', 'Mais de um cadastro usa este telefone. Escolha o correto no Aspen.', 'muted'));
      } else if (data?.match === 'unresolved') {
        content.appendChild(text(content, 'p', 'Não foi possível confirmar o telefone desta conversa.', 'muted'));
      } else {
        content.appendChild(text(content, 'p', 'Esta visualização do WhatsApp não é compatível.', 'muted'));
      }

      const refresh = text(content, 'button', 'Atualizar', 'refresh');
      refresh.type = 'button';
      refresh.addEventListener('click', () => callbacks.onOpen && callbacks.onOpen());
      content.appendChild(refresh);
    }

    function renderError(message, snapshot) {
      clear();
      if (snapshot?.displayName) content.appendChild(text(content, 'p', snapshot.displayName, 'name'));
      content.appendChild(text(content, 'p', message || 'Não foi possível consultar o Aspen.', 'muted'));
      const retry = text(content, 'button', 'Tentar novamente', 'action primary');
      retry.type = 'button';
      retry.addEventListener('click', () => callbacks.onOpen && callbacks.onOpen());
      content.appendChild(retry);
    }

    return {
      isOpen: () => open,
      renderSnapshot,
      renderLoading,
      renderResult,
      renderError,
    };
  }

  root.AspenWhatsAppPanel = Object.freeze({ mount });
})(globalThis);
