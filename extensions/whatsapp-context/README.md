# Extensão Aspen — contexto comercial

Superfície contextual somente leitura. Não lê nem envia corpo de mensagens ao Aspen.

## Instalação interna

1. Configure `appOrigin` em `config.js`.
2. Confirme `WHATSAPP_CONTEXT_EXTENSION_ORIGIN` no Aspen com a origem `chrome-extension://<id>` gerada pelo Chrome.
3. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e use **Carregar sem compactação** nesta pasta.
4. Recarregue a extensão após alterar arquivos e faça login no Aspen.

`manifest.json` restringe o content script a `https://web.whatsapp.com/*`. O service worker usa a sessão autenticada do Aspen (`credentials: include`); não há API key ou segredo no pacote.

A identidade usa telefone visível como fast path e leitura IndexedDB limitada somente para resolver identidade. `@lid`, grupos, timeouts e mudanças de schema permanecem estados visíveis; não viram telefone.
