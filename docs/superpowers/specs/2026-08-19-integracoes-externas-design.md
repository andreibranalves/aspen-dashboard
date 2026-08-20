# Fase 19 — Padronização das integrações externas

**Data:** 2026-08-19  
**Status:** aprovado em sessão de brainstorming

## 1. Contexto

A Fase 19 do plano de refatoração pede fronteiras claras para Evolution API, OpenRouter, Vercel Blob e Vercel KV. Hoje módulos de negócio leem variáveis de ambiente, montam requests HTTP e importam SDKs externos diretamente. Isso espalha configuração, dificulta testes e permite novos acessos fora da camada de infraestrutura.

A branch `refactor/architecture-integration` continuará sendo usada. Esta fase sucede a Fase 18, sem merge, push, PR, deploy ou alteração da estratégia de branch.

## 2. Objetivo

Mover configuração e acesso aos quatro providers para adapters finos em `api/_infrastructure/integrations`, preservando integralmente o comportamento observável dos fluxos atuais.

Ao final:

- módulos e helpers compartilhados não leem configuração dos quatro providers diretamente;
- módulos e helpers compartilhados não importam `@vercel/blob`, `@vercel/blob/client` ou `@vercel/kv` diretamente;
- chamadas Evolution e OpenRouter passam por clients próprios;
- regras de domínio, payloads, chaves KV, TTLs, prompts e interpretação das respostas permanecem nos módulos responsáveis;
- testes podem substituir cada integração sem rede ou credenciais reais.

## 3. Fora do escopo

- Criar interface genérica comum aos quatro providers.
- Alterar prompts, payloads, timeouts, retries, status codes ou mensagens HTTP públicas.
- Trocar Evolution API, OpenRouter, Vercel Blob ou Vercel KV.
- Adicionar fallback de provider, transporte ou persistência.
- Alterar schema, migrations históricas, dados ou estratégia de migrations.
- Configurar secrets, executar providers remotos, deploy, push, PR ou E2E remoto.
- Migrar scripts operacionais em `scripts/`; a fronteira obrigatória desta fase cobre runtime sob `api/_modules` e `api/_shared`.
- Corrigir violações de fronteira não relacionadas aos quatro providers.

## 4. Decisão arquitetural

Usar adapters finos e específicos por provider. Não criar gateway universal, factory genérica, service locator nem interfaces com uma única implementação.

Estrutura alvo:

```text
api/_infrastructure/integrations/
  evolution/
    config.ts
    client.ts
    evolution-delivery.ts
  openrouter/
    config.ts
    client.ts
  blob/
    config.ts
    client.ts
  kv/
    config.ts
    client.ts
```

`evolution-delivery.ts` permanece na integração Evolution. Arquivos adicionais só serão criados quando uma responsabilidade concreta exigir separação; a estrutura acima não autoriza scaffolding vazio.

Cada módulo recebe o menor contrato necessário por sua dependência existente. Produção usa factory padrão; testes injetam fake. Configuração é lida sob demanda, não capturada no carregamento do módulo, porque testes e processos locais podem alterar `process.env` durante a execução.

## 5. Evolution API

### 5.1 Configuração

`evolution/config.ts` centraliza leitura e normalização de:

- `EVOLUTION_BASE_URL`;
- `EVOLUTION_API_KEY`;
- `EVOLUTION_INSTANCE`.

A URL perde barras finais. Valores são tratados com `trim`. A configuração expõe os campos normalizados e informação suficiente para os consumidores manterem suas mensagens atuais quando algum campo estiver ausente.

### 5.2 Client

`evolution/client.ts` centraliza:

- composição de URL;
- headers de autenticação e conteúdo;
- seleção de `fetch` real ou injetado;
- operações HTTP usadas por envio e sincronização;
- guarda obrigatória `assertExternalWritesAllowed('evolution')` nas operações de escrita.

O client não decide payload comercial, interpretação de entrega, retry, logging ou mensagem HTTP pública. Esses comportamentos continuam nos fluxos atuais. Leituras de sincronização não são classificadas como escrita externa.

### 5.3 Consumidores

A migração cobre, no mínimo, os usos ativos em:

- `api/_modules/send-whatsapp.ts`;
- `api/_modules/send-whatsapp-flow.ts`;
- `api/_modules/whatsapp-conversations-sync.ts`;
- `api/_modules/whatsapp-leads.ts`.

## 6. OpenRouter

### 6.1 Configuração

`openrouter/config.ts` centraliza leitura e normalização de:

- `OPENROUTER_API_KEY`;
- `OPENROUTER_MODEL`;
- `OPENROUTER_SITE_URL`;
- defaults já existentes para modelo e URL de referência.

Diferenças atuais entre títulos, modelos efetivos ou defaults só podem ser representadas por opções explícitas do consumidor; não devem ser silenciosamente uniformizadas.

### 6.2 Client

`openrouter/client.ts` centraliza:

- endpoint de chat completions;
- autenticação e headers comuns;
- seleção de `fetch` real ou injetado;
- envio do request HTTP.

Prompts, payloads, título específico, timeout, parsing, validação de MIME, mensagens públicas e tradução de erros permanecem em cada fluxo para preservar comportamento.

### 6.3 Consumidores

A migração cobre, no mínimo:

- `api/_modules/extract.ts`;
- `api/_modules/edit-draft.ts`;
- `api/_modules/whatsapp-leads.ts`.

## 7. Vercel Blob

### 7.1 Configuração

`blob/config.ts` centraliza `BLOB_READ_WRITE_TOKEN` e `BLOB_STORE_ID` usados pelo runtime atual.

`quotationBlobAuth()` será removida: está marcada como deprecated, não possui callers e referencia armazenamento de PDF já removido. Nenhum perfil Blob de quotation será criado somente para preservar código morto.

A configuração não cria aliases nem fallback novo.

### 7.2 Client

`blob/client.ts` encapsula somente operações já usadas de `@vercel/blob` e `@vercel/blob/client`, como leitura de metadados, exclusão e geração de upload token. As funções aceitam implementações injetadas quando necessário aos testes existentes.

Validação de propriedade, tamanho, MIME, pathname e regras de documento ou mídia permanece nos módulos de domínio.

### 7.3 Consumidores

A migração cobre usos ativos, incluindo:

- `api/_modules/communication-media.ts`;
- `api/_modules/communication-media-upload.ts`;
- `api/_modules/postgres-media.ts`.

`api/_modules/quotation-document-storage.ts` será alterado somente para excluir `quotationBlobAuth()`; as funções puras restantes não pertencem à integração Blob.

## 8. Vercel KV

### 8.1 Configuração

`kv/config.ts` centraliza o estado de configuração derivado de `KV_REST_API_URL` e `KV_REST_API_TOKEN`, sem expor seus valores.

### 8.2 Client

`kv/client.ts` encapsula o client instalado de `@vercel/kv`. Não cria repository genérico: cada módulo continua responsável por nomes de chave, serialização, TTL, atomicidade e tratamento de ausência.

### 8.3 Consumidores

Todos os imports ativos de `@vercel/kv` sob `api/_modules` e `api/_shared` passam pela integração, incluindo rate limiting, comunicação, mídia, cotação pública, reservas de envio e conversas WhatsApp.

## 9. Fluxo de dependências

```text
handler ou módulo
  -> contrato mínimo injetado
  -> client específico do provider
  -> fetch ou SDK já instalado
  -> provider externo
```

O client retorna resultado de baixo nível suficiente para o consumidor preservar seu contrato atual. Ele não passa a conhecer entidades de orçamento, lead, conversa, mídia ou fluxo de comunicação.

Não haverá singleton que capture env no import. Factories padrão podem criar objetos leves por chamada; otimização ou cache só será considerado mediante evidência de custo real.

## 10. Erros, logs e segurança

- Config ausente falha antes da chamada externa.
- Status codes, mensagens HTTP públicas, retries, timeouts e logging permanecem iguais.
- Clients não registram API keys, tokens, payloads com dados pessoais, corpo bruto do provider ou stack trace.
- Escritas Evolution não possuem caminho que contorne `assertExternalWritesAllowed('evolution')`.
- Blob e KV não ganham fallback local, em memória ou para outro provider.
- Erros brutos de SDK ou provider não são devolvidos ao usuário.
- Nenhum teste da fase exige credenciais ou acesso externo.

## 11. Estratégia de migração

A implementação será dividida por provider, com testes de caracterização antes da alteração de cada fluxo. A ordem recomendada é:

1. Evolution;
2. OpenRouter;
3. Blob;
4. KV;
5. guarda estática de fronteira e verificação final.

Essa ordem reduz primeiro a duplicação HTTP mais sensível e deixa os adapters de SDK, mecanicamente mais simples, para depois. Cada tranche deve manter o repositório verificável e não depende de ativação remota.

## 12. Testes

### 12.1 Caracterização

Antes de alterar cada provider, cobrir o comportamento relevante ainda não protegido:

- normalização e ausência de config;
- URL e headers;
- payload repassado;
- `fetch` ou SDK injetado;
- timeout e erro de transporte quando hoje pertencem ao consumidor;
- guarda de escrita Evolution;
- normalização da configuração Blob ativa;
- estado configurado ou não configurado do KV.

### 12.2 Adapters

Cada client terá testes unitários sem rede. Fakes devem confirmar somente o contrato necessário; não reproduzir SDKs inteiros.

### 12.3 Regressão de fronteira

Um teste estático varre arquivos TypeScript sob `api/_modules` e `api/_shared` e falha diante de:

- imports diretos de `@vercel/blob`, `@vercel/blob/client` ou `@vercel/kv`;
- leitura direta das env Evolution, OpenRouter, Blob ou KV;
- endpoint literal de Evolution ou OpenRouter.

A camada `api/_infrastructure/integrations` e scripts operacionais ficam fora dessa proibição. O teste não deve expandir para providers não tratados nesta fase.

### 12.4 Verificação

- `npm run verify:fast` após cada tranche;
- testes unitários focados durante TDD;
- `npm run verify:full` ao final;
- `git diff --check`;
- confirmação de ausência de alterações em `drizzle/` e `public/`.

## 13. Critérios de aceite

A Fase 19 estará concluída quando:

1. Evolution, OpenRouter, Blob e KV tiverem fronteiras reais em `api/_infrastructure/integrations`.
2. Todos os usos ativos em `api/_modules` e `api/_shared` passarem por essas fronteiras.
3. Nenhum comportamento observável dos fluxos tiver mudado.
4. Guardas de escrita e proteção de secrets permanecerem ativas.
5. Testes de adapters, caracterização e fronteira passarem.
6. `npm run verify:fast` e `npm run verify:full` passarem com evidência fresca.
7. Nenhuma migration, dependência, fallback, arquivo gerado em `public/` ou operação externa tiver sido adicionada.

## 14. Riscos e mitigação

- **Mudança acidental de comportamento:** testes de caracterização antes de mover código e adapters de baixo nível.
- **Env capturada cedo:** leitura sob demanda e teste que altera env entre chamadas.
- **Abstração excessiva:** clients específicos por provider; regras de domínio permanecem nos módulos.
- **Bypass futuro da fronteira:** teste estático no escopo exato de runtime.
- **Grande volume de consumidores KV:** migração mecânica em tranche própria, sem redesenhar chaves ou persistência.
