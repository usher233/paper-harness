/**
 * @deepseek-ai/dsh-paper — the three-role paper loop driver. The bundle patch
 * rides over dsh-base with the agent-preset roster composed; this runner
 * creates one Agent per role phase, each joining its role preset, and drives
 * writer → commenter → auditor per round until the audit verdict passes
 * (score ≥ passScore, zero Critical issues, no source drift) or the round
 * budget is spent. Every phase's final assistant text streams to stderr and
 * its artifact is read from disk; convergence finalizes papers/<topic>/paper.md.
 *
 * @module @deepseek-ai/dsh-paper
 */

import { randomUUID } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { PaperRole } from './prompts.ts'
import { ROLES, auditorPrompt, commenterPrompt, writerPrompt } from './prompts.ts'
import {
  auditPath, draftPath, ensureScaffold, parseVerdict, readText, reviewPath, workspaceFor,
  type PaperWorkspace,
} from './workspace.ts'

/** Stable Cordis plugin name. */
export const name = 'paper-runner'

/** Core services required before the loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the loop parameters resolved from this app's injected provider service. */
export interface Config {
  /** The paper topic directory name under the workspace. */
  topic: string
  /** The maximum number of writer→commenter→auditor rounds. */
  rounds: number
  /** The minimum audit score for convergence. */
  passScore: number
  /** The workspace root the topic lives under. */
  workspace: string
}

export const Config: z<Config> = z.object({
  topic: z.string().required(),
  rounds: z.number().min(1).max(50).default(5),
  passScore: z.number().min(0).max(100).default(80),
  workspace: z.string().required(),
})

/** One role phase's outcome: its final assistant text. */
interface PhaseOutcome {
  text: string
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface PaperIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: PaperIo['stdout']; stderr: PaperIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): string {
  let started = false
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
  }
  return text
}

/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * appended, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the Session event feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(
  ctx: Context,
  agent: Agent,
  stderr: PaperIo['stderr'],
): () => void {
  let started = false
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      close()
      started = true
      return
    }
    if (!started || event.type !== 'assistant/chunk') return
    const chunk = event.data.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('dsh: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'paper reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: PaperIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/** The required artifact path for one role phase, asserted present. */
function requiredArtifact(role: PaperRole, round: number, path: string): string {
  const artifact = readText(path)
  if (artifact === undefined) {
    throw new Error(
      `paper-runner: the ${role.label} did not write its round ${round} artifact at ${path}; `
      + 're-run the round and check the agent prompt or filesystem tool policy',
    )
  }
  return artifact
}

/**
 * Run one role phase: create an Agent that joins the role's preset, feed it
 * the phase prompt, drive it to quiescence, flush its Session, and return its
 * final assistant text.
 * @param ctx - plugin context carrying the Agent, preset roster, default model, Session, and launcher IO services.
 * @param role - the role to run (writer, commenter, or auditor).
 * @param prompt - the phase prompt.
 * @param io - process-facing effects.
 */
async function runRole(
  ctx: Context,
  role: PaperRole,
  prompt: string,
  io: PaperIo,
): Promise<PhaseOutcome> {
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const presets = ctx.get('agentPresets')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return { text: '' }
  if (presets === undefined) {
    throw new Error('paper-runner: the agent-preset roster is not composed; add @deepseek-ai/dsh-agent-presets to the paper bundle patch')
  }

  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      await presets.mount(agentCtx, role.key)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const stopReasoning = streamReasoning(ctx, agent, io.stderr)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopReasoning()
  }
  await sessions.flush(agent.session)
  return { text: summarize(agent.session.events, firstSeq) }
}

/** Write the loop's final paper: the last converged (or best) draft. */
function finalizePaper(ws: PaperWorkspace, io: PaperIo, round: number, converged: boolean): void {
  const draft = readText(draftPath(ws, round))
  if (draft !== undefined) {
    copyFileSync(draftPath(ws, round), ws.finalPath)
    io.stdout.write(`paper: finalized ${ws.finalPath}\n`)
  } else {
    io.stderr.write(`paper: no draft artifact to finalize (missing ${draftPath(ws, round)})\n`)
  }
  io.stdout.write(`paper: ${converged ? 'converged' : 'rounds exhausted'} after round ${round}\n`)
}

/**
 * Run the three-role paper loop to convergence and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - validated loop parameters.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: PaperIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()

  const ws = workspaceFor(config.workspace, config.topic)
  ensureScaffold(ws)
  io.stdout.write(`paper: workspace ${ws.root}\n`)
  io.stdout.write(`paper: running up to ${config.rounds} round(s), pass score ${config.passScore}\n`)

  let converged = false
  let lastRound = 0
  for (let round = 1; round <= config.rounds; round++) {
    io.stdout.write(`paper: round ${round}/${config.rounds}\n`)
    lastRound = round
    const loop = { topic: config.topic, round, maxRounds: config.rounds, passScore: config.passScore }

    // 1. writer
    io.stdout.write('paper: writer\n')
    await runRole(ctx, ROLES[0], writerPrompt(ws, loop), io)
    requiredArtifact(ROLES[0], round, draftPath(ws, round))

    // 2. commenter
    io.stdout.write('paper: commenter\n')
    await runRole(ctx, ROLES[1], commenterPrompt(ws, loop), io)
    requiredArtifact(ROLES[1], round, reviewPath(ws, round))

    // 3. auditor
    io.stdout.write('paper: auditor\n')
    await runRole(ctx, ROLES[2], auditorPrompt(ws, loop), io)
    const auditText = requiredArtifact(ROLES[2], round, auditPath(ws, round))

    const verdict = parseVerdict(auditText)
    if (verdict === undefined) {
      io.stderr.write(`paper: round ${round} audit has no parseable Verdict section; treating as not converged\n`)
      continue
    }
    io.stdout.write(
      `paper: round ${round} verdict: ${verdict.result} score ${verdict.score} critical ${verdict.critical}\n`,
    )
    converged = verdict.result === 'PASS' && verdict.score >= config.passScore && verdict.critical === 0
    if (converged) break
  }

  finalizePaper(ws, io, lastRound, converged)
  io.exit(0)
}

/**
 * Mount the three-role paper loop driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated loop config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('paper-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: PaperIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
