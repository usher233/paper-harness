/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-paper`.
 * @module @deepseek-ai/dsh-paper/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-paper'

/** Cordis companion plugin name. */
export const name = 'paper-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner's observable contract (three role agents
 * per round, verdict-parsed convergence, paper.md finalization) is exercised
 * at the process and filesystem boundary and owned by the launcher e2e; it
 * registers nothing and holds no mutable relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
