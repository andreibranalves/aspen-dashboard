#!/bin/sh
# Pós-merge: remove worktrees e branches locais cujo remote foi apagado (PR merged).
# Requer "Automatically delete head branches" habilitado no GitHub; squash merge ok.
set -e
git fetch --prune

# Worktrees parados em branch já merged (remota gone). Sujo = pula com aviso.
for wt in $(git worktree list --porcelain | sed -n 's/^worktree //p'); do
  b=$(git -C "$wt" branch --show-current 2>/dev/null)
  if [ -n "$b" ] && git branch -vv | grep -q " $b.*: gone]"; then
    git worktree remove "$wt" || echo "atenção: worktree $wt não removido (arquivos não commitados)" >&2
  fi
done
git worktree prune

# Branches locais com remota apagada. -D porque squash merge não cria ancestralidade.
git branch --format '%(refname:short)\t%(upstream:track)' | grep -P '\t\[gone\]' | cut -f1 | xargs -r -n1 git branch -D || true
