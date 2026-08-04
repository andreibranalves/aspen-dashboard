# 04 - Personalizar conteúdo no rascunho

**What to build:** Na página individual de um orçamento em rascunho, permitir trocar o modelo e personalizar as três seções comerciais antes do envio.

**Blocked by:** 03 - Criar orçamento com modelo e snapshot.

**Status:** ready-for-agent

- [ ] As três seções ficam sempre visíveis no editor do rascunho.
- [ ] Cada seção mostra indicador `Padrão` ou `Personalizado`.
- [ ] Usuário consegue editar título, corpo e ativação das seções aplicáveis.
- [ ] Prazo de produção permanece um campo separado e editável.
- [ ] A ação `Restaurar padrão` copia o valor base capturado na criação da revisão.
- [ ] Restaurar padrão não consulta nem aplica os padrões globais atuais.
- [ ] Usuário consegue trocar o modelo HTML enquanto o orçamento está em rascunho.
- [ ] Trocar o modelo não cria uma nova revisão.
- [ ] Salvamento envia snapshot completo, modelo escolhido e token de concorrência.
- [ ] Backend rejeita edição quando orçamento ou revisão não estão em rascunho.
- [ ] Preview do rascunho usa a versão e o conteúdo atuais após salvar.
- [ ] Conflitos de concorrência mantêm o comportamento atual e exibem mensagem em português.
