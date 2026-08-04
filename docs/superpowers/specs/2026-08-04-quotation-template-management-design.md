# Templates HTML e conteúdo configurável de orçamentos

**Data:** 2026-08-04

**Status:** Design aprovado em conversa.

## Contexto

O Aspen Dashboard já renderiza orçamentos a partir de templates HTML completos com Handlebars.

Os templates atuais são embutidos no código e a configuração global já contém validade, pagamento, entrega, observações, frete e template padrão.

Cada revisão de orçamento já guarda snapshots de dados comerciais importantes.

O objetivo é permitir que uma pessoa administradora gerencie modelos HTML em Configurações e ajuste o conteúdo comercial de cada orçamento sem criar um editor visual.

A emissão continua sendo somente uma transição de status.

A visualização continua sendo HTML gerado sob demanda.

Nenhum PDF emitido ou documento HTML será armazenado em Vercel Blob por esta funcionalidade.

## Objetivos

- Permitir cadastrar e editar modelos colando um documento HTML completo.
- Versionar alterações de um mesmo modelo sem alterar revisões antigas.
- Migrar os três templates embutidos atuais para a biblioteca editável.
- Permitir escolher o modelo na criação manual e automática de orçamento.
- Permitir trocar o modelo enquanto a revisão ainda estiver em rascunho.
- Congelar template e conteúdo quando a revisão deixar de ser rascunho.
- Configurar três seções comerciais globais: prazo de produção, dados para pagamento e condições gerais.
- Permitir ativar, desativar e editar essas seções por revisão.
- Preservar quebras de linha dos corpos escritos em texto simples.
- Validar o HTML e mostrar um preview antes de ativar uma versão.
- Manter o histórico visual de cada revisão independente de alterações futuras.

## Fora de escopo

- Editor visual ou drag-and-drop.
- Lista livre de seções personalizadas.
- JavaScript dentro dos templates.
- Upload de templates ou imagens por esta tela.
- Markdown ou HTML livre nos corpos das seções.
- Geração, emissão ou armazenamento de PDF.
- Atualização retroativa de orçamentos existentes quando os padrões mudarem.

## Decisões de produto

### Biblioteca de modelos

A tela de Configurações usará o layout de lista + editor.

A lista ficará à esquerda com modelos ativos e arquivados.

O editor ficará à direita com nome, chave, versão atual e textarea monoespaçada para o documento HTML completo.

As seções padrão ficarão abaixo do editor no mesmo contexto de Configurações.

Editar um modelo usado não cria outro nome.

A alteração cria uma nova versão interna do mesmo modelo.

A lista continua mostrando um único modelo, com a versão atual e a quantidade de revisões que o utilizam.

Versões antigas permanecem disponíveis para revisões históricas.

Modelos usados não poderão ser excluídos fisicamente.

Arquivar um modelo remove-o da seleção de novos orçamentos, mas não quebra rascunhos ou revisões que já o utilizam.

O modelo padrão será definido por `app_settings.template_padrao`.

A chave continuará sendo a identidade estável do modelo para compatibilidade com dados existentes.

Um modelo arquivado não poderá ser escolhido para um novo orçamento.

O modelo padrão não poderá ser arquivado enquanto não houver outro modelo ativo definido como padrão.

### Seções comerciais

Existirão exatamente três seções no primeiro lançamento:

1. `prazo_producao`.
2. `pagamento`.
3. `condicoes_gerais`.

Cada seção terá um estado `enabled`.

Cada seção poderá ser ativada ou desativada no padrão global.

Cada revisão poderá substituir o estado global capturado na criação.

Alterar a configuração global afetará somente novos orçamentos.

Uma revisão existente manterá os valores que capturou quando foi criada.

A seção de prazo terá somente título configurável e valor vindo do campo semântico `prazo_producao` da revisão.

O prazo de produção continuará editável como campo próprio do orçamento.

A seção de pagamento terá título e corpo em texto simples.

A seção de condições gerais terá título e corpo em texto simples.

O corpo inicial de condições gerais combinará os valores legados de prazo de entrega e observações com rótulos claros.

O corpo de condições gerais será um único texto novo depois da migração.

O atual campo de prazo de entrega não será uma quarta seção.

### Overrides na revisão

A página individual exibirá os campos das três seções sempre visíveis.

Cada seção exibirá um indicador derivado: `Padrão` ou `Personalizado`.

A revisão terá ação `Restaurar padrão` para cada seção personalizada.

Restaurar padrão retornará ao padrão capturado na criação daquela revisão.

Restaurar padrão não buscará o valor global atual, porque esse valor pode ter mudado depois da criação.

Template, seções e campos comerciais só poderão ser editados enquanto a revisão estiver em `rascunho`.

Depois de enviada, aprovada ou perdida, a revisão ficará congelada.

Trocar o modelo em um rascunho não criará uma nova revisão.

A troca apenas atualizará o modelo da revisão atual e preservará o snapshot de seções atual.

## Modelo de dados

### `quotation_templates`

A tabela representará a identidade estável de cada modelo.

Campos previstos:

- `id` UUID.
- `key` única, minúscula e estável.
- `name` exibido na interface.
- `archived` booleano.
- `created_at`.
- `updated_at`.

A tabela não armazenará o HTML atual diretamente.

### `quotation_template_versions`

A tabela armazenará cada versão imutável do HTML de um modelo.

Campos previstos:

- `id` UUID.
- `template_id` com referência a `quotation_templates`.
- `version` inteiro incremental por modelo.
- `source` documento HTML completo.
- `source_hash` SHA-256 do documento UTF-8.
- `created_at`.

Haverá unicidade por `template_id + version`.

Haverá unicidade por `template_id + source_hash` para evitar versões idênticas.

A versão atual será a maior versão do modelo.

Uma revisão referenciará a versão exata que usou.

### `app_settings`

A configuração singleton receberá um campo JSONB para as três seções globais.

O campo será validado no limite da API e no repositório.

Formato conceitual:

```json
{
  "schema_version": 1,
  "prazo_producao": {
    "enabled": true,
    "title": "Prazo de produção"
  },
  "pagamento": {
    "enabled": true,
    "title": "Dados para pagamento",
    "body": ""
  },
  "condicoes_gerais": {
    "enabled": true,
    "title": "Condições gerais",
    "body": ""
  }
}
```

O campo `template_padrao` continuará apontando para a chave do modelo padrão.

Os campos legados de pagamento, entrega e observações poderão permanecer como espelho de compatibilidade durante a migração.

O snapshot será a fonte de verdade para renderização de novas revisões.

### `quote_revisions`

A revisão receberá:

- `template_version_id` com referência à versão usada.
- `sections_snapshot` JSONB validado.

Os campos existentes `template_padrao` e `template_hash` serão mantidos durante a migração e preenchidos junto com a nova referência.

Os campos legados de pagamento, entrega e observações poderão continuar sendo preenchidos como espelho para compatibilidade com leitores antigos.

O snapshot armazenará o padrão capturado e o valor atual da revisão.

Formato conceitual:

```json
{
  "schema_version": 1,
  "prazo_producao": {
    "base": {
      "enabled": true,
      "title": "Prazo de produção"
    },
    "current": {
      "enabled": true,
      "title": "Prazo de produção"
    }
  },
  "pagamento": {
    "base": {
      "enabled": true,
      "title": "Dados para pagamento",
      "body": ""
    },
    "current": {
      "enabled": true,
      "title": "Dados para pagamento",
      "body": ""
    }
  },
  "condicoes_gerais": {
    "base": {
      "enabled": true,
      "title": "Condições gerais",
      "body": ""
    },
    "current": {
      "enabled": true,
      "title": "Condições gerais",
      "body": ""
    }
  }
}
```

Uma seção será considerada personalizada quando `current` diferir de `base`.

O corpo da seção de prazo não será armazenado nesse snapshot.

O valor de prazo continuará vindo de `quote_revisions.prazo_producao`.

## Contrato dos templates

O usuário colará um documento HTML completo, incluindo `doctype`, `<html>`, CSS e corpo.

O modelo de renderização continuará expondo os campos atuais de cliente, itens, totais, datas e termos para compatibilidade.

Também será exposto o objeto `secoes`.

Exemplo conceitual:

```handlebars
{{#if secoes.prazo_producao.enabled}}
  <h2>{{secoes.prazo_producao.title}}</h2>
  <div>{{secoes.prazo_producao.value}}</div>
{{/if}}

{{#if secoes.pagamento.enabled}}
  <h2>{{secoes.pagamento.title}}</h2>
  <div>{{secoes.pagamento.body_html}}</div>
{{/if}}

{{#if secoes.condicoes_gerais.enabled}}
  <h2>{{secoes.condicoes_gerais.title}}</h2>
  <div>{{secoes.condicoes_gerais.body_html}}</div>
{{/if}}
```

`body_html` será gerado pelo servidor a partir do texto simples.

O texto será escapado antes de cada quebra de linha ser convertida em `<br>`.

O valor será fornecido ao Handlebars como conteúdo seguro gerado pelo próprio servidor.

O usuário não poderá inserir HTML no corpo das seções.

O template continuará usando interpolação escapada normal.

Saídas triple-stash e outras formas de saída sem escape continuarão proibidas.

O template não precisará renderizar todas as seções.

Isso permite que o HTML controle completamente o layout e omita uma seção quando necessário.

A validação exigirá campos essenciais do orçamento, como número, cliente, itens e total.

A ausência de uma seção será informada no preview como aviso, não como erro, porque a decisão de layout pertence ao template.

## Segurança e validação

A validação ocorrerá antes de persistir uma nova versão.

O parser do Handlebars continuará limitando helpers a `if` e `each`.

Subexpressões, partials, decorators, helpers desconhecidos e built-ins perigosos continuarão proibidos.

O HTML será submetido a uma allowlist de tags e atributos compatível com os templates existentes.

`script`, `iframe`, `object`, `embed`, URLs `javascript:`, handlers inline como `onclick` e atributos equivalentes serão rejeitados.

CSS inline e blocos `<style>` serão permitidos dentro das regras da allowlist.

Imagens e links serão permitidos somente com protocolos seguros.

A implementação não adicionará dependência nova sem aprovação explícita.

Se a validação exigir uma biblioteca externa, isso será tratado como decisão separada antes da implementação.

O endpoint de validação não persistirá nada.

O preview usará dados fictícios determinísticos.

Uma versão somente ficará disponível para seleção depois de passar por validação e renderização do preview.

Erros serão exibidos em português e não exporão stack trace ou HTML bruto perigoso na resposta da API.

## Fluxos

### Configurações

1. A pessoa abre Configurações e escolhe a área de templates.
2. A lista mostra modelos ativos e arquivados.
3. A pessoa seleciona um modelo ou cria um novo.
4. Cola o HTML completo na textarea monoespaçada.
5. Clica em `Validar e visualizar preview`.
6. O sistema mostra erros, avisos e preview com dados fictícios.
7. Depois de validação bem-sucedida, a pessoa salva uma nova versão.
8. A pessoa pode definir o modelo ativo como padrão ou arquivar o modelo.
9. Na área de seções padrão, edita enabled, títulos e corpos das três seções.
10. Salvar a configuração não altera revisões existentes.

### Criação de orçamento

O seletor de modelo aparecerá no fluxo manual.

O seletor também aparecerá no fluxo automático após a extração.

O valor inicial será o modelo padrão das configurações.

O backend resolverá o modelo padrão quando o cliente não enviar uma escolha.

O backend rejeitará modelo inexistente, arquivado ou versão inválida.

A revisão será criada com a versão atual do modelo selecionado.

A revisão também receberá uma cópia dos padrões globais de seções em `base` e `current`.

### Edição do rascunho

A página individual exibirá seleção de modelo, prazo de produção e as três seções.

O usuário poderá editar os campos sempre visíveis.

O indicador de cada seção será calculado comparando `current` e `base`.

Restaurar uma seção copiará `base` para `current`.

Salvar enviará o snapshot completo e a versão selecionada ao backend.

O backend aceitará essas mudanças somente se a revisão ainda for rascunho.

### Visualização e envio

A visualização usará sempre a versão de template e o snapshot armazenados na revisão.

Alterações posteriores em Configurações não alterarão o HTML visualizado de revisões antigas.

Enviar continuará apenas alterando o status da revisão.

Após enviar, template, seções e campos comerciais ficarão bloqueados.

## API

A API de configurações continuará usando `GET/PUT /settings`.

O payload de configurações incluirá as três seções globais.

O endpoint existente de templates será expandido para suportar listagem e manutenção da biblioteca.

A API deverá oferecer, no mínimo:

- `GET /quotation-templates` para listar modelos e versões atuais.
- `POST /quotation-templates` para criar um modelo com a primeira versão.
- `PUT /quotation-templates?id=...` para criar uma nova versão, alterar metadados, definir padrão ou arquivar.
- `POST /quotation-templates/validate` para validar e renderizar preview sem persistir.

Os nomes finais de rotas poderão seguir o mapa de rotas existente sem criar duplicações desnecessárias.

A API de criação e atualização de cotação aceitará a versão do modelo e o snapshot de seções.

A API rejeitará alterações de conteúdo em estados não editáveis com conflito em português.

A API de preview de orçamento não buscará defaults atuais para uma revisão já criada.

## Migração

A migração criará um registro para cada template embutido atual.

`padrao` será o modelo padrão inicial.

Cada modelo embutido terá sua fonte atual como versão 1.

A migração verificará se os hashes gravados nas revisões existentes correspondem às versões semeadas.

Revisões existentes receberão `template_version_id` correspondente ao par de chave e hash.

Revisões existentes receberão snapshot de seções derivado de seus próprios campos gravados.

Para pagamento, o valor existente de `pagamento` será preservado.

Para condições gerais, `entrega` e `observacoes` serão combinados com rótulos claros no corpo novo.

Para prazo de produção, o valor existente de `prazo_producao` continuará no campo próprio.

As configurações globais receberão os valores atuais como base inicial.

A migração será idempotente e não removerá dados legados antes de verificar referências.

Hashes sem versão correspondente serão reportados como erro de migração, em vez de receberem uma fonte inventada.

## Tratamento de erros

- HTML inválido retorna erro de validação com campo e motivo.
- Placeholder ou helper não permitido retorna erro em português.
- Template sem campo essencial retorna erro; seção omitida gera aviso.
- Modelo arquivado ou versão inexistente retorna erro de seleção.
- Tentativa de editar revisão congelada retorna conflito.
- Tentativa de arquivar o padrão sem substituto retorna conflito.
- Falha de banco retorna mensagem genérica e log estruturado no servidor.
- Nenhum erro de fornecedor, stack trace ou conteúdo sensível será exposto ao navegador.

## Testes e critérios de aceite

### Templates

- Criar modelo com HTML válido cria identidade e versão 1.
- Editar modelo usado cria versão 2 sem alterar a versão 1.
- Hash idêntico não cria versão duplicada.
- Arquivar modelo remove-o de novos seletores e preserva referências existentes.
- Não é possível arquivar o modelo padrão sem escolher outro.
- Templates atuais continuam renderizando depois da migração.

### Segurança

- Helpers permitidos continuam funcionando.
- Helpers perigosos, partials, decorators e triple-stash são rejeitados.
- Script, iframe, eventos inline, URLs javascript e recursos equivalentes são rejeitados.
- Texto de seção com HTML é escapado.
- Quebras de linha viram `<br>` apenas no campo seguro gerado pelo servidor.

### Seções e snapshots

- Configuração salva as três seções e valida limites de tamanho.
- Novas revisões recebem cópia dos padrões atuais.
- Alterar padrões não altera revisões antigas.
- Override altera somente a revisão em rascunho.
- Restaurar padrão volta ao `base` da revisão.
- Ativação e desativação funcionam individualmente.
- Prazo de produção continua usando o campo semântico da revisão.
- Migração combina entrega e observações sem perda de conteúdo.

### Fluxos

- Manual e automático exibem o seletor de modelo.
- Rascunho permite trocar o modelo sem criar revisão adicional.
- Estados enviados, aprovados e perdidos rejeitam alterações.
- Preview usa a versão e o snapshot da revisão, não os defaults atuais.
- Emissão não gera PDF nem faz upload para Blob.

## Resultado esperado

A pessoa administradora poderá colar e manter os próprios documentos HTML sem depender de deploy.

A pessoa operadora poderá escolher o layout na criação e ajustar o conteúdo comercial por cliente enquanto o orçamento for rascunho.

Revisões enviadas continuarão reproduzíveis mesmo depois de alterações em modelos ou configurações globais.

A solução manterá o preview HTML sob demanda e não reintroduzirá armazenamento de PDF emitido.
