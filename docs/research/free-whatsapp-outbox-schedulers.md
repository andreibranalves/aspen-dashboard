# Research: schedulers gratuitos para a outbox de WhatsApp

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../AGENTS.md) e [`docs/release-lanes.md`](../release-lanes.md).

**Pesquisa:** 2026-08-20. Somente documentação oficial/primária.

## Summary

**Recomendação: Upstash QStash, `*/2 * * * *`, `POST`, `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`, zero retries do QStash e redação do header.** É a opção sem código mais simples: 720 disparos/dia cabem na cota gratuita de 1.000, 2 minutos coincidem com a reconciliação local de 120 s, e o timeout gratuito de 15 min cobre a função. O processamento durável já controla leases, reconciliação e retries; retries adicionais do scheduler só aumentariam concorrência e consumo.

Cloudflare Workers Cron Triggers é a melhor alternativa quando **1 minuto** for obrigatório: cota ampla e secret não recuperável, mas exige manter/deployar um Worker mínimo. cron-job.org parece ainda mais simples, porém seu timeout de 30 s é menor que o orçamento local de 45 s; GitHub Actions não serve como scheduler operacional confiável.

## Endpoint local inspecionado

- `api/_app/routes.ts`: rota única `quotation-delivery-worker` registrada no dispatch.
- `api/_shared/auth.ts`: rota de máquina ignora deliberadamente sessão web; não fica pública, pois a autenticação específica ocorre no handler.
- `api/_modules/quotation-delivery-worker.ts`: aceita somente `GET`/`POST`; exige `Authorization: Bearer ...`; retorna `401` sem credencial válida, `200` no sucesso e `503` em falha segura. Batch fixo: 3.
- `api/_shared/machine-auth.ts`: `CRON_SECRET` mínimo de 32 bytes, parsing estrito de Bearer e comparação constant-time. Nenhum segredo foi lido ou reproduzido.
- `api/_modules/quotation-delivery-outbox.ts`: orçamento de processamento de 45 s, lease de 90 s, reconciliação de 120 s. O repositório PostgreSQL faz claim/lease; chamadas repetidas são compatíveis com o desenho da outbox.
- `api/_shared/rate-limit.ts`: rota do worker não possui limite específico; cadência de 1–5 min não conflita com o limiter atual.
- `tests/unit/quotation-delivery-worker.test.ts`: cobre segredo ausente/curto/incorreto, `GET`, batch limitado e resposta `503` segura.

## Comparação

| Opção | Frequência mínima | Free tier relevante | Bearer | Confiabilidade/limitações | Esforço | Veredito |
|---|---:|---|---|---|---|---|
| **Upstash QStash** | 1 min (`* * * * *`) | 1.000 mensagens/dia; 10 schedules; resposta até 15 min | Sim, `Upstash-Forward-Authorization` vira `Authorization`; pode redigir `header[Authorization]` nos logs/API | At-least-once: duplicata rara possível. Padrão: 3 retries; cada tentativa conta na cota atual. Schedule pode levar até 60 s para ativar | Baixo: uma schedule, sem código | **Escolha: 2 min, retries=0** |
| **Cloudflare Workers Cron Triggers** | 1 min | 100.000 requests/dia; 5 triggers; cron com wall time até 15 min, 10 ms CPU no Free | Sim via `fetch`; secret binding criptografado e valor não fica visível após criação | Docs mostram histórico/logs e propagação de alterações até 15 min, mas não prometem entrega at-least-once. Próximo tick recupera falhas | Médio: conta, Worker mínimo, secret, deploy | Melhor alternativa para 1 min |
| **cron-job.org** | 1 min; até 60/h/job | Serviço gratuito | Sim, headers arbitrários | Sem garantia de pontualidade; leves atrasos; pode desabilitar após >25 falhas consecutivas. **Timeout 30 s**, inferior aos 45 s locais | Muito baixo: formulário web | Não recomendado para este handler longo |
| **GitHub Actions `schedule`** | 5 min | Público: runners padrão grátis. Privado Free: 2.000 min/mês | Sim via Actions Secret + `curl` | Pode atrasar e até descartar jobs sob carga; somente default branch; público inativo desabilita após 60 dias. Em repo privado, execução a cada 5 min tende a exceder 2.000 min/mês devido à cobrança por tempo de runner | Médio: workflow no repo | Rejeitar para operação contínua |
| **Google Cloud Scheduler** | 1 min | 3 jobs/mês grátis por billing account; exige billing account | Headers HTTP customizáveis, inclusive Bearer estático quando OAuth/OIDC não é configurado | At-least-once; duplicatas raras; retries exponenciais configuráveis; não sobrepõe execução anterior. Mais IAM/API/billing | Alto | Robusto, porém complexidade sem benefício aqui |
| **Vercel Cron** | Hobby: 1/dia; Pro: 1 min | Hobby não atende 1–5 min | Nativo: envia `CRON_SECRET` como Bearer | Hobby tem precisão por hora (±59 min); frequência necessária exige Pro | Baixo, mas pago para requisito | Excluído do conjunto gratuito viável |

## Recomendação operacional

1. Criar **uma** schedule QStash com `POST https://<host>/api/quotation-delivery-worker` e cron `*/2 * * * *` (UTC é irrelevante para intervalo).
2. Encaminhar `Authorization: Bearer <CRON_SECRET>` via mecanismo `Upstash-Forward-Authorization`; nunca colocar segredo na URL, body, repositório ou relatório.
3. Configurar **0 retries** no QStash. Razões: a chamada periódica seguinte ocorre em 2 min; outbox já possui retry/reconciliação; o QStash é at-least-once mesmo sem retries explícitos; retries contam na cota e podem sobrepor uma execução lenta.
4. Configurar `Upstash-Redact-Fields: header[Authorization]`. Manter o mesmo segredo forte já esperado pelo app (≥32 bytes) em Vercel e no schedule; rotacionar ambos juntos.
5. Monitorar respostas: `200` é sucesso mesmo com `remaining: true`; `401` indica configuração/rotação incorreta; `503` deve ser recuperado pelo próximo tick. A 2 min, backlog é drenado em lotes de 3; se volume sustentado superar isso, trocar para Cloudflare a cada 1 min ou aumentar capacidade do worker mediante decisão separada — não mascarar com retries do scheduler.
6. Fazer um disparo manual sem registrar headers e confirmar `200`. Depois, observar execuções e backlog por pelo menos um ciclo de reconciliação.

**Por que não 1 min no QStash:** 1.440 disparos/dia excedem 1.000/dia antes de duplicatas. **Por que 2 min:** 720/dia deixa margem de 280 e atende exatamente a reconciliação de 120 s. **Por que não 5 min:** funciona e usa 288/dia, mas adiciona até 3 min de latência desnecessária à reconciliação.

## Findings

1. **QStash encaixa sem alteração de código.** Schedules aceitam cron por minuto; headers prefixados são encaminhados; Free oferece 1.000 mensagens/dia, 10 schedules e resposta de 15 min. [Schedules](https://upstash.com/docs/qstash/features/schedules) · [Create Schedule](https://upstash.com/docs/qstash/api-reference/schedules/create-a-schedule) · [Pricing](https://upstash.com/pricing/qstash)
2. **Desativar retries explícitos reduz risco e custo.** QStash entrega at-least-once e pode duplicar raramente; respostas não-2xx têm 3 retries por padrão, e cada tentativa conta como mensagem segundo a página atual de preços. [At-least-once](https://upstash.com/docs/qstash/features/at-least-once) · [Retry](https://upstash.com/docs/qstash/features/retry) · [Pricing](https://upstash.com/pricing/qstash)
3. **Cloudflare é tecnicamente forte para 1 min.** Cron aceita `* * * * *`; Free oferece 100.000 requests/dia e 5 triggers. `fetch` aceita headers, e Secret bindings não revelam o valor depois da criação. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Limits](https://developers.cloudflare.com/workers/platform/limits/) · [Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
4. **cron-job.org tem incompatibilidade de timeout.** É gratuito, executa a cada minuto e aceita headers arbitrários, mas encerra a conexão após 30 s e não garante pontualidade. O handler local reserva até 45 s. [FAQ](https://cron-job.org/en/faq/) · [Termos](https://cron-job.org/en/tos/)
5. **GitHub Actions é inadequado para polling crítico.** Menor intervalo: 5 min; GitHub documenta atrasos e descarte sob carga, default branch e desativação após 60 dias sem atividade em repositórios públicos. Private Free oferece 2.000 min/mês. [Scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) · [Billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
6. **Google e Vercel não melhoram o compromisso.** Google oferece 3 jobs grátis e robustez at-least-once, mas requer billing/IAM; Vercel Hobby só roda diariamente, embora a autenticação nativa seja compatível. [Google pricing](https://cloud.google.com/scheduler/pricing) · [Google overview](https://docs.cloud.google.com/scheduler/docs/overview) · [Google HTTP target](https://cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs) · [Vercel usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Vercel auth](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

## Sources

- **Kept:** documentação oficial de cron-job.org, GitHub, Cloudflare, Upstash, Google Cloud e Vercel — limites, autenticação, retries e garantias diretamente dos fornecedores.
- **Dropped:** blogs comparativos, agregadores de “free cron”, fóruns e páginas SEO — dados secundários ou limites potencialmente desatualizados.
- **Dropped:** EasyCron/UptimeRobot e similares — nenhuma vantagem comprovada por fonte primária atual sobre QStash/cron-job.org para header Bearer, timeout e cadência exigidos.

## Gaps

- Nenhum fornecedor gratuito oferece SLA citado para esta carga. QStash documenta at-least-once, não exactly-once; o desenho local com claims/leases continua essencial.
- Não foi realizado cadastro nem disparo real contra produção; cotas e comportamento foram validados documentalmente, sem expor configuração ou segredo.
- A capacidade efetiva é 3 claims por chamada. Volume real da outbox não foi medido; 2 min suporta teoricamente até 2.160 claims/dia quando cada execução usa o batch completo, sujeito ao tempo de transporte e backlog.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Findings concretos incluem caminhos locais api/_modules/quotation-delivery-worker.ts, api/_shared/machine-auth.ts, api/_modules/quotation-delivery-outbox.ts e severidade implícita/decisão por opção; fontes primárias vinculadas."
    }
  ],
  "changedFiles": [
    "research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search/fetch_content em fontes oficiais; leitura estática dos arquivos locais",
      "result": "passed",
      "summary": "Limites, autenticação, retries e fluxo local verificados sem ler valores de ambiente."
    },
    {
      "command": "npm test / npm run verify:fast",
      "result": "not-run",
      "summary": "Somente relatório; nenhum código alterado e shell indisponível nesta função de pesquisa."
    }
  ],
  "validationOutput": [
    "QStash a cada 2 min = 720 mensagens/dia, abaixo da cota Free de 1.000/dia.",
    "Endpoint aceita GET/POST e exige Bearer com CRON_SECRET de pelo menos 32 bytes.",
    "Timeout cron-job.org de 30 s é inferior ao orçamento local de processamento de 45 s."
  ],
  "residualRisks": [
    "Sem teste ponta a ponta contra produção.",
    "QStash mantém semântica at-least-once; duplicatas raras permanecem possíveis.",
    "Cotas/preços de terceiros podem mudar; revisar antes da implantação."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adicionado somente research.md com comparação e recomendação; nenhum código ou teste alterado.",
  "reviewFindings": [
    "high: cron-job.org - timeout de 30 s pode encerrar chamada antes do orçamento local de 45 s.",
    "high: GitHub Actions - schedules podem atrasar ou ser descartados; inadequado para worker operacional.",
    "medium: QStash - 1 min excede cota Free; usar 2 min e retries=0.",
    "no blockers para a recomendação QStash em 2 min"
  ],
  "manualNotes": "noStagedFiles=true significa que nenhuma operação de staging foi executada; git status não pôde ser consultado com as ferramentas disponíveis."
}
```
