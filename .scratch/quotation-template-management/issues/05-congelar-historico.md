# 05 - Congelar revisão enviada e reproduzir histórico

**What to build:** Ao enviar uma revisão, congelar template e conteúdo e garantir que o histórico continue renderizando exatamente a revisão original.

**Blocked by:** 04 - Personalizar conteúdo no rascunho.

**Status:** ready-for-agent

- [ ] Enviado, aprovado e perdido não permitem editar modelo, seções ou conteúdo comercial.
- [ ] Emissão continua sendo apenas transição de status, sem gerar PDF persistido.
- [ ] Histórico mostra modelo e versão utilizados pela revisão.
- [ ] Preview histórico usa o identificador da revisão exata.
- [ ] Alterações futuras em Configurações não mudam previews históricos.
- [ ] Nova revisão copia template, versão e snapshot da revisão de origem.
- [ ] Preview HTML continua sendo gerado sob demanda e sem armazenamento em Blob.
- [ ] Preview PDF sob demanda continua funcionando sem depender de emissão ou armazenamento.
- [ ] Testes verificam congelamento, reprodução histórica e ausência de regressão no fluxo de envio.
