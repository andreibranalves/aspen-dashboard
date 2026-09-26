# Runbook do aspen-worker

O container `aspen-worker` roda no VPS ao lado do Evolution ([ADR 0013](adr/0013-worker-whatsapp-no-vps.md)). Um push em `master` que toque o worker dispara `.github/workflows/worker-deploy.yml`, que entra na tailnet e chama [`deploy/worker/deploy-worker.sh`](../deploy/worker/deploy-worker.sh) por SSH. O script builda `aspen-worker:<sha>` no VPS, sobe o container e espera o `/health`; se falhar, volta à imagem anterior.

O GitHub guarda só o acesso à tailnet e a chave de deploy, que só executa o script. Credenciais de banco e do Evolution ficam no VPS.

## Instalação

Uma vez, antes do primeiro deploy. Comandos no VPS rodam como root; `<sha>` é o commit de `master` com a versão atual dos arquivos.

1. Diretório, compose e segredos:

   ```bash
   install -d -m 700 /docker/aspen-worker
   curl -fsSL https://raw.githubusercontent.com/andreibranalves/aspen-dashboard/<sha>/deploy/worker/docker-compose.yml -o /docker/aspen-worker/docker-compose.yml
   install -m 600 /dev/null /docker/aspen-worker/.env
   ```

   Preencha `/docker/aspen-worker/.env` com `nano`. Valor com `$` vai entre aspas simples.

   ```text
   SENTRY_DSN=
   # Os mesmos valores do ambiente Production da Vercel:
   DATABASE_URL=
   EVOLUTION_API_KEY=
   EVOLUTION_INSTANCE=
   EVOLUTION_WEBHOOK_SECRET=
   QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=
   QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT=
   WORKER_WAKE_SECRET=
   # Próprios do worker:
   APP_ENV=production
   EXTERNAL_WRITES_ENABLED=1
   EVOLUTION_BASE_URL=http://evolution-api-zscx-api-1:8080
   ```

   `WORKER_WAKE_SECRET` sai de `openssl rand -hex 32` e vai também para a Vercel (passo 7). `EXTERNAL_WRITES_ENABLED=0` desliga todo envio do worker; `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0`, só os retornos. Mudança no `.env` vale depois de `ASPEN_WORKER_TAG=$(cat /docker/aspen-worker/current-tag) docker compose -f /docker/aspen-worker/docker-compose.yml up -d --wait`.

2. Script de deploy:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/andreibranalves/aspen-dashboard/<sha>/deploy/worker/deploy-worker.sh -o /usr/local/sbin/aspen-worker-deploy
   chmod 755 /usr/local/sbin/aspen-worker-deploy
   ```

3. Entrada SSH do deploy. O Tailscale SSH atende a porta 22 do IP da tailnet e ignora o `authorized_keys`, onde fica a restrição da chave. A porta 2222 da tailnet leva ao OpenSSH local:

   ```bash
   tailscale serve --bg --tcp 2222 tcp://localhost:22
   ```

   Essa porta leva ao mesmo sshd da porta 22 pública: com `PasswordAuthentication yes` ou `PermitRootLogin yes`, qualquer nó da tailnet pode tentar a senha do root por ela. Confira com `sshd -T | grep -Ei 'passwordauth|permitrootlogin'` e prefira `PasswordAuthentication no` e `PermitRootLogin prohibit-password`.

4. Chave de deploy, gerada no seu computador:

   ```bash
   ssh-keygen -t ed25519 -N '' -C aspen-worker-deploy -f aspen-worker-deploy
   ```

   No VPS, acrescente uma linha a `/root/.ssh/authorized_keys` com o conteúdo de `aspen-worker-deploy.pub`:

   ```text
   restrict,from="127.0.0.1,::1",command="/usr/local/sbin/aspen-worker-deploy" ssh-ed25519 AAAA… aspen-worker-deploy
   ```

   `from=` só aceita a chave vinda do `tailscale serve`; pela porta 22 pública ela é recusada.

5. Tailscale, no painel:
   - Na política da tailnet, acrescente `"tagOwners": {"tag:ci": ["autogroup:admin"]}`.
   - Em **Settings › Trust credentials**, gere uma credencial OAuth com escopo **Auth Keys** (escrita) e tag `tag:ci`.
   - O nó do CI é efêmero e some ao fim do job. Com a regra padrão que libera tudo, ele alcança a tailnet inteira enquanto roda. Para limitar, troque o grant padrão por grants explícitos e inclua `{"src": ["tag:ci"], "dst": ["100.125.165.20"], "ip": ["tcp:2222"]}`.

6. GitHub, em **Settings › Environments**, crie `aspen-worker` com **Deployment branches** restrito a `master`, e os secrets:
   - `TS_OAUTH_CLIENT_ID` e `TS_OAUTH_SECRET`, do cliente OAuth;
   - `WORKER_DEPLOY_SSH_KEY`, com o conteúdo de `aspen-worker-deploy` (a chave privada).

   Depois apague os dois arquivos da chave do seu computador.

7. Vercel, no ambiente Production: `WORKER_WAKE_URL=https://aspen-worker.srv1892439.hstgr.cloud/wake` e `WORKER_WAKE_SECRET` com o valor do `.env`. Sem elas, a Function não acorda o worker, o operador vê o aviso de wake e o trabalho espera a próxima varredura, em até 1 h. O Preview não recebe essas variáveis.

8. Webhook do Evolution, depois de um deploy com a rota `/webhook/evolution`. Sem `.env` com `EVOLUTION_WEBHOOK_SECRET` (o bearer que o Evolution já manda), o worker recusa todo webhook. Sem bearer, a rota responde 401:

   ```bash
   docker exec aspen-worker node -e "fetch('http://127.0.0.1:8080/webhook/evolution',{method:'POST'}).then((r)=>console.log(r.status))"
   ```

   Aponte o Evolution para o worker. O comando lê a chave da API e o cabeçalho atual sem imprimi-los:

   ```bash
   K=$(docker inspect evolution-api-zscx-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^AUTHENTICATION_API_KEY=//p')
   P=$(docker port evolution-api-zscx-api-1 8080/tcp | head -1); P=${P##*:}
   curl -s -H "apikey: $K" "http://127.0.0.1:$P/webhook/find/aspen-estamparia"      | jq '{webhook: {enabled: true, url: "http://aspen-worker:8080/webhook/evolution", headers: .headers, byEvents: false, base64: false, events: .events}}'      | curl -s -H "apikey: $K" -H 'Content-Type: application/json' -d @- "http://127.0.0.1:$P/webhook/set/aspen-estamparia"      | jq '{url, enabled, events}'
   unset K
   ```

   Confira que uma mensagem recebida aparece no Atendimento.

O primeiro deploy é o merge que traz o worker. Se a instalação ainda não estiver pronta, o job falha; conclua a instalação e use **Re-run jobs**.

## Operação

- Estado: `docker ps --filter name=aspen-worker`, `cat /docker/aspen-worker/current-tag` e `curl -s https://aspen-worker.srv1892439.hstgr.cloud/health`, que responde com o sha em execução.
- Logs: `docker logs --tail 100 aspen-worker`. Rotação em 10 MB × 5; erros vão ao Sentry.
- Webhook: o Evolution chama `http://aspen-worker:8080/webhook/evolution` pela rede Docker. O worker grava mensagem, recibo e efeito, responde e aplica os efeitos em seguida; efeito que falha fica pendente para o ciclo. Enquanto o worker está fora, o Evolution reenvia o webhook com backoff.
- Ciclo: o worker varre ao subir, a cada `/wake`, depois de cada webhook e no próximo vencimento registrado no banco, no máximo a cada hora. Reiniciar o container força uma varredura. Ao parar, ele não começa outro envio e espera o passo em curso, por até 90 s.
- Rollback: **Actions › Worker deploy › Run workflow**, com o sha de uma imagem que está no VPS (`docker image ls aspen-worker`; ficam as 5 mais novas). Não há rebuild.
- Mudança no compose ou no script: reinstale como nos passos 1 e 2 e rode `ASPEN_WORKER_TAG=$(cat /docker/aspen-worker/current-tag) docker compose -f /docker/aspen-worker/docker-compose.yml up -d --wait`.
- Rotação da chave de deploy: gere outra, troque a linha no `authorized_keys` e o secret `WORKER_DEPLOY_SSH_KEY`.
- O projeto `/docker/evolution-api-zscx` pertence à Hostinger: o worker só entra na rede dele. Não edite nem reinicie esse projeto para operar o worker.
