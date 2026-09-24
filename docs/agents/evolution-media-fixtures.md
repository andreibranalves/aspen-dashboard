# Fixtures da Evolution instalada para #296 e #308

Estas fixtures comprovam o contrato da instância instalada. A documentação pública não comprova a versão, a modalidade nem o formato efetivo da resposta. Capture somente após autorização operacional, usando uma conversa e arquivos de teste controlados pelo operador.

1. Registre a versão, modalidade e eventos ativos do webhook, incluindo `MESSAGES_UPSERT` e `MESSAGES_UPDATE`.
2. Envie à conversa de teste uma imagem PNG, um PDF e um áudio OGG/Opus pequenos. Capture um `messages.upsert` recebido de cada tipo, um eco de saída e um `messages.update` com recibo.
3. Para cada mídia, capture a forma da requisição e da resposta de `POST /chat/getBase64FromMediaMessage/{instance}` com `convertToMp4: false`. Registre MIME, tamanho decodificado e estado de expiração. Substitua o campo base64 por `"[REMOVIDO]"` antes de salvar.
4. Envie imagem e PDF de teste por `POST /message/sendMedia/{instance}` e registre os nomes dos campos, tipos, aceite e formato do ID retornado. Remova o conteúdo base64.
5. Consulte duas páginas de `findMessages` e registre cursores/parâmetros, IDs sintéticos e limites. Se não houver segunda página, registre essa limitação.
6. Grave apenas JSON saneado em `tests/fixtures/evolution-installed/`. Troque instância, host, telefone, JID, IDs, nomes, legendas, texto e URLs por valores sintéticos consistentes; remova chaves, tokens, cookies e cabeçalhos de autenticação. Faça revisão humana do diff antes de versionar.

`scripts/capture-evolution-fixtures.mjs` automatiza os passos 1, 2, 3, 5 e 6 só para a conversa de teste (`FIXTURE_PHONE`) e aborta se sobrar telefone, host, chave, URL ou base64 no JSON. O passo 4 só roda com `--send-media`, porque envia mensagem real:

```bash
FIXTURE_PHONE=<ddi+ddd+numero> DOTENV_CONFIG_PATH=$HOME/.config/aspen-dashboard/.env.local \
  node scripts/capture-evolution-fixtures.mjs --since-hours 6 [--send-media]
```

Não use mensagens de clientes reais nem salve payloads brutos no checkout. A captura não autoriza enviar mensagens ou consultar dados reais fora da conversa de teste aprovada.
