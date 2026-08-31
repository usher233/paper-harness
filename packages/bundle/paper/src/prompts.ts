/**
 * The three role prompts that drive each loop phase. These are model-facing
 * contracts: they describe only what the role must do and produce, grounded in
 * the role preset's skills, never the harness or transport vocabulary. The
 * writer produces a draft, the commenter a scored review, the auditor an audit
 * with a machine-readable Verdict the runner parses.
 * @module @deepseek-ai/dsh-paper/prompts
 */

import { existsSync } from 'node:fs'
import type { PaperWorkspace } from './workspace.ts'
import { auditPath, describeInputs, draftPath, reviewPath } from './workspace.ts'

/** The role a round phase drives, and the preset each phase mounts. */
export interface PaperRole {
  /** Role key; also the preset id the phase's agent mounts. */
  readonly key: 'paper-writer' | 'paper-commenter' | 'paper-auditor'
  /** Human label for progress output. */
  readonly label: string
}

/** The writer, commenter, and auditor roles, in loop order. */
export const ROLES = [
  { key: 'paper-writer', label: 'writer' },
  { key: 'paper-commenter', label: 'commenter' },
  { key: 'paper-auditor', label: 'auditor' },
] as const satisfies readonly PaperRole[]

/** Loop parameters shared by the role prompts. */
export interface LoopContext {
  /** The topic key. */
  readonly topic: string
  /** The current round number (1-based). */
  readonly round: number
  /** The maximum number of rounds the loop may run. */
  readonly maxRounds: number
  /** The audit score threshold for convergence. */
  readonly passScore: number
}

/** The commenter's six evaluation dimensions, in review order. */
const DIMENSIONS = [
  'Argument flow and section structure',
  'Claim sharpness',
  'Evidence-claim alignment',
  'Academic voice',
  'Reader clarity for a first-time reader',
  'Abstract alignment with the body',
] as const

/** Inline the prior feedback files a writer round must read, oldest first. */
function feedbackBlock(ws: PaperWorkspace, round: number): string {
  const reviews = reviewList(ws, round)
  const audits = auditList(ws, round)
  if (reviews === '' && audits === '') {
    return 'None yet — this is round 1, write the first full draft.'
  }
  const parts: string[] = []
  if (reviews !== '') parts.push(`Reviews to address:\n${reviews}`)
  if (audits !== '') parts.push(`Audits to address (fix every Critical/High; auditor and commenter both feed the writer):\n${audits}`)
  return parts.join('\n\n')
}

/** Newline-joined review artifact paths at or after a round, or ''. */
function reviewList(ws: PaperWorkspace, round: number): string {
  const paths: string[] = []
  for (let n = 1; n <= round; n++) {
    const p = reviewPath(ws, n)
    if (existsSync(p)) paths.push(`- ${p}`)
  }
  return paths.join('\n')
}

/** Newline-joined audit artifact paths at or after a round, or ''. */
function auditList(ws: PaperWorkspace, round: number): string {
  const paths: string[] = []
  for (let n = 1; n <= round; n++) {
    const p = auditPath(ws, n)
    if (existsSync(p)) paths.push(`- ${p}`)
  }
  return paths.join('\n')
}

/**
 * The writer prompt: read the inputs and prior feedback, then write the next
 * draft artifact. The writer must ground every claim in the materials and cite
 * by file path (the paper-ecosystem Source Fidelity rule).
 * @param ws - the topic workspace.
 * @param loop - the loop parameters.
 */
export function writerPrompt(ws: PaperWorkspace, loop: LoopContext): string {
  return `You are the writer of an academic paper, drafting round ${loop.round} of ${loop.maxRounds}.

Topic: ${loop.topic}
${describeInputs(ws)}
Target draft: ${draftPath(ws, loop.round)}
Final artifact after convergence: ${ws.finalPath}

Write in the language of the input materials (English, 中文, or mixed as the materials do).

Step 1 — Read the inputs:
Read every file under ${ws.inputDir} (proposal.md, introduction.md, progress.md, and the files in materials/). The proposal defines the thesis and scope; the introduction provides the background; progress.md records what is already settled.

Step 2 — Address prior feedback:
${feedbackBlock(ws, loop.round)}

Step 3 — Write the draft:
Use the Write tool to create ${draftPath(ws, loop.round)} with the paper structure:
1. Title page (title, version, date)
2. Abstract (problem, contributions, consequence; 5-8 keywords)
3. Introduction (problem statement + thesis + section roadmap)
4. Body sections that argue the thesis
5. Conclusion (thesis reprise + open questions)
6. References

Source fidelity (non-negotiable):
- Ground every substantive claim in a cited primary source: a file under ${ws.inputDir} or a referenced external source with a URL.
- Cite by file path or URL next to the claim. Do not cite a claim the materials do not support; if a point is your own reasoning, mark it as such.
- Keep every term defined at first use and use it consistently (no vocabulary drift).

When the draft file is written, finish with a 3-5 sentence summary: what the draft argues, which feedback items you addressed, and which you deliberately deferred and why.`
}

/**
 * The commenter prompt: score the latest draft on six dimensions, then write a
 * prioritized issue list. The commenter reads the inputs to ground its
 * evaluation and may compare against prior reviews to judge progress.
 * @param ws - the topic workspace.
 * @param loop - the loop parameters.
 */
export function commenterPrompt(ws: PaperWorkspace, loop: LoopContext): string {
  const dims = DIMENSIONS.map((dim, index) => `${index + 1}. ${dim} (0-100)`).join('\n')
  return `You are the commenter reviewing draft ${loop.round} of an academic paper, before it goes to the auditor.

Topic: ${loop.topic}
Draft to review: ${draftPath(ws, loop.round)}
Review to write: ${reviewPath(ws, loop.round)}

Step 1 — Read the draft and the inputs under ${ws.inputDir} to ground your evaluation.

Step 2 — Evaluate the draft on six dimensions:
${dims}

Step 3 — Write the review to ${reviewPath(ws, loop.round)} using the Write tool, in the draft's language, with exactly this structure:

## Review of draft ${loop.round}
### Dimension scores
- Argument flow and section structure: <0-100> — <1-3 sentences of justification>
- Claim sharpness: <0-100> — <justification>
- Evidence-claim alignment: <0-100> — <justification>
- Academic voice: <0-100> — <justification>
- Reader clarity for a first-time reader: <0-100> — <justification>
- Abstract alignment with the body: <0-100> — <justification>
### Issues
- Critical: <item, referencing the draft section> (each must block acceptance)
- High: <item> (should be fixed this round)
- Medium: <item> (worth fixing when convenient)
### Overall score
- Overall: <mean of the six dimension scores, 0-100>

Keep every issue actionable: name the section and say what to change. The auditor reads this review too and will judge whether you missed anything. When the review file is written, finish with a 2-3 sentence verdict on whether the draft is ready for the auditor.`
}

/**
 * The auditor prompt: audit the draft AND the commenter's review, then write an
 * audit with a machine-readable Verdict section the runner parses for
 * convergence. The auditor carries two feedback channels — one to the writer,
 * one to the commenter.
 * @param ws - the topic workspace.
 * @param loop - the loop parameters.
 */
export function auditorPrompt(ws: PaperWorkspace, loop: LoopContext): string {
  return `You are the auditor of an academic paper, auditing draft ${loop.round} and its review before the next round.

Topic: ${loop.topic}
Draft: ${draftPath(ws, loop.round)}
Review: ${reviewPath(ws, loop.round)}
Audit to write: ${auditPath(ws, loop.round)}
Pass threshold: score >= ${loop.passScore}, zero Critical issues, no source drift.

Step 1 — Read the draft, the review, and the inputs under ${ws.inputDir}.

Step 2 — Audit two channels:

Channel A — to the WRITER (source fidelity + citation + vocabulary):
- Extract each substantive claim and check the cited source actually supports it (read the cited material file directly). Classify each claim ALIGNED / PARTIAL / DRIFT / UNCHECKED.
- Check reference/citation format consistency and that every in-text cite has a reference entry (no orphan citations).
- Check vocabulary consistency: every term defined at first use, used consistently, sub-classifications introduced explicitly.

Channel B — to the COMMENTER (review quality):
- Did the review miss a Critical issue, misjudge a dimension, or over/under-score?
- Record each disagreement concretely.

Step 3 — Write the audit to ${auditPath(ws, loop.round)} using the Write tool, in the draft's language:
- Issues for the writer (Critical / High / Medium, each citing the draft section)
- Source fidelity findings (each claim's classification)
- Issues for the commenter (what the review missed or misjudged)
- ## Verdict section, machine-readable, exactly:

## Verdict
- Result: PASS or FAIL
- Score: <overall 0-100>
- Critical count: <number of Critical issues>

PASS only when: score >= ${loop.passScore}, Critical count is 0, and no DRIFT remains. Be strict; any unresolved Critical issue means FAIL. When the audit file is written, finish with one sentence: your verdict and the score.`
}
