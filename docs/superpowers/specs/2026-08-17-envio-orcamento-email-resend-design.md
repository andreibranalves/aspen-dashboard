# Envio de orçamento por e-mail com Resend

## Objetivo

Permitir que um operador envie a revisão emitida de um orçamento por e-mail na página individual do orçamento.
O destinatário recebe um PDF anexado e um link público para a mesma revisão.
A página `/orcamentos` mostra se a revisão atual já teve um envio aceito pela Resend.

## Decisões confirmadas

- O destinatário começa preenchido com o e-mail do cliente e pode ser editado antes do envio.
- O e-mail contém o PDF e o link público do orçamento.
- O marcador muda somente quando a API da Resend aceita o envio.
- O marcador pertence à revisão atual, não ao orçamento inteiro.
- Uma nova revisão começa como não enviada por e-mail.
- A integração usa a API HTTP da Resend por meio do `fetch` nativo do Node.js.
- A implementação não adiciona o pacote `resend` nem outra dependência.
- A entrega por WhatsApp existente permanece inalterada.

## Semântica do estado

Um envio aceito significa que a Resend aceitou a mensagem e retornou um identificador.
Isso não significa que o servidor do destinatário entregou a mensagem, nem que o cliente abriu ou leu o e-mail.
A interface usa o texto `E-mail enviado` para essa aceitação operacional.

O marcador considera somente a revisão atual exibida pela linha de `/orcamentos`.
Ele fica ativo quando existe ao menos uma tentativa aceita para essa revisão.
Tentativas pendentes ou com falha não ativam o marcador.

## Arquitetura

A funcionalidade usa quatro partes:

1. Um repositório PostgreSQL registra tentativas de envio por e-mail.
2. Um endpoint autenticado prepara o documento, cria o link público e chama a Resend.
3. A página individual confirma o destinatário e inicia o envio.
4. A listagem de orçamentos recebe da API o estado agregado da revisão atual.

A tabela de entrega WhatsApp não será generalizada.
Ela exige telefone e fluxo e representa regras próprias do transporte WhatsApp.
Separar a persistência reduz risco sobre o fluxo existente e evita abstração multicanal sem necessidade atual.

## Modelo de dados

Será criada a tabela `quotation_email_deliveries`.
Cada linha representa uma tentativa de envio de uma revisão.

Campos mínimos:

- `id`: UUID fornecido como identificador idempotente da tentativa.
- `revision_id`: chave estrangeira para `quote_revisions`.
- `recipient`: endereço normalizado usado no envio.
- `public_token`: token público aleatório mantido somente enquanto a tentativa estiver `pending`.
- `state`: `pending`, `accepted` ou `failed`.
- `provider_email_id`: identificador retornado pela Resend, quando aceito.
- `public_error`: mensagem segura em português para falha conhecida.
- `accepted_at`: instante em que a Resend aceitou a mensagem.
- `created_at`: instante de criação da tentativa.
- `updated_at`: instante da última alteração.

O identificador da tentativa é a chave primária.
O identificador da Resend deve ser único quando presente.
Um índice por `revision_id`, `state` e `accepted_at` permite projetar o marcador sem consultas N+1.
A migração será gerada pelo fluxo Drizzle atual.
Arquivos históricos em `drizzle/` não serão alterados.

## Contrato HTTP

### `POST /api/send-quotation-email`

Corpo:

```json
{
  "revision_id": "uuid",
  "recipient": "cliente@example.com",
  "attempt_id": "uuid"
}
```

Resposta aceita:

```json
{
  "success": true,
  "delivery": {
    "state": "accepted",
    "recipient": "cliente@example.com",
    "accepted_at": "2026-08-17T12:00:00.000Z"
  }
}
```

O endpoint aceita somente `POST`.
O endpoint valida UUIDs, normaliza o endereço e rejeita caracteres de controle.
O endpoint exige uma revisão emitida e ainda disponível pelas regras atuais de emissão e retenção.
O endpoint não aceita um orçamento em rascunho.
O endpoint usa autenticação e rate limit do boundary implantado.
Erros retornados ao cliente são seguros e escritos em português.

Repetir uma tentativa já aceita retorna seu estado sem chamar a Resend novamente.
Repetir uma tentativa pendente usa a mesma chave idempotente da Resend.
Reutilizar o mesmo `attempt_id` com outra revisão ou outro destinatário retorna conflito.
Uma nova ação explícita de reenvio cria outro `attempt_id`.

## Preparação do documento

O endpoint carrega o snapshot imutável da revisão e emite um único token público para a tentativa.
O corpo usa a URL HTML desse token e o anexo usa a mesma URL com `format=pdf`.
A Resend baixa o PDF pela URL assinada e o entrega como anexo ao destinatário.
As duas URLs apontam para a mesma `revision_id` e respeitam a validade e retenção atuais do orçamento.
O endpoint público aplica o limite de tamanho do PDF já usado pelo produto.
Nenhum documento é reconstruído a partir do estado editável do navegador.

## Integração Resend

A chamada usa `fetch` para a API HTTP da Resend.
A requisição envia:

- `Authorization: Bearer <RESEND_API_KEY>`.
- `Content-Type: application/json`.
- Uma chave idempotente derivada de `quotation-email/<attempt_id>`.
- `from` vindo de `RESEND_FROM_EMAIL`.
- `reply_to` vindo de `RESEND_REPLY_TO`, quando configurado.
- `to` com o destinatário confirmado.
- Assunto `Orçamento <número> - Aspen`.
- Corpo HTML simples com nome do cliente e link público.
- Anexo remoto com `path` apontando para a URL pública assinada com `format=pdf` e nome derivado do número do orçamento.

O HTML escapa todo conteúdo vindo do orçamento e do cliente.
O token público é persistido temporariamente na tentativa `pending`, reutilizado em toda repetição idempotente e apagado ao mudar para `accepted` ou `failed`.
Isso mantém corpo e anexo iguais quando a mesma tentativa precisa ser repetida.
A resposta precisa conter um identificador de e-mail antes de a tentativa mudar para `accepted`.
Falhas HTTP, respostas inválidas e timeouts mudam a tentativa para `failed` quando for seguro afirmar que a Resend não aceitou a mensagem.
Uma resposta ambígua mantém a tentativa `pending`, permitindo repetição com a mesma chave idempotente.
Detalhes técnicos ficam somente nos logs do servidor.

A documentação atual da Resend usada no desenho é `/websites/resend` no Context7.
Ela confirma anexos remotos por `path`, retorno com identificador e chaves idempotentes válidas por 24 horas.

## Configuração operacional

Variáveis necessárias:

- `RESEND_API_KEY`.
- `RESEND_FROM_EMAIL`, contendo um remetente pertencente ao domínio verificado.
- `RESEND_REPLY_TO`, opcional.

Valores permanecem fora do checkout na configuração operacional existente.
Nenhum valor será exibido em logs, respostas HTTP, testes ou documentação.
A preflight operacional deve informar apenas presença ou ausência das variáveis.

## Interface da página individual

A página `src/pages/QuotationDetailPage.tsx` recebe um botão `Enviar por e-mail` junto das ações de entrega.
O botão fica disponível somente para revisão emitida.

O clique abre um diálogo com:

- Campo de e-mail preenchido com o endereço do cliente, quando disponível.
- Campo editável e obrigatório.
- Ação `Cancelar`.
- Ação `Enviar e-mail`.

Durante a requisição, o campo e a confirmação ficam bloqueados e a ação mostra `Enviando...`.
Após aceitação, a página mostra confirmação e o botão passa a `Reenviar por e-mail`.
Uma falha mantém o estado anterior e mostra uma mensagem segura.
A tentativa mantém seu `attempt_id` enquanto uma resposta ambígua precisar ser repetida.
Uma nova confirmação explícita após sucesso gera outro identificador.

## Interface da listagem

A API de listagem projeta para cada orçamento:

- `email_sent`: booleano calculado para a revisão atual.
- `email_sent_at`: data da aceitação mais recente ou `null`.

A projeção ocorre na consulta PostgreSQL, sem uma consulta adicional por linha.
A resposta de detalhe expõe os mesmos campos para manter a interface consistente.

As visualizações desktop e mobile de `src/pages/QuotationsPage.tsx` mostram um marcador textual:

- `E-mail enviado` quando `email_sent` for verdadeiro.
- `E-mail não enviado` quando `email_sent` for falso.

Quando enviado, o marcador mostra `E-mail enviado` e a data da aceitação em texto auxiliar.
O estado sempre vem da API e não usa `localStorage` nem projeção otimista persistente.

## Tratamento de erros

- Destinatário ausente ou inválido retorna `400`.
- Revisão inexistente retorna `404`.
- Revisão em rascunho ou incompatível retorna `409`.
- Configuração Resend ausente retorna `503`.
- Reutilização incompatível do `attempt_id` retorna `409`.
- Falha conhecida da Resend retorna `502` com mensagem pública genérica.
- Falha interna de persistência retorna `500` sem detalhes do banco.

O servidor não retorna stack trace, chave, corpo integral do provedor ou dados de outro cliente.
O log associa a falha ao `attempt_id` e à revisão, sem registrar conteúdo do PDF nem credenciais.

## Rotas

A nova rota deve ser adicionada e mantida sincronizada em:

- `api/[...path].ts`.
- `scripts/dev-api-server.mjs`.
- `scripts/app-server.mjs`.

Os servidores locais continuam seguindo a política atual de autenticação descrita no projeto.

## Estratégia de testes

O desenvolvimento seguirá TDD após aprovação do plano.

Testes unitários cobrem:

- Validação e normalização do destinatário.
- Rejeição de revisão em rascunho.
- Preparação das URLs HTML e PDF para a mesma revisão.
- Reutilização do mesmo token público em uma repetição idempotente.
- Corpo HTML escapado.
- Chamada Resend com anexo remoto, remetente e chave idempotente.
- Transição `pending` para `accepted` após resposta com identificador.
- Transição segura para `failed` após recusa conhecida.
- Manutenção de `pending` após resposta ambígua.
- Repetição idempotente sem envio duplicado.
- Conflito quando um identificador é reutilizado com outro payload.
- Projeção do marcador somente para a revisão atual aceita.
- Nova revisão projetada como não enviada.

O teste E2E reproduz o fluxo do operador com transporte Resend controlado:

- Abrir orçamento emitido.
- Abrir diálogo com e-mail pré-preenchido.
- Editar destinatário e confirmar.
- Observar estado de envio e confirmação.
- Voltar para `/orcamentos` e observar marcador em desktop e mobile.
- Criar ou carregar nova revisão e observar marcador não enviado.
- Simular falha e confirmar que o marcador não muda.

A verificação final executa:

```bash
npm run build:api
npm run test:unit
npm run lint
npm run build
node scripts/check-no-legacy-provider.mjs
```

Um smoke test em staging envia somente para uma caixa controlada.
Nenhum teste automatizado envia mensagem real para cliente.

## Fora de escopo

- Webhooks de entrega, rejeição, abertura ou clique.
- Afirmação de que o destinatário recebeu ou leu o e-mail.
- Editor de template de e-mail.
- Histórico visual de todas as tentativas.
- Envio em massa pela listagem.
- CC, BCC ou múltiplos destinatários.
- Refatoração da entrega WhatsApp para transporte genérico.
