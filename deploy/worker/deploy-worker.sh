#!/bin/sh
# Deploy do aspen-worker no VPS (ADR 0013; operação em docs/worker-runbook.md).
#
# O operador instala este arquivo em /usr/local/sbin/aspen-worker-deploy. A
# chave SSH do GitHub Actions só executa este script (command= no
# authorized_keys), que recebe um destes comandos em SSH_ORIGINAL_COMMAND:
#
#   deploy <sha>    stdin: `git archive` do commit. Builda aspen-worker:<sha> e sobe.
#   rollback <sha>  sobe uma imagem já buildada, sem rebuild.
#
# Se o container novo não ficar saudável, volta à imagem anterior e sai com erro.
# Nunca toca o projeto do Evolution. Não imprime logs do worker: a saída vai
# para o log público do GitHub Actions.
set -eu

DIR=${ASPEN_WORKER_DIR:-/docker/aspen-worker}
LOCK=${ASPEN_WORKER_LOCK:-/run/lock/aspen-worker-deploy.lock}
KEEP_IMAGES=5
MAX_ARCHIVE_BYTES=$((100 * 1024 * 1024))
WAIT_SECONDS=120

log() { printf '[aspen-worker-deploy] %s\n' "$*" >&2; }
fail() {
  log "$*"
  exit 1
}

# A tag vai como prefixo do próprio `docker`: prefixo numa função shell não
# sobrevive ao retorno no dash, e o compose recusa qualquer comando sem ela.
compose() {
  tag=$1
  shift
  ASPEN_WORKER_TAG=$tag docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" "$@"
}

# Sobe a tag e espera o healthcheck do compose ficar saudável.
up() {
  compose "$1" up -d --wait --wait-timeout "$WAIT_SECONDS" worker
}

# Mantém as KEEP_IMAGES imagens mais novas, além da atual e da anterior.
prune() {
  docker image ls aspen-worker --format '{{.CreatedAt}}\t{{.Tag}}' |
    sort -r |
    tail -n +$((KEEP_IMAGES + 1)) |
    cut -f2 |
    while read -r tag; do
      [ "$tag" = "$1" ] || [ "$tag" = "$2" ] || docker image rm "aspen-worker:$tag" >/dev/null || true
    done
}

# release <tag> [descartar]: com "descartar", uma imagem que não subiu é
# apagada para não ocupar uma das vagas de rollback.
release() {
  target=$1
  previous=$(cat "$DIR/current-tag" 2>/dev/null || true)
  if up "$target"; then
    printf '%s\n' "$target" >"$DIR/current-tag"
    prune "$target" "$previous"
    log "aspen-worker:$target no ar"
    return 0
  fi
  log "aspen-worker:$target não ficou saudável; veja 'docker logs aspen-worker' no VPS"
  if [ "$previous" = "$target" ]; then
    # Era a versão em uso: fica como está, sem outra para onde voltar.
    exit 1
  fi
  if [ -n "$previous" ]; then
    if up "$previous"; then
      log "voltou para aspen-worker:$previous"
    else
      log "aspen-worker:$previous também não ficou saudável"
    fi
  else
    # Primeiro deploy: sem imagem anterior, não deixa um worker quebrado reiniciando.
    compose "$target" down || true
  fi
  if [ "${2:-}" = descartar ]; then
    docker image rm "aspen-worker:$target" >/dev/null 2>&1 || true
  fi
  exit 1
}

deploy() {
  workdir=$(mktemp -d)
  trap 'rm -rf "$workdir"' EXIT
  head -c $((MAX_ARCHIVE_BYTES + 1)) >"$workdir/source.tar"
  [ "$(wc -c <"$workdir/source.tar")" -le "$MAX_ARCHIVE_BYTES" ] || fail "código acima de 100 MB"
  # O tar vai direto ao BuildKit como contexto; nada é extraído no host.
  docker build --progress=plain -f deploy/worker/Dockerfile \
    --build-arg GIT_SHA="$1" -t "aspen-worker:$1" - <"$workdir/source.tar"
  release "$1" descartar
}

rollback() {
  if ! docker image inspect "aspen-worker:$1" >/dev/null 2>&1; then
    log "aspen-worker:$1 não existe no VPS. Disponíveis:"
    docker image ls aspen-worker --format '{{.Tag}}' >&2
    exit 1
  fi
  release "$1"
}

request=${SSH_ORIGINAL_COMMAND-$*}
set -f
# shellcheck disable=SC2086 # separa "ação sha" em palavras de propósito
set -- $request
set +f
[ $# -eq 2 ] || fail "uso: deploy <sha> | rollback <sha>"
case $2 in
  *[!0-9a-f]*) fail "sha inválido" ;;
esac
[ ${#2} -eq 40 ] || fail "sha inválido"
[ -f "$DIR/docker-compose.yml" ] || fail "$DIR/docker-compose.yml não existe"

exec 9>"$LOCK"
# Um deploy por vez; o seguinte espera (o GitHub também serializa o workflow).
flock 9

case $1 in
  deploy) deploy "$2" ;;
  rollback) rollback "$2" ;;
  *) fail "uso: deploy <sha> | rollback <sha>" ;;
esac
