# 02 - Configuração das três seções comerciais

**What to build:** Em Configurações, permitir editar os padrões globais de prazo de produção, dados para pagamento e condições gerais.

**Blocked by:** 01 - Biblioteca de modelos HTML versionados.

**Status:** ready-for-agent

- [ ] Configurações mostra exatamente três seções fixas: prazo de produção, pagamento e condições gerais.
- [ ] Cada seção permite ativar ou desativar sua exibição.
- [ ] Cada seção permite editar o título.
- [ ] Pagamento e condições gerais permitem editar o corpo em texto simples.
- [ ] Prazo de produção usa o valor semântico do orçamento e não duplica um corpo global.
- [ ] Quebras de linha dos corpos são preservadas por placeholder seguro, sem permitir HTML do usuário.
- [ ] Valores legados de prazo de entrega e observações são combinados em condições gerais sem perda de conteúdo.
- [ ] A API valida tipos, títulos vazios e limites de tamanho com mensagens em português.
- [ ] Alterar os padrões não modifica revisões existentes.
- [ ] A tela mantém estados de carregamento, erro, retry e confirmação de salvamento.
