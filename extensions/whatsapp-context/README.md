# Extensão Aspen — contexto comercial

Contexto comercial resolvido automaticamente por telefone, com correção manual quando necessária. Não lê nem envia corpo de mensagens ao Aspen.

A superfície de conversa do Aspen é a tela de Atendimento (`#/atendimento`), conforme a decisão D1 de `docs/atendimento-comercial-assistido.md`. A extensão continua funcionando e adiciona contexto comercial somente leitura no WhatsApp Web; aposentá-la é decisão posterior.

A extensão monta o painel independentemente de identidade resolvida. Telefone confirmado consulta `/api/whatsapp-context`; `@lid`, grupos, falhas e matches ambíguos permanecem estados visíveis e não exibem histórico escolhido por heurística fraca. Nenhum token permanente, segredo, corpo de mensagem ou payload de provider entra no pacote.

## Instalação interna

1. Configure `appOrigin` em `config.js`.
2. Confirme `WHATSAPP_CONTEXT_EXTENSION_ORIGIN` no Aspen com a origem `chrome-extension://<id>` gerada pelo Chrome.
3. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e use **Carregar sem compactação** nesta pasta.
4. Recarregue a extensão após alterar arquivos e faça login no Aspen.

`manifest.json` restringe o content script a `https://web.whatsapp.com/*`. O service worker usa a sessão autenticada do Aspen (`credentials: include`); não há API key ou segredo no pacote.

A versão 0.2.3 usa o modelo da conversa ativa do WhatsApp para obter a conta conectada, o identificador da conversa e o mapeamento exato de LID para telefone. O bridge `identity.js` roda no contexto da página e responde somente ao content script local; não lê mensagens nem faz chamadas de rede. Uma única correspondência por telefone confirmado, inclusive pela variação reversível do nono dígito brasileiro, abre o contexto automaticamente. Números presentes apenas no título e ambiguidades exigem escolha. O drawer usa uma abertura lateral suave e os orçamentos abrem pela rota UUID no Aspen. LID nunca é convertido em telefone. As regras de vínculo estão em `docs/whatsapp-client-links.md`.
