# Contexto comercial no WhatsApp Web

A superfície de conversa do Aspen é a tela de Atendimento (`#/atendimento`), conforme a decisão D1 de [`atendimento-comercial-assistido.md`](./atendimento-comercial-assistido.md). A extensão `extensions/whatsapp-context/` continua funcionando sem mudança e adiciona contexto comercial somente leitura no WhatsApp Web; aposentá-la é decisão posterior.

A extensão monta o painel independentemente de identidade resolvida. Telefone confirmado consulta `/api/whatsapp-context`; `@lid`, grupos, falhas e matches ambíguos permanecem estados visíveis e não exibem histórico escolhido por heurística fraca.

Instalação interna, origem permitida e reload estão documentados no README da extensão. Configure `WHATSAPP_CONTEXT_EXTENSION_ORIGIN` com a origem exata `chrome-extension://<id>`. Nenhum token permanente, segredo, corpo de mensagem ou payload de provider entra no pacote.
