# Extensão Aspen — contexto comercial

Contexto comercial resolvido automaticamente por telefone, com correção manual quando necessária. Não lê nem envia corpo de mensagens ao Aspen.

## Instalação interna

1. Configure `appOrigin` em `config.js`.
2. Confirme `WHATSAPP_CONTEXT_EXTENSION_ORIGIN` no Aspen com a origem `chrome-extension://<id>` gerada pelo Chrome.
3. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e use **Carregar sem compactação** nesta pasta.
4. Recarregue a extensão após alterar arquivos e faça login no Aspen.

`manifest.json` restringe o content script a `https://web.whatsapp.com/*`. O service worker usa a sessão autenticada do Aspen (`credentials: include`); não há API key ou segredo no pacote.

A versão 0.2.3 usa o modelo da conversa ativa do WhatsApp para obter a conta conectada, o identificador da conversa e o mapeamento exato de LID para telefone. O bridge `identity.js` roda no contexto da página e responde somente ao content script local; não lê mensagens nem faz chamadas de rede. Uma única correspondência por telefone confirmado, inclusive pela variação reversível do nono dígito brasileiro, abre o contexto automaticamente. Números presentes apenas no título e ambiguidades exigem escolha. O drawer usa uma abertura lateral suave e os orçamentos abrem pela rota UUID no Aspen. LID nunca é convertido em telefone. Requer a migration 0034 e o backend correspondente antes de recarregar a extensão. Veja docs/whatsapp-client-links.md no repositório.
