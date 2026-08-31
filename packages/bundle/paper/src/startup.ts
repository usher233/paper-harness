/**
 * The paper app's command-line provider: it parses the topic positional and
 * loop options, then publishes {@link PAPER_STARTUP_SERVICE}. The runner is an
 * ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-paper/startup
 */

import { join } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'paper-startup'

/** Services required before the loop parameters can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the paper runner. */
export const PAPER_STARTUP_SERVICE = 'paperStartup'

/** What the runner row reads from {@link PAPER_STARTUP_SERVICE}. */
export interface PaperStartupValues {
  /** The paper topic directory name under the workspace. */
  topic: string
  /** The maximum number of writer→commenter→auditor rounds. */
  rounds: number
  /** The minimum audit score for convergence. */
  passScore: number
  /** The workspace root the topic lives under. */
  workspace: string
}

/** Parse a commander option string as an integer within [min, max]. */
function numberOption(raw: string | undefined, label: string, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`paper: --${label} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * This app's command: the topic positional and loop options.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function paperCommand(): Command {
  return new Command()
    .name('dsh --profile paper')
    .description('Run the three-role paper loop (writer → commenter → auditor) on a topic until the audit verdict passes, then write paper.md.')
    .helpOption('-h, --help', 'show this help')
    .argument('<topic>', 'paper topic directory name under the workspace')
    .option('--rounds <number>', 'maximum loop rounds', '5')
    .option('--score <number>', 'minimum audit score to pass (0-100)', '80')
    .option('--workspace <dir>', 'workspace root (default: <cwd>/papers)', undefined)
    .addHelpText('after', `
Examples:
  dsh --profile paper demo                    run the loop on the "demo" topic, max 5 rounds, pass score 80
  dsh --profile paper demo --rounds 3 --score 75 --workspace /data/papers
`)
}

/**
 * Parse and provide the loop parameters as an ordinary Cordis service. The
 * command's action publishes the parameters; a missing topic or an out-of-range
 * option is a usage error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = paperCommand()
  program.action(() => {
    const topic = program.args[0]?.trim() ?? ''
    if (topic === '') {
      program.error('error: a topic is required, for example: dsh --profile paper demo')
    }
    const opts = program.opts<{ rounds: string; score: string; workspace: string | undefined }>()
    ctx.provide(PAPER_STARTUP_SERVICE, {
      topic,
      rounds: numberOption(opts.rounds, 'rounds', 1, 50),
      passScore: numberOption(opts.score, 'score', 0, 100),
      workspace: opts.workspace ?? join(process.cwd(), 'papers'),
    } satisfies PaperStartupValues)
  })
  parseCmdline(ctx, program)
}
