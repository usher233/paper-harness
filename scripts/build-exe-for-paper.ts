/**
 * Build the paper-harness single executable. The fixed `@yao-pkg/pkg --sea`
 * route, deploy flags, and artifact layout mirror the Python SDK runtime build
 * (scripts/build-exe-for-python-sdk.ts) so the Windows/paper CLI and its whole
 * Cordis plugin closure ship in one file. The staged closure is symlink-free
 * and whole-tree assets cover the runtime bare-package imports pkg cannot
 * discover statically.
 *
 * @module build-exe-for-paper
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveLinuxNodePtyAddon, resolveWindowsNodePtyAddons } from './build-exe-for-python-sdk-native-pty.ts'

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the executable. */
const DEPLOY_ROOT_PACKAGE = 'dsh-python-runtime-closure'
/** The sole application launcher inside the deployed closure. */
const ENTRY_BIN = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
/** Executable basename. */
const OUTPUT_BASENAME = 'paper-harness'
/** Default Node major; SEA mode requires at least Node 22. */
const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'
const OUT_DIR = 'dist-exe'
/** Staging directory under the repo (dist-exe/ is gitignored). */
const STAGING_DIR = 'dist-exe/paper-staging'
/** Legacy deploy may hoist peer-specialized workspace packages back here. */
const DEPLOY_SOURCE_NODE_MODULES = 'python/sdk-runtime/node_modules'

/**
 * Whole-tree assets cover Cordis's runtime bare-package imports, which pkg's
 * static analysis cannot see. Package manifests are explicit because bare-name
 * resolution depends on them.
 */
const ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  // Package-owned Markdown includes runtime skill instructions and badge content.
  'node_modules/**/*.md',
  'node_modules/**/*.dylib',
  'node_modules/**/*.dll',
  'node_modules/**/*.node',
  'node_modules/**/*.so',
  'node_modules/**/*.so.*',
  'node_modules/**/*.wasm',
  'node_modules/**/*.yaml',
  'node_modules/**/*.yml',
  // Some packages load resources relative to their package root.
  'node_modules/**/*.txt',
  // pty spawn helpers are native binaries beside the addon.
  'node_modules/node-pty/**/*',
  // Ripgrep is spawned as an external binary by the search tool.
  'node_modules/@vscode/ripgrep-*/**/*',
]

const PLATFORMS = ['linux', 'macos', 'win'] as const
const ARCHES = ['x64', 'arm64'] as const
type Platform = (typeof PLATFORMS)[number]
type Arch = (typeof ARCHES)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
class Target {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /** pkg platform tag. */
    readonly platform: Platform,
    /** pkg CPU tag. */
    readonly arch: Arch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-win-x64`.
   * @returns the parsed target.
   */
  static parse(spec: string): Target {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`build-exe-for-paper: target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-win-x64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`build-exe-for-paper: target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPlatform(platform)) {
      throw new Error(`build-exe-for-paper: target ${JSON.stringify(spec)}: platform must be one of ${PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isArch(arch)) {
      throw new Error(`build-exe-for-paper: target ${JSON.stringify(spec)}: arch must be one of ${ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    if (platform === 'win' && arch !== 'x64') {
      throw new Error(`build-exe-for-paper: target ${JSON.stringify(spec)}: Windows supports x64 only.`)
    }
    return new Target(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(): Target {
    const platform = process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'win'
          : undefined
    if (platform === undefined) {
      throw new Error(`build-exe-for-paper: unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`build-exe-for-paper: unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    if (platform === 'win' && arch !== 'x64') {
      throw new Error('build-exe-for-paper: Windows supports x64 only; use an x64 Node process.')
    }
    return new Target(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
class BuildCli {
  private constructor(
    /** Build targets; defaults to the host platform only. */
    readonly targets: readonly Target[],
    /** Skip step 1 (`pnpm run build`); lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Print every command and config patch instead of executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1; invalid or colliding
   * targets throw.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed, validated configuration.
   */
  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-exe-for-paper: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    const targets = values.targets === undefined
      ? [Target.host()]
      : values.targets.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => Target.parse(spec))
    if (targets.length === 0) throw new Error('build-exe-for-paper: --targets is empty.')
    const seen = new Set<string>()
    for (const target of targets) {
      const key = `${target.platform}-${target.arch}`
      if (seen.has(key)) {
        throw new Error(`build-exe-for-paper: duplicate platform-arch ${key} in --targets; canonical product names would collide.`)
      }
      seen.add(key)
    }
    return new BuildCli(targets, values['skip-build'], values['dry-run'])
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'targets': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-exe-for-paper.ts [flags]',
      '',
      '  --targets=<t1,t2,...>  pkg targets, e.g. node24-win-x64,node24-linux-x64.',
      '                         Default: the host platform only (on node24).',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --dry-run              print every command and config patch without executing.',
      '  --help                 print this help.',
      '',
      `Build route: ${PKG_SPEC} --sea; same machinery as the Python SDK runtime build.`,
      `Stages the closure in ${STAGING_DIR} and writes executables to ${OUT_DIR}/.`,
    ].join('\n')
  }
}

function pnpmInvocation(args: string[]): [command: string, args: string[]] {
  const entrypoint = process.env.npm_execpath?.trim()
  if (entrypoint !== undefined && entrypoint !== '') {
    const extension = extname(entrypoint).toLowerCase()
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return [process.execPath, [entrypoint, ...args]]
    }
    if (extension !== '.cmd') return [entrypoint, args]
  }
  const home = process.env.PNPM_HOME?.trim()
  if (home !== undefined && home !== '') {
    const packageBin = resolve(home, '..', 'pnpm', 'bin')
    for (const filename of ['pnpm.mjs', 'pnpm.cjs']) {
      const candidate = resolve(packageBin, filename)
      if (existsSync(candidate)) return [process.execPath, [candidate, ...args]]
    }
  }
  if (process.platform === 'win32') {
    throw new Error('build-exe-for-paper: pnpm must expose a JavaScript entrypoint through npm_execpath or PNPM_HOME on Windows.')
  }
  return ['pnpm', args]
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
class PaperExeBuild {
  /** The cleared deploy target and pkg input. */
  readonly staging = resolve(root, STAGING_DIR)
  private readonly outDir = resolve(root, OUT_DIR)

  constructor(private readonly cli: BuildCli) {}

  /** Verify the closure manifest before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    await this.runPnpm('runtime dependency closure', ['run', 'verify-runtime-closure'])
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-exe-for-paper: skipping pnpm run build (--skip-build)')
      return
    }
    await this.runPnpm('build', ['run', 'build'])
  }

  /** Clear and deploy the runtime closure into the staging directory. */
  async deployStaging(): Promise<void> {
    if (this.staging === root || root.startsWith(this.staging + sep)) {
      throw new Error(`build-exe-for-paper: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-exe-for-paper: [dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.runPnpm('deploy', [
      '--filter',
      DEPLOY_ROOT_PACKAGE,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      this.staging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
  }

  /**
   * Restore direct packages that pnpm's legacy hoister places beside the deploy
   * source instead of in the target. The runtime manifest supplies every peer,
   * so package-local node_modules trees are omitted to preserve one flat Cordis
   * instance and a symlink-free packaged payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-paper: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.staging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `build-exe-for-paper: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.staging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`build-exe-for-paper: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`build-exe-for-paper: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-paper: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    const patch = { bin: ENTRY_BIN, pkg: { assets: ASSET_GLOBS } }
    const manifestPath = join(this.staging, 'package.json')
    if (this.cli.dryRun) {
      console.log(`build-exe-for-paper: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
      return
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`build-exe-for-paper: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, ENTRY_BIN))) {
      throw new Error(`build-exe-for-paper: ${join(this.staging, ENTRY_BIN)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
    console.log(`build-exe-for-paper: injected pkg config into ${manifestPath}`)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the executable and ripgrep sidecar paths.
   */
  async pack(target: Target): Promise<string[]> {
    const productBase = join(this.outDir, `${OUTPUT_BASENAME}-${target.platform}-${target.arch}`)
    const product = target.platform === 'win' ? `${productBase}.exe` : productBase
    await this.prepareNativePty(target)
    if (!this.cli.dryRun) await mkdir(this.outDir, { recursive: true })
    await this.runPnpm(`pkg ${target.spec}`, [
      'dlx',
      PKG_SPEC,
      this.staging,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      product,
    ])
    if (!this.cli.dryRun && !existsSync(product)) {
      throw new Error(`build-exe-for-paper: product ${product} is missing after the pkg run; inspect ${this.outDir}.`)
    }
    const ripgrep = await this.copyRipgrepSidecar(target, product)
    return [product, ripgrep]
  }

  /** Copy the target ripgrep binary beside the executable so Node can spawn it outside pkg's virtual filesystem. */
  private async copyRipgrepSidecar(target: Target, product: string): Promise<string> {
    const platform = target.platform === 'macos' ? 'darwin' : target.platform === 'win' ? 'win32' : target.platform
    const executable = target.platform === 'win' ? 'rg.exe' : 'rg'
    const source = join(
      this.staging,
      'node_modules',
      '@vscode',
      `ripgrep-${platform}-${target.arch}`,
      'bin',
      executable,
    )
    const destination = target.platform === 'win'
      ? `${product.slice(0, -'.exe'.length)}-rg.exe`
      : `${product}-rg`
    if (this.cli.dryRun) {
      console.log(`build-exe-for-paper: [dry-run] cp ${source} ${destination}`)
      return destination
    }
    if (!existsSync(source)) {
      throw new Error(`build-exe-for-paper: target ripgrep binary is missing at ${source}.`)
    }
    await copyFile(source, destination)
    await chmod(destination, 0o755)
    return destination
  }

  /**
   * Put the target node-pty addon in the staged closure. Windows builds must run
   * on Windows; Linux builds must run on the target architecture.
   * @param target - the pkg target whose native addon is being staged.
   */
  private async prepareNativePty(target: Target): Promise<void> {
    const stagedBuild = join(this.staging, 'node_modules', 'node-pty', 'build')
    if (this.cli.dryRun) console.log(`build-exe-for-paper: [dry-run] rm -rf ${stagedBuild}`)
    else await rm(stagedBuild, { recursive: true, force: true })
    const packageDirectory = join(
      root,
      'packages',
      'subprocess',
      'subprocess-local',
      'node_modules',
      'node-pty',
    )
    if (target.platform === 'win') {
      if (target.arch !== 'x64') {
        throw new Error('build-exe-for-paper: Windows supports x64 only.')
      }
      const host = Target.host()
      if (target.platform !== host.platform || target.arch !== host.arch) {
        throw new Error(
          'build-exe-for-paper: build the Windows runtime under x64 Node on its target host; '
          + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
        )
      }
      resolveWindowsNodePtyAddons(join(this.staging, 'node_modules', 'node-pty'), target.arch)
      return
    }
    if (target.platform !== 'linux') return
    const destination = join(stagedBuild, 'Release', 'pty.node')
    const source = resolveLinuxNodePtyAddon(packageDirectory, target.arch)
    if (this.cli.dryRun) {
      console.log(`build-exe-for-paper: [dry-run] cp ${source} ${destination}`)
      return
    }
    const host = Target.host()
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        'build-exe-for-paper: build the Linux runtime on its target architecture; '
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  /**
   * Run a pnpm command from the repo root, inheriting stdio.
   * @param label - a short description for the log.
   * @param args - pnpm arguments.
   */
  private async runPnpm(label: string, args: string[]): Promise<void> {
    const [command, commandArgs] = pnpmInvocation(args)
    console.log(`build-exe-for-paper: ${label}: ${formatCommand(command, commandArgs)}`)
    if (this.cli.dryRun) return
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit' })
    const code = await new Promise<number | null>((resolveExit) => {
      child.on('close', resolveExit)
      child.on('error', (error) => {
        console.error(`build-exe-for-paper: cannot start ${command}: ${error.message}`)
        resolveExit(1)
      })
    })
    if (code !== 0) {
      throw new Error(`build-exe-for-paper: ${label} failed with exit code ${code}: ${formatCommand(command, commandArgs)}`)
    }
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    console.log(this.cli.dryRun ? 'build-exe-for-paper: [dry-run] would produce:' : 'build-exe-for-paper: products:')
    for (const path of products) {
      if (this.cli.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      const megabytes = statSync(path).size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new PaperExeBuild(cli)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
}

void main().catch((error: unknown) => {
  console.error(`build-exe-for-paper: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
