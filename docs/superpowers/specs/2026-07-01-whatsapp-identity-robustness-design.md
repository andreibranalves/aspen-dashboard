# Design — Robustez de Identidade no WhatsApp (sistema inteiro)

## Resumo

Redesenhar a forma como o sistema representa identidade de contatos do WhatsApp para eliminar confusão entre identificador técnico da conversa, telefone real do cliente e rótulo visual exibido na UI.

O objetivo é tornar robustos, consistentes e auditáveis todos os fluxos que dependem da identidade do contato: inbox do WhatsApp, CRM match, criação de pré-orçamento, criação de lead e persistência/reprocessamento de conversas antigas.

## Objetivo

Garantir que o sistema:

- nunca trate um identificador técnico do provider (`@lid`, `remoteJid`, alias internos) como se fosse o telefone do cliente;
- use um telefone canônico confiável para operações de negócio;
- mantenha a inbox funcional mesmo quando a identidade do contato estiver incompleta ou ambígua;
- recupere e corrija dados históricos já contaminados por regras frágeis de fallback.

## Escopo

### Incluído

- Remodelagem conceitual da identidade de conversas WhatsApp.
- Criação de um resolver central de identidade.
- Separação explícita entre id técnico, telefone canônico e rótulo visual.
- Persistência de status, origem e confiança da identidade.
- Uso do novo modelo em:
  - inbox do WhatsApp;
  - CRM match;
  - criação de pré-orçamento;
  - criação de lead;
  - envio de mensagem;
  - sync de conversas e mensagens.
- Backfill completo dos dados já existentes.
- Reprocessamento de vínculos CRM afetados por telefone incorreto.
- Ajuste de UI para nunca exibir id técnico como telefone do cliente.
- Ajuste de formatação de telefone para suportar DDI completo sem truncamento.

### Excluído

- Troca de provider de WhatsApp.
- Migração para WhatsApp Cloud API como pré-requisito.
- Ferramenta manual complexa de resolução de conflitos nesta fase.
- Nova tela administrativa dedicada a auditoria de identidade, exceto se um estado mínimo na UI atual for necessário.

## Problema atual

Hoje o sistema mistura três papéis distintos dentro do mesmo fluxo de dados:

1. **identificador técnico da conversa** (ex.: `remoteJid`, `@lid`);
2. **telefone real do contato**;
3. **texto visual exibido ao usuário**.

Essa mistura cria bugs como:

- `remoteJid` tipo `@lid` sendo tratado como telefone;
- telefone truncado na UI quando inclui DDI `55`;
- `displayName` ora funcionando como nome, ora como telefone, ora como identificador técnico;
- match de CRM quebrando porque a origem do telefone não é confiável;
- automações de negócio herdando um telefone errado ou derivado.

## Decisões aprovadas

- O redesenho cobre o **sistema inteiro**, não só a inbox.
- A estratégia de migração deve incluir **backfill completo**.
- Em caso de conflito de identidade, o sistema deve **falhar fechado**:
  - não auto-vincular CRM;
  - não criar lead/pré-orçamento com telefone duvidoso;
  - não sobrescrever um telefone confiável com evidência pior;
  - manter a thread operável como inbox usando o identificador técnico do provider.
- A abordagem escolhida é um **resolver central + modelo de identidade enxuto**, sem criar uma plataforma excessivamente complexa de entidades separadas.

## Princípios de design

### 1. Papéis semânticos separados

Cada conversa passa a ter três conceitos distintos:

#### A. `providerConversationId`

Identificador técnico da thread no provider de WhatsApp.

Exemplos:

- `183792384719283741@lid`
- `5521981858541@s.whatsapp.net`

Uso permitido:

- sincronizar mensagens;
- correlacionar a conversa com o provider;
- enviar mensagens na thread correta.

Uso proibido:

- CRM match;
- criação de lead;
- criação de pré-orçamento;
- exibição como telefone do cliente.

#### B. `canonicalPhone`

Telefone canônico do contato, em formato normalizado por dígitos, usado como identidade de negócio.

Exemplo:

- `5521981858541`

Uso:

- CRM match;
- criação de lead;
- criação de pré-orçamento;
- exibição do telefone;
- filtros e buscas por telefone.

#### C. `displayLabel`

Rótulo visual da conversa.

Regra:

- usar nome confiável do contato quando houver;
- caso contrário, usar `canonicalPhone` formatado;
- nunca usar `providerConversationId` por fallback implícito.

### 2. Identidade com proveniência

Não basta salvar o telefone; o sistema deve guardar de onde ele veio e quão confiável ele é.

Campos adicionais:

- `identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict'`
- `identitySource: string | null`
- `identityConfidence: 'high' | 'medium' | 'low' | null`

### 3. Um único resolvedor de identidade

Toda decisão sobre identidade deve sair de um ponto central no backend.

Interface conceitual:

```ts
interface ResolvedWhatsappIdentity {
  providerConversationId: string;
  canonicalPhone: string;
  displayLabel: string;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  identitySource: string | null;
  identityConfidence: 'high' | 'medium' | 'low' | null;
}

resolveWhatsappIdentity(input: {
  chat: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  storedConversation?: Record<string, unknown> | null;
}): ResolvedWhatsappIdentity;
```

Esse resolvedor será usado por:

- sync de conversas;
- sync de mensagens;
- leitura de detalhe na inbox;
- CRM match;
- criação de pré-orçamento;
- criação de lead;
- rotinas de backfill.

## Modelo de dados proposto

### Conversa WhatsApp

A conversa passa a carregar explicitamente:

```ts
interface WhatsappConversation {
  id: string;
  providerConversationId: string;
  remoteJid: string; // alias legado / compatibilidade
  canonicalPhone: string;
  displayLabel: string;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  identitySource: string | null;
  identityConfidence: 'high' | 'medium' | 'low' | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  source: 'evolution';
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
  linkedCrmEntityId?: string | null;
  linkedCrmEntityType?: 'lead' | 'cliente' | null;
  linkedCrmMatchSource?: 'phone' | 'email' | 'name' | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}
```

### Compatibilidade

- `remoteJid` pode continuar persistido para compatibilidade com dados e código legado.
- `phone` pode continuar existindo temporariamente como campo de transição, mas a spec define `canonicalPhone` como fonte de verdade.
- Durante a transição, qualquer leitura antiga de `phone` deve ser gradualmente substituída por `canonicalPhone`.

## Estratégia de resolução de identidade

### Ranking de evidências

O resolvedor deve escolher `canonicalPhone` por prioridade.

#### Alta confiança

- `chat.phone`
- `chat.senderPn`
- `message.key.participant` quando for telefone real
- `message.from` quando for telefone real
- outros campos explícitos do provider que representem o telefone do contato

Resultado:

- `identityConfidence = 'high'`
- `identityStatus = 'verified'` quando houver consistência suficiente

#### Média confiança

- `providerConversationId` / `remoteJid` **somente** quando estiver em formato inequívoco de JID telefônico real (`@s.whatsapp.net` ou `@c.us`)

Resultado:

- `identityConfidence = 'medium'`
- `identityStatus = 'derived'`

#### Baixa confiança ou inválido

- `@lid`
- ids opacos ou derivados
- números truncados
- conteúdo textual de mensagens
- dados de contato anexado ou citado
- qualquer valor sem evidência estrutural de que seja o telefone real do contato

Resultado:

- não usar como `canonicalPhone`

### Regras adicionais

- evidência pior nunca sobrescreve uma identidade suportada por evidência melhor;
- ausência de novo dado não apaga um `canonicalPhone` confiável já salvo;
- conflito entre duas evidências fortes incompatíveis gera `identityStatus = 'conflict'`;
- ausência de evidência suficiente gera `identityStatus = 'unresolved'`;
- `displayLabel` não pode influenciar a escolha do telefone canônico.

## Conteúdo que não deve contaminar identidade

A identidade da conversa deve ser derivada do participante da thread, não de dados que aparecem dentro do conteúdo da mensagem.

Ignorar para fins de identidade:

- contatos anexados;
- quoted contacts;
- números presentes em texto livre;
- cards enviados por mensagens;
- anexos que contenham contatos de terceiros;
- dados de participantes de mensagens encaminhadas quando não forem o contato principal da conversa.

## Comportamento em caso de conflito

Quando houver conflito entre evidências relevantes:

- a conversa continua operacional na inbox;
- `providerConversationId` continua apto para sync e envio de mensagem;
- `canonicalPhone` não é promovido automaticamente se a confiança não for suficiente;
- CRM match automático é bloqueado;
- criação automática de pré-orçamento e lead é bloqueada;
- o status deve ficar visível para observabilidade interna (`conflict` ou `unresolved`).

A política é deliberadamente conservadora para evitar poluir CRM e fluxos comerciais com identidade incorreta.

## Uso do novo modelo nos fluxos

### 1. Sync de conversas

Ao sincronizar chats do provider:

1. ler payload bruto da conversa;
2. buscar mensagens recentes quando necessário para enriquecer evidência;
3. chamar `resolveWhatsappIdentity(...)`;
4. persistir a conversa com `providerConversationId`, `canonicalPhone`, `displayLabel`, status e metadados;
5. nunca derivar telefone diretamente fora do resolvedor central.

### 2. Sync de mensagens

Ao sincronizar mensagens de uma conversa existente:

1. persistir mensagens normalmente;
2. reavaliar identidade da conversa usando as mensagens recém-lidas;
3. fazer backfill do `canonicalPhone` apenas se a nova evidência for melhor que a atual;
4. preservar identidade atual se a nova evidência for pior ou ausente.

### 3. CRM match

O match passa a usar:

1. `canonicalPhone`
2. email extraído de mensagens inbound
3. fallback conservador por nome

Se `identityStatus` estiver em `unresolved` ou `conflict`, o sistema não deve promover match automático por telefone.

### 4. Criação de pré-orçamento

O fluxo usa `canonicalPhone`.

Se não houver telefone confiável:

- não criar automaticamente;
- retornar mensagem segura e clara em português;
- manter a conversa utilizável no inbox.

### 5. Criação de lead

Mesma política do pré-orçamento:

- depende de `canonicalPhone` confiável;
- não deve herdar id técnico como telefone.

### 6. Envio de mensagem

Envio deve usar o endereço técnico correto para transporte, derivado de `providerConversationId` ou da informação específica exigida pelo provider.

O envio **não depende** do telefone canônico visualmente exibido.

## UI proposta

## Inbox — lista e cabeçalho

### Lista de conversas

- linha de cima: `displayLabel`
- linha de baixo: telefone formatado a partir de `canonicalPhone`
- se não houver `canonicalPhone`, mostrar `Telefone não identificado`
- nunca mostrar `providerConversationId` como substituto silencioso do telefone do cliente

### Cabeçalho da conversa selecionada

- título: `displayLabel`
- subtítulo: telefone formatado a partir de `canonicalPhone`
- se ausente: `Telefone não identificado`

## Painel comercial

O painel comercial deve usar exclusivamente `canonicalPhone` para:

- exibição de telefone;
- habilitação de ações dependentes de identidade;
- CRM match;
- criação de pré-orçamento.

Quando `identityStatus` for `unresolved` ou `conflict`:

- exibir estado leve de atenção;
- manter ações que não dependem de telefone confiável;
- bloquear apenas automações que exigem identidade segura.

## Identificador técnico

Se houver necessidade futura de exibir o identificador técnico, ele deve aparecer apenas:

- como informação separada;
- com rótulo explícito (`ID técnico da conversa`, por exemplo);
- nunca no lugar do telefone do cliente.

## Formatação de telefone

O formatter deve suportar telefone com DDI completo e não truncar números como:

- `5521981858541`
- `55219999102299`

A regra visual deve aceitar tanto formatos locais quanto internacionais, mas o armazenamento permanece canônico por dígitos.

## Persistência e migração

## Backfill completo

A migração deve incluir reprocessamento histórico.

Passos esperados:

1. carregar conversas já persistidas;
2. carregar mensagens já persistidas por conversa;
3. reconstruir a identidade usando o resolver central;
4. preencher `canonicalPhone`, `displayLabel`, status, origem e confiança;
5. preservar o melhor telefone já conhecido quando a nova leitura não trouxer evidência melhor;
6. limpar ou corrigir vínculos CRM incorretos quando a identidade mudar;
7. registrar contagens de:
   - identidades corrigidas;
   - identidades mantidas;
   - identidades em conflito;
   - identidades não resolvidas.

## Estratégia de execução

O backfill pode ser realizado em três modos complementares:

1. **script/manual admin** para reprocessar o estoque principal;
2. **on-demand** ao abrir ou sincronizar conversa antiga;
3. **reconciliação incremental** até que o legado esteja saneado.

A spec não exige um único mecanismo; exige que o resultado final seja um estoque consistente.

## Compatibilidade operacional durante rollout

Durante a transição:

- o sistema deve continuar lendo dados legados;
- o código novo deve preferir `canonicalPhone`;
- campos antigos só podem servir como fallback de compatibilidade temporária, nunca como fonte principal de regra de negócio;
- o rollout deve permitir implantação segura sem apagar histórico.

## Observabilidade

O sistema deve registrar informações suficientes para depuração sem expor detalhes brutos ao usuário final.

Registrar no backend, de forma estruturada:

- fonte escolhida para `canonicalPhone`;
- mudança de status da identidade;
- conflitos detectados;
- tentativas de CRM match bloqueadas por identidade fraca;
- correções realizadas por backfill.

Mensagens para o usuário devem permanecer em português e sem vazar payload cru do provider.

## Testes

### Resolver de identidade

- escolhe `chat.phone` quando presente e válido;
- prefere `senderPn`/`participant` real a `@lid`;
- aceita `remoteJid` apenas quando for JID telefônico real;
- ignora `@lid` como telefone;
- não usa número derivado/truncado como `canonicalPhone`;
- não promove contato citado/anexado como telefone da conversa;
- marca `unresolved` quando não há evidência suficiente;
- marca `conflict` quando duas evidências fortes divergem;
- preserva telefone anterior quando nova leitura traz evidência pior.

### Store/sync

- persiste novos campos de identidade sem perder compatibilidade;
- reprocessa identidade após sync de mensagens;
- não sobrescreve telefone bom com dado fraco;
- backfill corrige conversas antigas contaminadas;
- preserva `providerConversationId` para transporte.

### CRM match

- usa `canonicalPhone` como entrada principal;
- não faz auto-match por telefone quando identidade estiver em conflito;
- rematch funciona após correção de identidade por backfill.

### UI

- nunca mostra `providerConversationId` no lugar do telefone do cliente;
- mostra `displayLabel` na linha de cima;
- mostra telefone formatado a partir de `canonicalPhone` na linha de baixo;
- exibe estado apropriado quando telefone não está identificado;
- não trunca números com DDI completo.

## Critérios de sucesso

A iniciativa será considerada bem-sucedida quando:

- conversas com `@lid` ou ids opacos deixarem de contaminar o telefone do cliente;
- a inbox mostrar consistentemente nome em cima e telefone real embaixo;
- o sistema deixar de inventar ou truncar telefone na UI;
- CRM match usar uma identidade confiável e melhorar sua taxa de acerto;
- pré-orçamento e criação de lead deixarem de herdar telefone incorreto;
- o estoque histórico relevante for reprocessado com correção ou marcação segura de casos ambíguos.

## Riscos e trade-offs

- O provider pode continuar entregando payloads inconsistentes; por isso a resolução deve continuar conservadora.
- Alguns casos antigos podem permanecer `unresolved` mesmo após backfill, e isso é preferível a inventar um telefone incorreto.
- O rollout exige tocar múltiplos fluxos, mas isso é necessário porque o problema é sistêmico, não local.

## Fora de escopo por enquanto

- interface manual rica para resolver conflitos;
- merge automático de identidades entre múltiplas conversas do mesmo contato;
- redesign completo do modelo de dados do provider;
- mudança de provedor de WhatsApp.
