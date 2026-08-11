# Visualização HTML do rascunho de orçamento automático

## Objetivo

Permitir visualizar o orçamento extraído na página Auto antes de criá-lo.
A visualização deve abrir em uma nova aba, usar o mesmo template HTML da visualização atual e não persistir orçamento, cliente ou revisão.

## Interface

O `SplitResultCard` exibirá o botão `Visualizar` ao lado de `Criar orçamento` enquanto o draft ainda não foi criado.
O botão ficará desabilitado quando não houver nome de cliente ou item válido, seguindo as mesmas condições de criação.
Ao clicar, a aplicação abrirá imediatamente uma nova aba para evitar bloqueio de pop-up.
A aba mostrará um estado de carregamento até receber o HTML.

## Fluxo de dados

A `AutoQuotePage` montará o payload a partir do estado editado do draft, usando os mesmos campos enviados para `/api/orcamento`.
O frontend enviará esse payload por `POST` ao endpoint de visualização.
O backend validará o payload, resolverá o template selecionado e converterá o draft para o modelo usado pelo renderizador atual.
O backend chamará `renderQuotationTemplate` e responderá com `text/html` e os mesmos cabeçalhos de segurança da visualização existente.
A operação não executará qualquer escrita em banco ou ERPNext.

## Alterações

- `SplitResultCard` receberá uma ação de preview e exibirá o botão.
- `AutoQuotePage` abrirá a aba e solicitará o HTML do draft atual.
- `quotation-preview` aceitará `POST` para drafts sem ID, preservando o `GET` existente para orçamentos salvos.
- O payload e o modelo de visualização serão compartilhados apenas onde isso eliminar duplicação real com a criação do orçamento.

## Erros e segurança

Payload inválido retornará erro estruturado em português.
Falhas de template ou renderização não exporão stack traces nem respostas internas.
A aba aberta exibirá uma mensagem de falha em português caso a requisição não possa ser concluída.
Templates continuarão sem scripts e sujeitos à validação existente.

## Testes

Um teste de API verificará que um draft válido retorna HTML usando o template selecionado sem chamar persistência.
Casos inválidos cobrirão ausência de cliente e ausência de itens válidos.
Um teste do componente verificará estado habilitado, estado desabilitado e disparo da ação de visualização.
