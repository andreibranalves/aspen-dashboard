#!/bin/sh
# Conservador: upstream apagado NÃO prova merge. Squash sem ancestralidade fica
# para limpeza manual após confirmação do PR; nenhum git branch -D aqui.
set -eu
git fetch --prune origin
git rev-parse --verify refs/remotes/origin/master >/dev/null

integrated_and_gone() {
  [ "$(git for-each-ref --format='%(upstream:track)' "refs/heads/$1")" = '[gone]' ] &&
    git merge-base --is-ancestor "refs/heads/$1" refs/remotes/origin/master
}

# O formato porcelain mantém caminhos com espaços intactos.
git worktree list --porcelain | while IFS= read -r line; do
  case "$line" in
    'worktree '*) wt=${line#worktree } ;;
    'branch refs/heads/'*)
      branch=${line#branch refs/heads/}
      if integrated_and_gone "$branch"; then
        git worktree remove "$wt" || printf 'Worktree preservado: %s\n' "$wt" >&2
      fi
      ;;
  esac
done
git worktree prune

git for-each-ref --format='%(refname:short)' refs/heads/ | while IFS= read -r branch; do
  if integrated_and_gone "$branch"; then
    git branch -d "$branch" || printf 'Branch preservada: %s\n' "$branch" >&2
  fi
done
