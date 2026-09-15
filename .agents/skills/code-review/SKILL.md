---
name: code-review
description: "Review a branch, PR or work in progress against repository standards and the originating spec. Use when the user requests code review or review since a fixed point."
---

Review on two axes: **Standards** (documented repository rules) and **Spec**
(the user's actual requirements). Both axes belong to one review; they do not
require separate agents.

## Establish scope

1. Read `AGENTS.md` and `docs/release-lanes.md`. The lane controls whether an
   independent reviewer is required, review depth and the global correction budget.
   A requested review may be performed even when SHIP does not require one.
2. Resolve the fixed point supplied by the user. For a branch review, capture
   `git diff <base>...HEAD` and the commit list. For work in progress, also capture
   staged, unstaged and relevant untracked files. Exclude unrelated pre-existing work.
   Ask only if the comparison base cannot be determined safely.
3. Identify the spec from the request, referenced issue or supplied document;
   use `docs/agents/issue-tracker.md` when issue lookup is needed. If no spec is
   available, say so instead of inventing requirements.
4. Read applicable nested `AGENTS.md` files and the touched call paths, not just
   isolated diff hunks. Reuse checks already run against the same code; run a new
   check only for a concrete doubt or reproduction.

## Review

Use one independent reviewer for SAFE/CRITICAL, with both axes and pointers to
base/HEAD, diff, spec, rules, test evidence and consumed correction cycles. If the
harness lacks independent execution, report that gate as pending; self-review
is not independent review. For an explicitly requested review, this session may
act as the reviewer of another implementer's work.

Prioritize demonstrated bugs, current acceptance criteria, data loss, security,
external effects and operational failure. Architectural smells are hypotheses,
not blockers by themselves; repository standards override generic preferences.
Do not demand abstractions or validations for hypothetical consumers.

## Report

Under `Standards` and `Spec`, report concrete findings with severity, path/line,
evidence and impact. Distinguish BLOCKER from FOLLOW-UP/IGNORE using the lane's
criteria. State what was not inspected or executed and any remaining review gate.

Do not fix, commit, publish, reset the correction counter or trigger operational
effects as part of a review unless separately authorized.
