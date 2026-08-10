# Template comparativo de orçamento

## Status

Design aprovado em 2026-08-10.

A implementação aguarda a revisão deste documento pelo usuário.

## Objetivo

Adicionar `template-comparison.html` como modelo selecionável de orçamento no CRM.

O modelo deve funcionar no preview, no PDF administrativo e no link público já existentes.

O modelo não deve substituir o padrão atual nem alterar revisões históricas.

## Contexto atual

O CRM possui uma biblioteca versionada de templates de orçamento.

O runtime renderiza HTML com Handlebars em sandbox e permite somente os helpers `if` e `each`.

O arquivo recebido usa sintaxe Jinja/Frappe, acessa `frappe.db` e calcula a matriz dentro do próprio template.

A sintaxe e os acessos do arquivo não podem ser executados diretamente pelo CRM.

O catálogo built-in é propagado para o banco pelo `templateSeedPlan` e pela migração existente.

## Decisões

### Registro do modelo

O novo modelo terá a chave `comparativo` e ficará disponível para seleção na biblioteca existente.

O seed automático criará o modelo em ambientes novos e adicionará uma versão quando a fonte mudar.

O modelo não será definido como padrão.

A fonte original `template-comparison.html` permanecerá intacta como referência durante a conversão.

A fonte segura usada em produção será registrada no catálogo nativo existente.

### Dados da matriz

A matriz usará somente as linhas da revisão imutável do orçamento.

O backend não consultará preços atuais para renderizar uma revisão já salva.

As faixas suportadas serão `30`, `100`, `300`, `500` e `1000`.

Os rótulos serão `30 - 99`, `100 - 299`, `300 - 499`, `500 - 999` e `1000+`.

Uma faixa será incluída somente quando alguma linha do orçamento representar essa faixa.

A faixa usará `preco_minimo_faixa` quando o valor estiver entre as faixas suportadas.

Quando esse campo não existir ou não for válido, a faixa será derivada da quantidade da linha.

Linhas com quantidade abaixo de `100` representarão a faixa `30`.

Linhas repetidas para o mesmo produto e faixa usarão a última linha salva, mantendo o comportamento do arquivo original.

Produtos serão agrupados por código ou nome e descrição.

A ordem dos produtos será a ordem da primeira ocorrência na revisão.

Células sem preço representarão `-`.

O preço de cada célula usará o valor salvo na linha e a formatação monetária já fornecida pelo view model.

### Conversão do template

A estrutura visual do arquivo será preservada, incluindo CSS, SVG inline, cabeçalho, rodapé fixo, duas páginas e quebra de página.

Campos Frappe serão convertidos para o view model do CRM.

A tabela Jinja será convertida para loops Handlebars sobre uma estrutura `comparison` pré-calculada.

Macros, chamadas `frappe`, `doc`, `namespace`, mutações e expressões Jinja serão removidas.

A saída continuará usando escape padrão do Handlebars.

Contatos, dados bancários, prazo de produção e condições gerais permanecerão exatamente como no arquivo recebido.

### View model

`quotationSnapshotViewModel` fornecerá uma propriedade `comparison` com as colunas e produtos necessários ao template.

Cada produto conterá nome, descrição, posição e uma célula alinhada a cada coluna visível.

Cada célula conterá o valor formatado ou ficará vazia para permitir o fallback visual `-`.

`QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL` conterá uma matriz pequena e determinística para validar e visualizar o modelo.

Nenhum campo de cadastro de preço atual será necessário para o render.

## Fluxo

1. O usuário executa a migração de templates durante o deploy ou setup do ambiente.
2. O seed registra o modelo `comparativo` e sua versão segura.
3. A página de orçamento lista o modelo por meio de `/api/quotation-templates`.
4. O usuário seleciona o modelo no orçamento ou na configuração disponível.
5. O backend carrega o snapshot da revisão e monta `comparison` sem chamadas externas.
6. O renderer Handlebars gera o HTML seguro.
7. O preview, o PDF e o link público reutilizam o mesmo render.

## Compatibilidade e erros

Orçamentos sem itens renderizarão a estrutura da tabela sem linhas.

Produtos sem preço em uma coluna renderizarão `-`.

Uma fonte que ainda contenha Jinja, helper não permitido ou campo obrigatório ausente será rejeitada pela validação existente.

Falhas de validação continuarão retornando a mensagem estruturada existente em português.

Uma revisão histórica continuará apontando para sua versão imutável original.

## Verificação

Será adicionado teste para agrupar produtos e produzir as colunas visíveis na ordem correta.

Será adicionado teste para selecionar a faixa por `preco_minimo_faixa` e pelo fallback de quantidade.

Será adicionado teste para duplicata de produto e faixa, confirmando que a última linha vence.

Será adicionado teste para renderizar o novo template com o view model de preview.

Será adicionado teste para garantir que a fonte convertida não contém sintaxe Jinja ou chamadas Frappe.

Será adicionado teste para confirmar que o seed inclui `comparativo` sem remover os modelos existentes.

A verificação final executará diagnósticos LSP, testes unitários, build e uma verificação local de preview/PDF quando o ambiente permitir.

## Fora de escopo

Não será criado um novo editor visual de templates.

Não será adicionada consulta de preços atuais ao renderizador.

Não será alterado o modelo padrão.

Não será alterado o conteúdo fixo aprovado pelo usuário.

Não será adicionado um interpretador Jinja ou uma dependência de renderização do Frappe.

## Critérios de aceite

`comparativo` aparece na biblioteca de modelos e pode ser selecionado em um orçamento.

O preview renderiza o layout comparativo sem erro de validação.

O PDF administrativo e o link público usam a mesma matriz do snapshot salvo.

As faixas exibidas correspondem somente às linhas existentes no orçamento.

O layout preserva o visual e os textos fixos do arquivo recebido.

O modelo padrão e as revisões históricas permanecem inalterados.

Os testes e o build passam sem novos erros.
