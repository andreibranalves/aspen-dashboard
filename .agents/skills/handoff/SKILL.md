---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Follow the handoff contract in `docs/release-lanes.md`, including code identity,
authorizations, reusable validation evidence, remaining gates and the global
correction count. Record unavailable capabilities instead of assuming them.

Include suggested skills only when relevant and available in the next harness;
load them through that harness's supported mechanism, not an assumed Skill tool.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
