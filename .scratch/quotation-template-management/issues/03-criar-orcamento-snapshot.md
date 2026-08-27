# 03 - Criar orçamento com modelo e snapshot

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

**What to build:** Na criação manual e automática, permitir escolher o modelo HTML e salvar na revisão a versão exata do modelo e uma cópia das seções padrão.

**Blocked by:** 01 - Biblioteca de modelos HTML versionados; 02 - Configuração das três seções comerciais.

**Status:** ready-for-agent

- [ ] O fluxo manual mostra o seletor de modelo HTML.
- [ ] O fluxo automático mostra o seletor de modelo HTML em cada orçamento extraído.
- [ ] O modelo padrão aparece pré-selecionado nos dois fluxos.
- [ ] Modelos arquivados não aparecem para novos orçamentos.
- [ ] A criação salva a versão imutável exata escolhida pelo usuário.
- [ ] A criação salva snapshot independente das seções globais atuais.
- [ ] O prazo de produção continua sendo armazenado como campo próprio da revisão.
- [ ] O preview usa a versão e o snapshot da revisão, nunca os padrões globais atuais.
- [ ] Textos das seções são escapados e preservam quebras de linha.
- [ ] Revisões já existentes recebem versão de modelo e snapshot compatíveis durante a migração.
- [ ] Migração é idempotente e aborta com erro claro quando um hash histórico não pode ser resolvido.
