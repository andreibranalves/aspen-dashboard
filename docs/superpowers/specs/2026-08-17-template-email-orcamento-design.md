# Template de e-mail de orçamento

## Contexto

O envio de orçamento por e-mail usa atualmente assunto, saudação, mensagem, botão e assinatura definidos diretamente no backend.
O operador não possui uma tela para alterar esse conteúdo.
A configuração deve ficar em Comunicação e preservar o envio atual até alguém salvar uma alteração.

## Objetivo

Permitir que o operador configure um único modelo global para todos os futuros e-mails de orçamento.
A tela deve oferecer edição controlada, preview fiel e ativação explícita por salvamento.
O envio deve continuar controlando o link público, o PDF anexado, o remetente e a integração com a Resend.

## Escopo

O primeiro escopo cobre somente e-mails de orçamento.
O modelo será global e não variará por usuário, cliente, vendedor ou orçamento.
O diálogo de envio continuará solicitando apenas o destinatário.
O assunto e o corpo não poderão ser alterados durante um envio individual.

## Fora do escopo

- Templates genéricos para outros tipos de e-mail.
- Unificação de templates de e-mail e fluxos de WhatsApp.
- Editor HTML ou editor de texto rico.
- Imagens, fontes, cores ou estrutura visual configuráveis.
- Histórico ou versionamento de modelos.
- Cópia do conteúdo renderizado em cada registro de envio.
- Envio de teste pela tela de configuração.
- Configuração de remetente, reply-to, credenciais ou domínio Resend.
- Personalização por envio.

## Navegação

A página Comunicação ganhará uma aba chamada `E-mail de orçamento`.
Ela ficará ao lado das abas existentes de Fluxos WhatsApp, Biblioteca de mídias, Histórico de envios e Canais.
A aba Canais continuará responsável pela configuração operacional dos canais, enquanto a nova aba tratará somente do conteúdo.

## Experiência da tela

No desktop, o formulário ficará à esquerda e o preview ao vivo ficará à direita.
No mobile, o formulário aparecerá primeiro e o preview ficará abaixo.

O formulário terá os seguintes campos:

- Assunto.
- Saudação.
- Mensagem principal.
- Texto do botão.
- Assinatura.

Assunto, mensagem principal e texto do botão serão obrigatórios.
Saudação e assinatura poderão ficar vazios.
Todos os campos aceitarão texto simples.
Quebras de linha serão renderizadas como parágrafos seguros.
HTML digitado será mostrado como texto e nunca será executado.

A tela oferecerá botões para inserir as variáveis válidas na posição atual do cursor.
O preview será atualizado enquanto o operador digita.
O preview usará `Maria Silva` e `ORC-20260001` como dados fictícios fixos.
O botão do preview não navegará.
O PDF aparecerá apenas como indicação visual de anexo e nenhum arquivo será gerado.

A ação `Restaurar modelo padrão` exigirá confirmação.
Ela reporá o conteúdo original somente no formulário e não salvará automaticamente.
A ação `Salvar alterações` validará e ativará o modelo para os próximos envios.

A tela indicará quando existirem alterações não salvas.
Ao trocar de aba ou sair da página com alterações pendentes, o operador deverá escolher entre continuar editando e descartar as alterações.
Os campos terão rótulos associados e serão operáveis por teclado.
Quando a validação falhar, o foco será levado ao primeiro campo inválido.

## Variáveis

O primeiro escopo aceitará apenas:

- `{{nome_cliente}}`.
- `{{numero_orcamento}}`.

As variáveis poderão ser usadas em qualquer campo.
O link do botão e o PDF não serão variáveis editáveis.
Qualquer token desconhecido no formato `{{...}}` bloqueará o salvamento.
A mensagem de validação identificará o token incorreto.
Tokens desconhecidos nunca serão substituídos silenciosamente por texto vazio.

## Limites

- Assunto: 200 caracteres.
- Saudação: 500 caracteres.
- Mensagem principal: 4.000 caracteres.
- Texto do botão: 80 caracteres.
- Assinatura: 500 caracteres.

Os limites serão validados no frontend para resposta imediata e novamente no backend como autoridade final.
Espaços externos serão normalizados sem remover quebras de linha internas relevantes.

## Persistência

O singleton `app_settings` receberá uma coluna JSONB não nula chamada `quotation_email_template`.
A migration definirá como valor padrão o modelo atualmente fixado no código.
Desse modo, o comportamento não mudará após a implantação enquanto nenhum operador salvar uma personalização.

O documento persistido seguirá este contrato:

```ts
interface QuotationEmailTemplate {
  subject: string;
  greeting: string;
  message: string;
  button_label: string;
  signature: string;
}
```

O salvamento substituirá atomicamente o documento global.
O endpoint será separado da API geral de Configurações para evitar que uma tela sobrescreva campos pertencentes à outra.
A implementação não criará tabela própria, histórico, versões ou registro por usuário.

## API

A aplicação terá um endpoint autenticado com os seguintes métodos:

### `GET /api/quotation-email-template`

Retorna o modelo global efetivo.
Se o singleton ainda não tiver sido materializado, retorna o modelo padrão atual.
Nunca retorna credenciais ou configuração da Resend.

### `PUT /api/quotation-email-template`

Recebe o documento completo do modelo.
Valida tipos, campos obrigatórios, limites e variáveis.
Rejeita chaves ou tokens desconhecidos.
Persiste o documento somente quando toda a validação passar.
Retorna o modelo normalizado salvo.

Erros de validação usarão HTTP `400` e mensagens por campo em português.
Falhas de persistência usarão uma mensagem genérica e não exporão detalhes do banco.
Métodos não aceitos retornarão HTTP `405` com o cabeçalho `Allow` correto.
As três tabelas de rotas do projeto serão mantidas sincronizadas.

## Renderização compartilhada

Um módulo puro e compartilhado será a única autoridade para:

- Modelo padrão.
- Contrato e limites.
- Normalização.
- Validação de tokens.
- Substituição das variáveis.
- Escape de HTML.
- Renderização do assunto.
- Renderização do HTML.
- Renderização do texto simples.

A tela usará esse módulo para o preview.
O backend usará o mesmo módulo para o envio real.
Isso impedirá divergência entre o conteúdo exibido e o conteúdo entregue.

O sistema continuará controlando a estrutura visual do e-mail.
O botão continuará apontando para o link público do orçamento.
O PDF continuará sendo anexado automaticamente pela URL HTTPS validada.
A versão em texto simples será gerada automaticamente a partir dos mesmos campos.

## Fluxo de envio

Antes de chamar a Resend, o endpoint de envio carregará o modelo global efetivo.
Ele substituirá `{{nome_cliente}}` e `{{numero_orcamento}}` pelos dados da revisão emitida.
O assunto, o HTML e o texto simples renderizados serão passados ao transporte.
O remetente e o reply-to continuarão vindo das variáveis de ambiente.
A idempotência existente continuará baseada na tentativa de envio.

Uma falha ao carregar ou validar a configuração bloqueará o envio.
O sistema não usará silenciosamente um modelo diferente do configurado.
O cliente receberá uma mensagem genérica em português.
Logs não incluirão destinatário, conteúdo renderizado, PDF, segredo, erro bruto do banco ou resposta bruta do provider.

E-mails já enviados permanecerão imutáveis.
O histórico continuará armazenando somente os metadados de entrega já previstos.

## Estados e falhas da interface

Durante o carregamento, o formulário e as ações de edição ficarão indisponíveis.
Se o carregamento falhar, a tela mostrará uma mensagem segura e a ação `Tentar novamente`.
A tela não oferecerá edição sobre um estado desconhecido.

Se o salvamento falhar, o conteúdo digitado permanecerá no formulário.
O modelo ativo anterior continuará válido.
A tela mostrará erro sem descartar o trabalho do operador.

Após um salvamento bem-sucedido, o formulário adotará a resposta normalizada da API como novo estado limpo.
Um aviso de sucesso confirmará que os próximos envios usarão o modelo salvo.

## Segurança e privacidade

Todo conteúdo configurável será tratado como texto não confiável.
O renderizador escapará HTML antes de produzir a mensagem final.
Somente os dois tokens permitidos serão interpolados.
O endpoint permanecerá atrás da autenticação e do rate limiting da fronteira implantada.

A configuração não armazenará credenciais, destinatários ou conteúdo por envio.
O preview não utilizará dados reais de clientes.
Mensagens e logs não exporão dados pessoais ou detalhes internos.

## Verificação

### Unidade

- Modelo padrão reproduz exatamente o e-mail atual.
- Campos obrigatórios e limites são validados.
- Tokens válidos são substituídos.
- Tokens desconhecidos são rejeitados.
- HTML é escapado.
- Quebras de linha viram parágrafos seguros.
- Assunto, HTML e texto simples são renderizados corretamente.
- Saudação e assinatura vazias não geram blocos vazios incorretos.

### API e persistência

- `GET` retorna o padrão sem linha materializada.
- `PUT` persiste e retorna o documento normalizado.
- Payload inválido não altera o modelo ativo.
- Falha de banco retorna mensagem segura.
- Métodos não permitidos retornam `405`.
- A migration preserva o comportamento atual.

### Interface

- Carregamento e tentativa novamente.
- Preview com dados fictícios.
- Inserção de variável no cursor.
- Erros por campo e foco no primeiro erro.
- Restauração do padrão sem salvamento automático.
- Salvamento e estado de sucesso.
- Proteção ao sair com alterações não salvas.
- Layout responsivo e operação por teclado.

### Integração do envio

- O envio usa o modelo ativo.
- O link público e o PDF permanecem automáticos.
- O transporte recebe HTML e texto simples.
- Falha de configuração impede a chamada à Resend.
- Idempotência e estados de entrega existentes não sofrem regressão.
- O E2E usa transporte controlado e nunca envia e-mail real.

## Critérios de aceite

1. O operador acessa `Comunicação > E-mail de orçamento` e vê o modelo atual.
2. O operador altera os campos e vê um preview fiel com dados fictícios.
3. O sistema impede campos obrigatórios vazios, limites excedidos e tokens desconhecidos.
4. Restaurar o padrão não altera o modelo ativo antes de salvar.
5. Salvar ativa o conteúdo para todos os próximos e-mails de orçamento.
6. Um envio posterior usa o assunto e o corpo configurados com as duas variáveis resolvidas.
7. Link público, botão estrutural, PDF, remetente e reply-to continuam controlados pelo sistema.
8. E-mails enviados anteriormente não mudam e nenhum conteúdo adicional é retido no histórico.
9. Falhas preservam o texto digitado e não expõem dados sensíveis.
10. Testes automatizados comprovam validação, renderização, persistência, interface e integração sem chamar a Resend real.
