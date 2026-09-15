---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

Read the spec, its existing tickets, `AGENTS.md` and `docs/release-lanes.md`.
Implement the current requirements on a short branch, preserving existing work.
Do not require a ticket graph, multiple agents or worktrees for a sequential task.

Use independent implementers only when tasks are actually separable and the
harness supports them. Pass context pointers, exact scope, applicable nested
instructions and authorization limits; use separate worktrees for concurrent
writers. The main agent remains responsible for the integrated diff.

Select checks and review by the lane. Reuse evidence for unchanged code and
preserve the global correction count across agents and CI. Missing reviewer
capability is a pending gate, not permission to claim independent review.

Commit, PR creation, publication and operational effects need their applicable
authorization; this skill grants none. Never clean another agent's worktree
without preserving its work and proving integration; follow the repository's
conservative cleanup procedure.

Report completed requirements, evidence and remaining gates using the handoff
contract in `docs/release-lanes.md`.
