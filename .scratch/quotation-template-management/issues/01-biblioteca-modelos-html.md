# 01 - Biblioteca de modelos HTML versionados

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

**What to build:** Em Configurações, permitir gerenciar modelos HTML completos colados manualmente, com validação, preview, versionamento e arquivamento.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] Os modelos atuais Padrão Aspen, Minimalista e Aspen Original aparecem na biblioteca após a migração.
- [ ] Usuário consegue criar modelo informando chave, nome e documento HTML completo.
- [ ] HTML válido pode conter CSS, tabelas, links, imagens e os placeholders existentes do orçamento.
- [ ] JavaScript, `script`, eventos inline, URLs perigosas, iframes e saídas Handlebars sem escape são rejeitados.
- [ ] Validação retorna erros em português e preview determinístico com dados fictícios.
- [ ] Modelo só fica disponível para novos orçamentos após validação e preview bem-sucedidos.
- [ ] Editar um modelo usado cria nova versão imutável sem alterar revisões antigas.
- [ ] Versões repetidas pelo mesmo hash não são duplicadas.
- [ ] Modelos arquivados desaparecem de novos seletores, mas continuam renderizáveis no histórico.
- [ ] Não é possível arquivar o modelo padrão sem definir outro modelo padrão.
- [ ] A inicialização de modelos e versões pode ser repetida sem duplicar dados.
