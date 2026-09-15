import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/post-merge-cleanup.sh');

test('cleanup preserves unmerged/squashed/dirty branches and only deletes integrated gone branches', () => {
  const root = mkdtempSync(join(tmpdir(), 'aspen-cleanup-'));
  const repo = join(root, 'checkout');
  const remote = join(root, 'remote.git');
  // No user hooks, signing, remote services or shared Git configuration.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test' };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const commit = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), name);
    git(cwd, 'add', name);
    git(cwd, 'commit', '-m', name);
  };
  try {
    git(root, 'init', '--bare', '--initial-branch=master', remote);
    git(root, 'clone', remote, repo);
    commit(repo, 'initial');
    git(repo, 'push', '-u', 'origin', 'master');
    const branches = ['merged', 'abandoned', 'squashed', 'dirty'];
    const worktrees = Object.fromEntries(branches.map((branch) => [branch, join(root, `worktree ${branch}`)]));
    for (const branch of branches) {
      git(repo, 'worktree', 'add', '-b', branch, worktrees[branch], 'master');
      commit(worktrees[branch], branch);
      git(worktrees[branch], 'push', '-u', 'origin', branch);
    }
    git(repo, 'merge', '--no-edit', 'merged');
    git(repo, 'merge', '--no-edit', 'dirty');
    git(repo, 'merge', '--squash', 'squashed');
    git(repo, 'commit', '-m', 'squash');
    git(repo, 'push', 'origin', 'master');
    writeFileSync(join(worktrees.dirty, 'uncommitted'), 'keep');
    git(repo, 'push', 'origin', '--delete', ...branches);
    execFileSync('sh', [script], { cwd: repo, env, stdio: 'pipe' });
    assert.equal(existsSync(worktrees.merged), false);
    assert.equal(git(repo, 'branch', '--list', 'merged'), '');
    for (const branch of ['abandoned', 'squashed', 'dirty']) {
      assert.ok(existsSync(worktrees[branch]), branch);
      assert.ok(git(repo, 'branch', '--list', branch), branch);
    }
    assert.equal(existsSync(join(worktrees.dirty, 'uncommitted')), true);
    assert.equal(git(repo, 'branch', '--show-current'), 'master');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
