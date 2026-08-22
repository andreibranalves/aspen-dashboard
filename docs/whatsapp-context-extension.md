# Contexto comercial no WhatsApp Web

O Aspen não oferece uma Inbox de atendimento. A superfície operacional de conversas é o próprio WhatsApp Web; a extensão `extensions/whatsapp-context/` adiciona contexto comercial somente leitura.

A extensão monta o painel independentemente de identidade resolvida. Telefone confirmado consulta `/api/whatsapp-context`; `@lid`, grupos, falhas e matches ambíguos permanecem estados visíveis e não exibem histórico escolhido por heurística fraca.

Instalação interna, origem permitida e reload estão documentados no README da extensão. Configure `WHATSAPP_CONTEXT_EXTENSION_ORIGIN` com a origem exata `chrome-extension://<id>`. Nenhum token permanente, segredo, corpo de mensagem ou payload de provider entra no pacote.
