# Descrição por item de orçamento - design

## Objetivo

Permitir editar o texto exibido de cada produto em um orçamento sem alterar o cadastro do produto.

Exemplo: o SKU permanece `LENCO-90X90`, mas o orçamento mostra `Lenço 100 x 100 cm`.

A descrição personalizada deve persistir ao salvar, reabrir, visualizar e gerar o documento do orçamento.

## Decisão

Usar o campo já existente `item_name` da linha do orçamento como descrição específica daquele orçamento.

O catálogo continua sendo a fonte do SKU, do nome padrão e da precificação inicial.

Editar `item_name` não cria nem atualiza produtos no catálogo.

Quantidade, preço unitário e SKU continuam com o comportamento atual.

Não haverá nova coluna na tabela.

## Experiência de uso

A coluna atual `Produto` permanece única.

Ela contém o seletor de SKU e, abaixo dele, um campo de texto com o rótulo acessível `Nome exibido no orçamento`.

O campo inicia preenchido com o nome padrão do produto escolhido.

O usuário pode sobrescrevê-lo livremente para aquele orçamento.

No documento, o valor personalizado substitui o nome padrão exibido para a linha.

Trocar o SKU continua preenchendo o nome padrão do produto selecionado.

A edição da descrição não recalcula nem altera o preço.

## Fluxo de dados

No draft de `/auto`, `DraftItem.item_name` já acompanha os itens.

A tabela de itens passará a editá-lo diretamente, sem chamar busca de produto ou recálculo de preço.

Ao criar o orçamento, o fluxo incluirá `item_name` no payload de itens.

Na edição de orçamento salvo, o editor enviará o mesmo `item_name` no `PUT /api/quotations`.

Os fluxos core e legacy persistirão `item_name` na linha do orçamento, sem escrever no cadastro de Item.

Preview e documento reutilizam os itens persistidos, logo exibem a descrição salva.

## Escopo técnico

Alterar somente os editores de item necessários para expor o campo já persistido.

Reutilizar o estado e a API atuais.

Não criar tabela, coluna de banco, endpoint, produto duplicado ou regra de preço adicional.

Manter a interface existente em qualquer editor legado e no editor core de orçamento salvo.

## Erros e limites

SKU, quantidade e preço continuam seguindo as validações atuais.

Uma descrição vazia mantém o comportamento de fallback atual da visualização.

Falhas ao salvar continuam usando a mensagem estruturada já existente.

## Verificação

Adicionar cobertura para editar a descrição no draft `/auto` e para salvar a descrição em orçamento existente.

Confirmar que o payload preserva SKU, quantidade e preço enquanto altera somente `item_name`.

Executar os testes focados, lint e build antes da conclusão.
