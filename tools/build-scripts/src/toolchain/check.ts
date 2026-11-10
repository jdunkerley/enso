/**
 * @file `toolchain-check`: compares the installed toolchain with the pinned versions. The JVM
 * toolchain comes from `build-config.yaml`'s `toolchain:` block, read by the same parser as
 * `setup-jvm`'s awk and the workflow policy (`tools/ci/toolchain-pins.mjs`); Node, pnpm and Rust
 * come from `.node-version`, `package.json`'s `packageManager` and `rust-toolchain.toml`.
 */
import { readToolchainPins } from '../../../ci/toolchain-pins.mjs'

/** The pinned versions `toolchain-check` compares against. */
export interface Pins {
  /** The GraalVM release (`toolchain.graalvm`): the Maven packages and the download tag. */
  readonly graalvm: string
  /** The GraalVM JDK's own version (`toolchain.graalvm-jdk`); on 25.0.x the release's. */
  readonly graalvmJdk: string
  readonly sbt: string
  readonly flatc: string
  readonly graalpy: string
  readonly node: string
  readonly pnpm: string
  readonly rust: string
}

/** The files the pins come from, as text. */
export interface PinFiles {
  readonly buildConfig: string
  readonly nodeVersion: string
  readonly packageJson: string
  readonly rustToolchain: string
}

/** The pins in `files`; throws, naming the file, when one is missing. */
export function readPins(files: PinFiles): Pins {
  const toolchain = readToolchainPins(files.buildConfig)
  const required = (value: string | undefined, where: string): string => {
    if (value == null || value === '') throw new Error(`No pinned version in ${where}.`)
    return value
  }
  const manifest = JSON.parse(files.packageJson) as { packageManager?: string }
  return {
    graalvm: required(toolchain.graalvm, 'build-config.yaml (`toolchain.graalvm`)'),
    graalvmJdk: required(toolchain['graalvm-jdk'], 'build-config.yaml (`toolchain.graalvm-jdk`)'),
    sbt: required(toolchain.sbt, 'build-config.yaml (`toolchain.sbt`)'),
    flatc: required(toolchain.flatc, 'build-config.yaml (`toolchain.flatc`)'),
    graalpy: required(toolchain.graalpy, 'build-config.yaml (`toolchain.graalpy`)'),
    node: required(files.nodeVersion.trim().replace(/^v/, ''), '.node-version'),
    pnpm: required(
      manifest.packageManager?.match(/^pnpm@([^+]+)/)?.[1],
      'package.json (`packageManager`)',
    ),
    rust: required(
      files.rustToolchain.match(/^\s*channel\s*=\s*"([^"]+)"/m)?.[1],
      'rust-toolchain.toml (`channel`)',
    ),
  }
}

/** One tool to check. */
export interface Tool {
  readonly name: string
  readonly program: string
  readonly args: readonly string[]
  readonly expected: string
  /** The version in the program's output (stdout and stderr together), or `null`. */
  readonly parse: (output: string) => string | null
  /** A missing tool fails the check. */
  readonly required: boolean
  /** A different version fails the check; otherwise it is a warning. */
  readonly strict: boolean
  /** Whether `found` is the expected version; plain equality when absent. */
  readonly accepts?: (found: string) => boolean
  readonly hint: string
}

/**
 * GraalVM's release and JDK versions in `java -version`'s output, as `<release> (JDK <jdk>)`, or
 * `null`. The vendor line names the release and its build the JDK: `GraalVM CE 25.0.1+8.1 (build
 * 25.0.1+8-jvmci-b01)` on 25.0.x, `GraalVM CE 25.5.5.0.3+1.1 (build 25.0.5.0.3+1-jvmci-25.5-b26)`
 * on the innovation line (Note [GraalVM Follows The Innovation Line] in
 * `project/Dependencies.scala`).
 */
export function parseGraalVM(output: string): string | null {
  const match = output.match(/GraalVM CE (\d+(?:\.\d+)*)\S* \(build (\d+(?:\.\d+)*)\+/)
  return match == null ? null : graalVMVersions(match[1]!, match[2]!)
}

function graalVMVersions(release: string, jdk: string): string {
  return `${release} (JDK ${jdk})`
}

/**
 * Where the GraalVM CE JDK for these pins is downloaded: the innovation line's `graal-<release>`
 * tag, or `jdk-<version>` on 25.0.x, where the JDK and the release share a version.
 */
export function graalVMDownload(pins: Pick<Pins, 'graalvm' | 'graalvmJdk'>): string {
  const tag = pins.graalvm === pins.graalvmJdk ? `jdk-${pins.graalvm}` : `graal-${pins.graalvm}`
  return `https://github.com/graalvm/graalvm-ce-builds/releases/tag/${tag}`
}

/** The tools to check, in the order they are reported. */
export function toolsToCheck(pins: Pins): Tool[] {
  const sdkman =
    pins.graalvm === pins.graalvmJdk ?
      ` (SDKMAN: \`sdk install java ${pins.graalvm}-graalce\`)`
    : ''
  return [
    {
      name: 'GraalVM',
      program: 'java',
      args: ['-version'],
      expected: graalVMVersions(pins.graalvm, pins.graalvmJdk),
      parse: parseGraalVM,
      required: true,
      strict: true,
      hint: `Install GraalVM Community ${pins.graalvm} (JDK ${pins.graalvmJdk}) from ${graalVMDownload(pins)}${sdkman}, first on the PATH, with JAVA_HOME pointing at it. sbt refuses any other JDK.`,
    },
    {
      name: 'sbt launcher',
      program: 'sbt',
      args: ['--script-version'],
      expected: pins.sbt,
      parse: (output) => output.match(/^(\d+\.\d+\.\d+\S*)\s*$/m)?.[1] ?? null,
      required: true,
      strict: false,
      hint: `Install the sbt launcher (https://www.scala-sbt.org/download). CI uses ${pins.sbt}; \`project/build.properties\` decides the sbt version either way.`,
    },
    {
      name: 'flatc',
      program: 'flatc',
      args: ['--version'],
      expected: pins.flatc,
      parse: (output) => output.match(/flatc version (\S+)/)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Download flatc ${pins.flatc} from https://github.com/google/flatbuffers/releases/tag/v${pins.flatc} and put it on the PATH.`,
    },
    {
      name: 'Node',
      program: 'node',
      args: ['--version'],
      expected: pins.node,
      parse: (output) => output.match(/^v(\S+)/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Install Node ${pins.node} (\`.node-version\`), e.g. with fnm or nvm.`,
    },
    {
      name: 'pnpm',
      program: 'corepack',
      args: ['pnpm', '--version'],
      expected: pins.pnpm,
      parse: (output) => output.match(/^(\d+\.\d+\.\d+\S*)\s*$/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Run \`corepack enable\`: corepack then provides pnpm ${pins.pnpm} (\`packageManager\` in package.json).`,
    },
    {
      name: 'Rust',
      program: 'rustc',
      args: ['--version'],
      expected: pins.rust,
      parse: (output) => output.match(/^rustc (\S+)/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Install rustup (https://rustup.rs); in this repository it installs ${pins.rust} from rust-toolchain.toml on first use.`,
    },
    {
      name: 'GraalPy',
      program: 'graalpy',
      args: ['--version'],
      expected: pins.graalpy,
      parse: (output) => output.match(/GraalVM CE Native (\d+(?:\.\d+)*)/)?.[1] ?? null,
      // GraalPy 25.5.5 reports the GraalVM release it was built from, 25.5.5.0.3.
      accepts: (found) => found === pins.graalpy || found.startsWith(`${pins.graalpy}.`),
      required: false,
      strict: false,
      hint: `Optional: only test/Examples_Tests' Python spec runs it, and is skipped without it. Download the community standalone (\`graalpy3.<n>-community-${pins.graalpy}-…\`, or \`graalpy-community-${pins.graalpy}-…\` before 25.5) from https://github.com/oracle/graalpython/releases/tag/graal-${pins.graalpy} and put its bin on the PATH.`,
    },
  ]
}

/** What one check found. */
export interface Result {
  readonly tool: Tool
  readonly found: string | null
  readonly status: 'ok' | 'mismatch' | 'missing'
  /** Whether this result fails the check. */
  readonly fails: boolean
}

/** The result for `tool`, given how its program exited and what it printed. */
export function evaluate(tool: Tool, exitStatus: number, output: string): Result {
  const found = tool.parse(output)
  if (found == null) {
    return {
      tool,
      found: exitStatus === 0 ? (output.trim().split('\n')[0] ?? '') : null,
      status: 'missing',
      fails: tool.required,
    }
  }
  const accepted = tool.accepts?.(found) ?? found === tool.expected
  if (accepted) return { tool, found, status: 'ok', fails: false }
  return { tool, found, status: 'mismatch', fails: tool.strict }
}

/** The report, one line per tool plus a hint under each problem. */
export function report(results: readonly Result[]): string[] {
  const width = Math.max(...results.map((result) => result.tool.name.length))
  const lines: string[] = []
  for (const result of results) {
    const label =
      result.status === 'ok' ? 'ok'
      : result.fails ? 'FAIL'
      : 'warn'
    const name = result.tool.name.padEnd(width)
    const detail =
      result.status === 'ok' ? result.tool.expected
      : result.status === 'mismatch' ? `${result.found} installed, ${result.tool.expected} pinned`
      : result.found != null ? `unrecognised output: ${result.found}`
      : `not found (${result.tool.program})`
    lines.push(`${label.padEnd(4)}  ${name}  ${detail}`)
    if (result.status !== 'ok') lines.push(`      ${' '.repeat(width)}  ${result.tool.hint}`)
  }
  return lines
}
