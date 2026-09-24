# Identificação de clientes no drawer WhatsApp

O backend distingue telefone, identificador da conversa e vínculo confirmado pelo operador. Os telefones originais do cadastro são preservados. `libphonenumber-js/max` interpreta números nacionais como BR e preserva o país explícito. A variação do nono dígito serve somente para localizar uma correspondência única no contexto comercial; nunca altera destinatários de envio nem autoriza consolidação de cadastros.

Uma correspondência única mostra o contexto automaticamente quando o telefone vem do JID ou do modelo da conversa ativa. Isso inclui a variação reversível do nono dígito para celulares brasileiros. Telefone presente apenas no título, LID sem telefone e ambiguidades exigem escolha explícita. O drawer permite corrigir a correspondência, pesquisar clientes ativos por nome/telefone, confirmar e desfazer vínculos.

`whatsapp_client_links` guarda conta conectada, JID da conversa, cliente, telefone observado, telefone do cadastro, origem operator, datas e versão. A chave composta separa contas. Alterações usam compare-and-swap; nome e telefone apresentados na confirmação são comparados sob lock com o cadastro atual. Mudança posterior de telefone pede revisão. Exclusão do cliente remove o vínculo por FK; orçamentos não são afetados.

A extensão lê a conversa ativa e a conta conectada no modelo do WhatsApp Web. Para conversas LID, usa apenas o mapeamento exato fornecido pelo próprio modelo. O bridge não lê mensagens nem faz chamadas de rede. Estes são detalhes internos, sem contrato público estável: se não estiverem disponíveis, o vínculo fica indisponível, com ações para tentar novamente e pesquisar no Aspen, sem varrer registros arbitrários ou converter LID em telefone. PN e LID distintos não são unidos automaticamente. A integração Evolution e os destinatários de mensagens não são alterados.

## Testes

Extensão atual: 0.2.3 (`extensions/whatsapp-context/`). Cobertura: testes focados da API, parser e extração; invariantes PostgreSQL com a DDL da migration em tabelas temporárias; Chromium com DOM e dados fictícios para sugestão, confirmação e desvinculação. O teste em Chromium não comprova compatibilidade com toda versão futura do DOM do WhatsApp.
