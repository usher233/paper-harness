---
description: "Three-role paper loop mode for dsh: run a writer, a commenter, and an auditor over a paper topic until the audit verdict passes, then write paper.md — for drafting and revising academic papers."
kind: "package-bundle"
---

# @deepseek-ai/dsh-paper

English | [中文](README.zh.md)

## Summary

`dsh-paper` restructures the agent loop for academic paper writing: instead of one agent answering, each round runs three role agents — a **writer** that drafts from the topic's input materials, a **commenter** that scores the draft and lists issues, and an **auditor** that checks the draft and the review against the sources and issues a machine-readable verdict. The loop repeats until the verdict passes (`Result: PASS`, score at or above the threshold, zero Critical issues, no source drift) or the round budget is spent, then writes the final `paper.md`. All three roles keep the model, tools, and safety defaults of every other dsh surface; the roles differ only in persona and skill.

The loop boundary: one paper topic per invocation, run to convergence or the configured round cap.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Run the loop on a topic, get `papers/<topic>/paper.md`, and exit. The topic directory is the command line itself.

### Running a paper loop

```sh
dsh --profile paper "my-topic"
```

The launcher scaffolds `papers/my-topic/` (input templates if missing), then runs up to 5 rounds of writer → commenter → auditor against the model selected by the shared default-model row. Each phase streams non-empty reasoning to stderr under a `dsh: reasoning:` heading. Per-round artifacts land on disk for traceability, and the loop finalizes the last draft as `papers/my-topic/paper.md`.

| Option | Default | Meaning |
|---|---|---|
| `<topic>` | required | Paper topic directory name under the workspace |
| `--rounds <number>` | `5` | Maximum loop rounds (1-50) |
| `--score <number>` | `80` | Minimum audit score to pass (0-100) |
| `--workspace <dir>` | `<cwd>/papers` | Workspace root the topic lives under |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-paper) is the exhaustive source for every accepted field and its JSDoc.

### What each role produces

The writer reads the inputs under `papers/<topic>/input/` (`proposal.md`, `introduction.md`, `progress.md`, and the files under `materials/`) plus all prior reviews and audits, then writes `draft/draft_vN.md`. The commenter reads the draft and the inputs, scores it on six dimensions (0-100 each), and writes `reviews/review_vN.md` with a Critical / High / Medium issue list. The auditor reads the draft, the review, and the inputs, checks each claim against its cited source, and writes `audits/audit_vN.md` including the machine-readable `## Verdict` section (`Result: PASS|FAIL`, `Score`, `Critical count`). The loop converges when the verdict is PASS with score ≥ `--score` and zero Critical issues.

### When to use it

Use paper for drafting or revising an academic paper from a topic's materials. Avoid it for interactive multi-turn work; the browser surface ([dsh-web-app](../web-app/README.md)) serves that. The process stays alive only for the run, opens no listening port, and exits on its own.

### Help and usage errors

`dsh --profile paper --help` prints the command's help text and exits without running anything. A missing topic is a usage error: nothing runs and the process exits 1. An out-of-range `--rounds` or `--score` is rejected before anything runs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runner is a direct driver over the core API carrier: each role phase creates a fresh Agent that joins the role's preset, and the runner folds each owned durable event interval into progress output while reading role artifacts from disk.

### Run flow

The runner awaits the complete application (`ctx.get('loader')?.await()`), reads the shared [`agentDefaultModel`](../../core/agent-default-model/README.md) selection, and scaffolds the topic workspace. For each round it creates one Agent per role (writer, commenter, auditor) with that provider and model; each Agent's setup calls `installModelSelection` and mounts the role's preset ([`agent-presets`](../../preset/agent-presets/README.md)) so the Agent inherits its persona and skills. Each phase submits the role prompt as an ordinary user message, streams reasoning to stderr, waits for quiescence, and flushes the Session. After each phase the runner requires the role's artifact on disk and reads it; after the auditor it parses the verdict and decides convergence. On convergence (or when the round budget is spent) it finalizes the last draft as `paper.md` and requests exit.

### Patch surface over base

The patch rides over `dsh-base`: it keeps the same temporary process-wide PTC mode opt-in (`DSH_TOOLS_MODE`) as the Web surface, composes the agent-preset roster (defaulting to `paper-writer`), and mounts the startup provider and the runner. The startup provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses the topic positional and loop options, and provides `paperStartup`; the runner injects that service and reads its topic, rounds, pass score, and workspace from lazy config. The base's global tool layer (bash, filesystem, web, skill catalog, agent instructions) serves every role agent; the presets add only a persona and each role's own skills directory.

### Workspace and convergence

The workspace model ([`src/workspace.ts`](src/workspace.ts)) owns the on-disk layout, the input templates, the verdict parser, and the path helpers. The prompts ([`src/prompts.ts`](src/prompts.ts)) are the model-facing contracts: the writer's source-fidelity rules, the commenter's six dimensions, and the auditor's two feedback channels plus the machine-readable verdict the runner parses.

### Exit mapping

The loop requests exit 0 after finalizing `paper.md`, whether it converged or exhausted its rounds; the log line after finalization says which. A usage error (missing topic, out-of-range option) exits 1 before anything runs. A direct driver failure (for example, Agent creation, or a role phase that never wrote its artifact) writes `dsh: <message>` to stderr and exits 1.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `paper-runner` plugin: round loop, role phases, verdict convergence, finalization |
| [`src/startup.ts`](src/startup.ts) | The `paper-startup` provider: topic positional, loop options, `--help` |
| [`src/workspace.ts`](src/workspace.ts) | The workspace model: layout, input templates, verdict parser |
| [`src/prompts.ts`](src/prompts.ts) | The writer / commenter / auditor prompts |
| [`cordis.patch.yml`](cordis.patch.yml) | The paper patch over `dsh-base` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: no runtime invariant; the observable contract is process- and filesystem-level |
| Role presets | `paper-writer` / `paper-commenter` / `paper-auditor` under `@deepseek-ai/dsh-agent-presets` shipped root |

### Invariant ownership

The invariant companion registers an empty installer because the runner's observable contract (three artifacts per round, verdict-parsed convergence, `paper.md` finalization) is process- and filesystem-level and owned by the launcher e2e; the plugin registers nothing and holds no mutable relation to audit inside the tree.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the shared core, the sibling surfaces, or the preset mechanism.

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-base](../base/README.md) — the shared core the paper loop runs on.
- [dsh-headless](../headless/README.md) — the one-shot sibling; the paper loop builds on its direct-driver pattern.
- [dsh-agent-presets](../../preset/agent-presets/README.md) — how role presets compose persona and skills per Agent.
- [dsh-cmdline](../../boot/cmdline/README.md) — how the launcher hands the command line to the app.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-paper) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

The runner drives one user message per role phase through the composed tree; the role persona, the phase prompt, and the role skills own the model-visible text. The auditor's verdict is the only model-visible output the runner interprets structurally.

#### KV Cache effect

Each role phase is a fresh Session, so the request prefix is per-phase; the runner adds nothing beyond the phase prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you when paper does not fit and what it needs from the `dsh` launcher. They are current package constraints, not a general CLI comparison or a task backlog.

- **One topic per run** — after the loop converges or exhausts its rounds the process exits; run separate topics in separate invocations.
- **Runs through the `dsh` launcher** — starting the paper profile another way fails at startup, because only the launcher can request the process exit.
- **Artifacts are required per phase** — if a role agent finishes without writing its artifact, the run fails loudly rather than synthesizing a replacement, so the loop stays auditable.
- **No pre-token heartbeat** — stderr stays silent until the provider emits a non-empty reasoning delta; a delayed first token exposes no earlier progress signal.
- **Reasoning enters stderr logs** — redirection and supervisors may retain substantially more and potentially sensitive model output; route stderr to a controlled sink when needed.
- **Non-convergence still finalizes** — when the round budget is spent without a passing verdict, the last draft is still written as `paper.md`; inspect the per-round audits to see what blocked convergence.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The loop order (writer → commenter → auditor) and the verdict contract are the fork's defining behavior; change them in `src/index.ts` and the prompts together, and keep the prompts and the verdict parser in sync.

</details>
