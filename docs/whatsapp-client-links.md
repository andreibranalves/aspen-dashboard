# Identificação de clientes no drawer WhatsApp

O backend distingue telefone, identificador da conversa e vínculo confirmado pelo operador. Os telefones originais do cadastro são preservados. `libphonenumber-js/max` interpreta números nacionais como BR e preserva o país explícito. A variação do nono dígito existe somente para sugerir celulares brasileiros; nunca altera destinatários de envio nem autoriza consolidação de cadastros.

Uma correspondência exata com o telefone do JID pode mostrar contexto. Telefone presente apenas no título, LID sem telefone, ambiguidade ou diferença no nono dígito exigem escolha explícita. O drawer permite pesquisar clientes ativos por nome/telefone, confirmar e desfazer o vínculo.

`whatsapp_client_links` guarda conta conectada, JID da conversa, cliente, telefone observado, telefone do cadastro, origem operator, datas e versão. A chave composta separa contas. Alterações usam compare-and-swap; nome e telefone apresentados na confirmação são comparados sob lock com o cadastro atual. Mudança posterior de telefone pede revisão. Exclusão do cliente remove o vínculo por FK; orçamentos não são afetados.

A extensão lê o JID somente de atributos da conversa aberta e a conta do `last-wid-md` do WhatsApp Web. Estes são detalhes internos, sem contrato público estável: se não estiverem disponíveis, o vínculo fica indisponível, sem varrer registros arbitrários ou converter LID em telefone. PN e LID distintos não são unidos automaticamente. A integração Evolution e os destinatários de mensagens não são alterados.

## Implantação

Aplicar a migration aditiva `0034_whatsapp_client_links` pelo fluxo operacional autorizado antes de disponibilizar a extensão 0.2.0. Não há backfill, alteração de telefones nem limpeza automática. Atualizar/recarregar a extensão e a página do WhatsApp após o deploy. A migration de produção não faz parte dos testes temporários.

Validação: testes focados da API, parser e extração; invariantes PostgreSQL com a DDL da migration em tabelas temporárias; Chromium com DOM e dados fictícios para sugestão, confirmação e desvinculação. O teste em Chromium não comprova compatibilidade com toda versão futura do DOM do WhatsApp.
