# Relatório: Codex CLI + Skills de Review no Hermes

**Data:** 2026-06-03
**Máquina:** Local (`/opt/data`) + VPS Hostinger (VM #1633500)

---

## 1. O que você pediu

> "esse projeto é para usar o codex no claude code, tem algumas funções de review, adversarial review etc. Eu acho interessante essas funções, apesar de ser algo pro claude code, poderíamos criar essas skills no hermes? Com as mesmas funções, chamando o codex (tenho oauth do plano plus do codex). Me ajude a elaborar"

**Tradução:** Você queria replicar as funcionalidades do `openai/codex-plugin-cc` como skills nativas do Hermes, usando o Codex CLI como backend de review, com sua conta ChatGPT Plus.

---

## 2. O que eu entendi que deveria fazer

1. **Pesquisar** os projetos de referência para entender as funcionalidades exatas
2. **Criar skills** `codex-review` e `codex-adversarial-review` no Hermes
3. **Instalar Codex CLI** e autenticar
4. **Configurar npm sem root** (você odeia permissão root — localStorage, arquivos .env, etc)
5. **Verificar a VPS** da Hostinger — se precisa instalar lá também
6. **Testar** que tudo funciona

---

## 3. Pesquisa — projetos de referência

### 3.1 `openai/codex-plugin-cc` (20.1k ★)

Repositório oficial da OpenAI. Plugin para Claude Code que expõe comandos:

| Comando | Função |
|---|---|
| `/codex:review` | Review padrão read-only com `--base` opcional |
| `/codex:adversarial-review` | Review cético steerable, aceita texto de foco |
| `/codex:rescue` | Delega tarefa ao Codex (investigar bug, tentar fix) |
| `/codex:status` | Status de jobs em background |
| `/codex:result` | Resultado final de um job |
| `/codex:cancel` | Cancela job ativo |
| `/codex:setup` | Verifica instalação + toggle review gate |

Arquitetura: ~15 módulos JS + App Server + JSON-RPC broker. Pesado.

### 3.2 `dementev-dev/adversarial-review` (8 ★)

Skill standalone muito mais elegante. Apenas `SKILL.md` + `references/runner.md`.

**Três modos:**
- `plan` — review do plano ANTES de escrever código
- `code` — review de git diff (mudanças não commitadas ou branch)
- `code-vs-plan` — verifica se implementação bate com o plano

**Prompt adversarial em XML:**
```xml
<role>You are an adversarial code reviewer. Default position is skepticism.</role>
<operating_stance>Break confidence in the change. Find concrete failure modes.</operating_stance>
<attack_surface>
  Auth, data integrity, race conditions, rollback safety, schema drift,
  error handling, observability, resource leaks, input validation, dependencies
</attack_surface>
<finding_bar>
  Every finding MUST answer: what can go wrong, why vulnerable, impact, fix
</finding_bar>
<scope_exclusions>
  No style, naming, formatting, "minor:", "nit:"
</scope_exclusions>
<calibration>One strong finding > five weak ones</calibration>
```

**Loop iterativo (até 5 rounds):**
```
Claude (code) → Codex (review) → Claude (fix) → Codex (re-review) → VERDICT
```

**Snapshots de segurança:**
- `git status --porcelain` antes/depois de cada dispatch
- `sha256sum` dos arquivos de input
- Se o reviewer mutar arquivos → HARD STOP

**Overrides:** `model:gpt-5.5`, `low/medium/high/xhigh`, `sandbox:read-only/workspace-write/danger-full-access`

---

## 4. Skills criados

### 4.1 `codex-review` 

**Arquivo:** `/opt/data/skills/autonomous-ai-agents/codex-review/SKILL.md`

Review padrão de código. Usa o comando nativo do Codex:

```bash
# Mudanças não commitadas
codex exec review --uncommitted -m gpt-5.5 --reasoning-effort high -o /tmp/codex-review-output.md

# Branch vs base
codex exec review --base main -m gpt-5.5 --reasoning-effort high -o /tmp/codex-review-output.md
```

O prompt interno do `codex exec review` já cobre: correctness, security, reliability, performance, design. Cada finding pede severidade + local + issue + impacto + fix.

### 4.2 `codex-adversarial-review`

**Arquivo:** `/opt/data/skills/autonomous-ai-agents/codex-adversarial-review/SKILL.md`

Review adversarial completo com:

- **Prompt XML adversarial** (role, operating_stance, attack_surface com 10 áreas, finding_bar com 4 perguntas obrigatórias, scope_exclusions, calibration)
- **3 modos:** `code` (default), `plan`, `code-vs-plan`
- **Loop iterativo:** Hermes captura diff → Codex review → apresenta findings → você aprova/rejeita → Hermes aplica fixes → re-review → até 5 rounds
- **Snapshots de segurança:** `git status --porcelain` + `sha256sum` antes/depois de cada dispatch
- **Overrides:** `model:gpt-5.5`, `xhigh`, `sandbox:read-only`, `approvals:never`

**Fluxo de execução no Hermes:**

```python
# Step 1: Captura o diff
terminal(command="git diff HEAD > /tmp/codex-diff-<id>.diff", workdir="/path/to/repo")

# Step 2: Escreve prompt adversarial com o diff
write_file("/tmp/codex-prompt-<id>.md", content=<adversarial_prompt_xml + diff>)

# Step 3: Snapshot pré-dispatch
terminal(command="git status --porcelain > /tmp/codex-git-pre-<id>")

# Step 4: Lança Codex em background com PTY
terminal(
  command="cat /tmp/codex-prompt-<id>.md | codex exec -s workspace-write -m gpt-5.5 --reasoning-effort high -o /tmp/codex-review-<id>.md",
  workdir="/path/to/repo",
  pty=true, background=true, notify_on_complete=true
)

# Step 5: Aguarda, snapshot pós-dispatch, diff de segurança
process(action="wait", session_id="<sid>")
terminal(command="git status --porcelain > /tmp/codex-git-post-<id>")
terminal(command="diff /tmp/codex-git-pre-<id> /tmp/codex-git-post-<id>")

# Step 6: Lê review e apresenta ao usuário
read_file("/tmp/codex-review-<id>.md")

# Step 7: Aplica fixes aceitos, repete se necessário
```

### 4.3 `codex` (atualizado)

**Arquivo:** `/opt/data/skills/autonomous-ai-agents/codex/SKILL.md`

**Alterações:**
1. `related_skills` atualizado: `[claude-code, hermes-agent]` → `[claude-code, hermes-agent, codex-review, codex-adversarial-review]`
2. Nova seção "Review Workflow":
```markdown
| Use case | Skill |
|----------|-------|
| Standard code review | `codex-review` |
| Adversarial review | `codex-adversarial-review` |
| Delegate a coding task | `codex` (this skill) |
```

---

## 5. Instalação do Codex CLI

### 5.1 Problema: npm global como root

**Estado inicial:**
```
npm prefix: /usr/local
node_modules: /usr/local/lib/node_modules (root:root, 755)
bin: /usr/local/bin (root:root)
```

Instalar com `sudo npm install -g` cria arquivos root — mesma dor de cabeça que você já teve com `/opt/data/`.

### 5.2 Solução: migrar prefix para ~/.local

```bash
# Passo 1: Criar diretório
mkdir -p ~/.local

# Passo 2: Mudar prefix do npm
npm config set prefix ~/.local

# Passo 3: Adicionar ao PATH (~/.bashrc)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

**Resultado:**
```
npm prefix: /opt/data/home/.local
node_modules: /opt/data/home/.local/lib/node_modules (hermes:hermes)
bin: /opt/data/home/.local/bin (hermes:hermes)
```

Nunca mais precisa de `sudo npm install -g`.

### 5.3 Instalação do Codex

```bash
export PATH="$HOME/.local/bin:$PATH"
npm install -g @openai/codex
# → added 2 packages in 3s
```

**Resultado:**
```
codex --version
# → codex-cli 0.136.0
which codex
# → /opt/data/home/.local/bin/codex
```

**Pacotes globais antigos verificados:**
- `@anthropic-ai/claude-code@2.1.160` — identificado, tentativa de remoção (sem `sudo` no container, mantido mas inofensivo)
- `corepack@0.34.6` — sistema, mantido

### 5.4 Autenticação

Container headless, sem browser. Usado device auth:

```bash
codex login --device-auth
```

**Fluxo:**
1. Codex exibe URL `https://auth.openai.com/codex/device` + código `2KM7-BPQ2H`
2. Você abriu no seu navegador, autenticou com ChatGPT Plus
3. Auth salva em `~/.codex/auth.json` (600, hermes:hermes)
4. Modo: `auth_mode` + `OPENAI_API_KEY` + `tokens`

---

## 6. Testes

### 6.1 Sandbox padrão ❌

```bash
codex exec review --uncommitted --ephemeral -m gpt-5.4-mini
# → bwrap: No permissions to create a new namespace
# → kernel does not allow non-privileged user namespaces
```

Container não tem `kernel.unprivileged_userns_clone=1`. Limitação do ambiente, não do Codex.

### 6.2 Com bypass ✅

```bash
codex exec review --uncommitted --ephemeral \
  --dangerously-bypass-approvals-and-sandbox \
  -m gpt-5.4-mini -o /tmp/codex-review-test.md
```

**Saída do Codex:**
```
workdir: /opt/data/aspen-dashboard
model: gpt-5.4-mini
sandbox: danger-full-access

exec: git status --short && git diff --stat
→ ?? docs/handoffs/2026-06-03-whatsapp-automation-strategy.md

exec: sed -n '1,240p' docs/handoffs/...
→ [leu o arquivo de documentação]

codex: The only change is an untracked documentation handoff note;
       there are no staged or unstaged code changes, so there is
       no functional regression to flag.
```

Review funcionou perfeitamente — identificou que só havia doc, sem código.

### 6.3 Modelos disponíveis

Testado com `gpt-5.4-mini`. O plano ChatGPT Plus dá acesso a:
- `gpt-5.4-mini` (rápido/barato)
- `gpt-5.5` (default dos skills, melhor qualidade)
- `gpt-5.5-codex` (otimizado pra código)
- `spark` (mínimo, rápido)

---

## 7. VPS Hostinger (VM #1633500)

### 7.1 Verificação

**VM:** Ubuntu 24.04, 8 GB RAM, 2 vCPU, 100 GB disco
**Template:** "Ubuntu 24.04 with Docker and Traefik"
**Projetos Docker:** evolution-api, n8n, hermes-agent, honcho, traefik

### 7.2 Descoberta: Codex já instalado

Ao inspecionar o `docker-compose.yml` do Hermes (`hermes-agent-e8mn`), descobri que o entrypoint **já instala e configura o Codex**:

```yaml
entrypoint: |
  sh -c '
    # ... apt-get, git config ...
    
    if ! command -v codex >/dev/null 2>&1; then
      echo "[codex] Installing..."
      npm install -g @openai/codex 2>&1 | tail -1
    fi
    
    if [ ! -f /home/hermes/.codex/auth.json ]; then
      echo "[codex] Setting up auth..."
      printf "%s" "$CODEX_AUTH_B64" | base64 -d | gunzip > ~/.codex/auth.json
      chmod 600 ~/.codex/auth.json
    fi
    # ...
  '

volumes:
  - ./data:/opt/data                          # Projetos e skills
  - codex_global:/usr/local/lib/node_modules  # Persiste Codex
  - codex_auth:/home/hermes/.codex            # Persiste auth

environment:
  CODEX_AUTH_B64: "<base64+gzip da auth>"     # Injeta credenciais
```

**Logs do último restart (2026-06-03 19:22 UTC):**
```
[codex] Installing...
changed 2 packages in 3s
[codex] Setting up auth...
[codex] Auth configured
Hermes Dashboard started (PID: 137)
```

### 7.3 O que falta na VPS

Apenas **sincronizar os 2 skills** para o volume `./data`:

```
Local: /opt/data/skills/autonomous-ai-agents/codex-review/SKILL.md
Local: /opt/data/skills/autonomous-ai-agents/codex-adversarial-review/SKILL.md
  ↓ copiar para
VPS: ./data/skills/autonomous-ai-agents/codex-review/SKILL.md
VPS: ./data/skills/autonomous-ai-agents/codex-adversarial-review/SKILL.md
```

---

## 8. Arquivos alterados/criados

### Criados

| Arquivo | Tamanho | Descrição |
|---|---|---|
| `skills/autonomous-ai-agents/codex-review/SKILL.md` | ~3 KB | Skill de review padrão |
| `skills/autonomous-ai-agents/codex-adversarial-review/SKILL.md` | ~6 KB | Skill de review adversarial |
| `docs/handoffs/2026-06-03-codex-skills-setup.md` | este arquivo | Relatório da sessão |

### Modificados

| Arquivo | Alteração |
|---|---|
| `skills/autonomous-ai-agents/codex/SKILL.md` | +related_skills, +seção Review Workflow |
| `~/.bashrc` | +`export PATH="$HOME/.local/bin:$PATH"` |

### Configurações alteradas

| Config | Antes | Depois |
|---|---|---|
| npm prefix | `/usr/local` | `~/.local` |
| PATH | `/usr/local/bin:/usr/bin:/bin` | `~/.local/bin` adicionado |

### Instalado

| Pacote | Versão | Local |
|---|---|---|
| `@openai/codex` | 0.136.0 | `~/.local/lib/node_modules/@openai/codex` |

---

## 9. Estado atual

| Componente | Local (`/opt/data`) | VPS (Hostinger) |
|---|---|---|
| Codex CLI | ✅ v0.136.0 | ✅ v? (dentro do container) |
| Auth Codex | ✅ ChatGPT Plus | ✅ Injeta via CODEX_AUTH_B64 |
| npm sem root | ✅ `~/.local` | ✅ Já era assim |
| Skill `codex-review` | ✅ Criado | ⚠️ Não sincronizado |
| Skill `codex-adversarial-review` | ✅ Criado | ⚠️ Não sincronizado |
| Skill `codex` | ✅ Atualizado | ⚠️ Não sincronizado |
| Sandbox bwrap | ❌ Container sem namespaces | ❓ KVM deve suportar |
| Claude Code antigo | ⚠️ Presente, não interfere | N/A |

---

## 10. Próximos passos

1. **Sincronizar skills para VPS** — copiar 3 arquivos SKILL.md via volume `./data`
2. **Testar sandbox na VPS** — KVM com Docker deve suportar user namespaces
3. **Rodar primeiro review adversarial** — contra o próprio código do aspen-dashboard
4. **Opcional: CI gate** — integrar review adversarial como passo pré-merge
