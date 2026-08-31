/**
 * The paper workspace model: the on-disk layout the three-role loop reads and
 * writes. One topic lives under `<workspace>/<topic>/` with an `input/` tree
 * (materials, proposal, introduction, progress), per-round `draft/`, `reviews/`,
 * `audits/` artifacts, and a final `paper.md`.
 * @module @deepseek-ai/dsh-paper/workspace
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A paper topic's on-disk home. */
export interface PaperWorkspace {
  /** The topic key, used for file names and labels. */
  readonly topic: string
  /** Absolute topic root (`<workspace>/<topic>/`). */
  readonly root: string
  /** The user-supplied inputs the writer consumes. */
  readonly inputDir: string
  /** Per-round writer output (`draft/draft_vN.md`). */
  readonly draftDir: string
  /** Per-round commenter output (`reviews/review_vN.md`). */
  readonly reviewsDir: string
  /** Per-round auditor output (`audits/audit_vN.md`). */
  readonly auditsDir: string
  /** The converged final paper (`paper.md`). */
  readonly finalPath: string
}

/**
 * Resolve a topic's workspace layout under a workspace base. No directory is
 * created here; {@link ensureScaffold} owns materialization.
 * @param workspaceBase - the workspace root (defaults to `papers/` under cwd).
 * @param topic - the topic directory name.
 */
export function workspaceFor(workspaceBase: string, topic: string): PaperWorkspace {
  const root = join(workspaceBase, topic)
  return {
    topic,
    root,
    inputDir: join(root, 'input'),
    draftDir: join(root, 'draft'),
    reviewsDir: join(root, 'reviews'),
    auditsDir: join(root, 'audits'),
    finalPath: join(root, 'paper.md'),
  }
}

/** A scaffold template written when a topic is first materialized. */
const INPUT_TEMPLATES: Record<string, string> = {
  'proposal.md': `# Proposal: ${''}
<!-- The paper's thesis, scope, and target venue. Edit before running. -->
`,
  'introduction.md': `# Introduction
<!-- Background and the gap this paper addresses. Edit before running. -->
`,
  'progress.md': `# Current progress
<!-- What is already done and what remains. Edit before running. -->
`,
}

/**
 * Materialize a topic workspace that does not yet exist: directories plus
 * template input files for anything missing. Existing files are never touched,
 * so re-running is a no-op on an initialized topic.
 * @param ws - the workspace to scaffold.
 */
export function ensureScaffold(ws: PaperWorkspace): void {
  mkdirSync(join(ws.inputDir, 'materials'), { recursive: true })
  mkdirSync(ws.draftDir, { recursive: true })
  mkdirSync(ws.reviewsDir, { recursive: true })
  mkdirSync(ws.auditsDir, { recursive: true })
  for (const [name, template] of Object.entries(INPUT_TEMPLATES)) {
    const target = join(ws.inputDir, name)
    if (!existsSync(target)) writeFileSync(target, template)
  }
}

/** Round-indexed artifact paths. */
export const draftPath = (ws: PaperWorkspace, round: number): string => join(ws.draftDir, `draft_v${round}.md`)
export const reviewPath = (ws: PaperWorkspace, round: number): string => join(ws.reviewsDir, `review_v${round}.md`)
export const auditPath = (ws: PaperWorkspace, round: number): string => join(ws.auditsDir, `audit_v${round}.md`)

/** A parsed machine-readable audit verdict. */
export interface AuditVerdict {
  /** Whether the auditor judged the draft ready. */
  result: 'PASS' | 'FAIL'
  /** The auditor's 0-100 overall score. */
  score: number
  /** The number of unresolved Critical issues. */
  critical: number
}

/**
 * Parse the auditor's `## Verdict` section from an audit artifact. The section
 * carries three `- key: value` lines; any missing line makes the verdict
 * unparseable.
 * @param text - the audit artifact text.
 * @returns the parsed verdict, or undefined when the section is absent or malformed.
 */
export function parseVerdict(text: string): AuditVerdict | undefined {
  // Optional chaining yields undefined both for a non-matching regex and for a
  // regex that matched without its capture group; either makes the verdict
  // unparseable below.
  const result = /Result:\s*(PASS|FAIL)/i.exec(text)?.[1]
  const score = /Score:\s*(\d{1,3})/i.exec(text)?.[1]
  const critical = /Critical count:\s*(\d+)/i.exec(text)?.[1]
  if (result === undefined || score === undefined || critical === undefined) return undefined
  return {
    result: result.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL',
    score: Math.min(100, Number(score)),
    critical: Number(critical),
  }
}

/** Read a file as text, or undefined when it does not exist or cannot be read. */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The prior-round feedback a writer round must address, oldest first. */
export interface PriorFeedback {
  /** Every review artifact from rounds before the current one, in order. */
  readonly reviews: readonly string[]
  /** Every audit artifact from rounds before the current one, in order. */
  readonly audits: readonly string[]
}

/**
 * Collect all review and audit artifacts written before a round, in round
 * order, for the writer's feedback context.
 * @param ws - the topic workspace.
 * @param round - the round about to be written; prior artifacts are rounds `< round`.
 */
export function priorFeedback(ws: PaperWorkspace, round: number): PriorFeedback {
  const reviews: string[] = []
  const audits: string[] = []
  for (let prior = 1; prior < round; prior++) {
    const review = readText(reviewPath(ws, prior))
    if (review !== undefined) reviews.push(review)
    const audit = readText(auditPath(ws, prior))
    if (audit !== undefined) audits.push(audit)
  }
  return { reviews, audits }
}

/** The input tree's textual description, for a role prompt's context block. */
export function describeInputs(ws: PaperWorkspace): string {
  const materials = join(ws.inputDir, 'materials')
  const lines = [`- input root: ${ws.inputDir}`, `- materials directory: ${materials}`]
  for (const name of Object.keys(INPUT_TEMPLATES)) {
    const target = join(ws.inputDir, name)
    lines.push(`- ${name}: ${existsSync(target) ? 'present' : 'absent'}`)
  }
  return lines.join('\n')
}
