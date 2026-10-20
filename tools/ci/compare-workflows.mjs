#!/usr/bin/env node
// Compares two versions of the workflows job by job, and prints the differences as Markdown.
//
//     node tools/ci/compare-workflows.mjs --base <git-ref> [--head <git-ref> | --head-dir <dir>]
//          [--rename "<base job>=<head job>"]... <workflow file>...
//
// For each job it lists the name, `runs-on`, `needs`, `if`, env, permissions,
// `continue-on-error`, `timeout-minutes`, and every step: the command it runs (with its shell) or
// the action it uses (with its inputs), its condition and its env. Secrets, variables and the
// artifacts uploaded and downloaded are listed per job. It expands `strategy.matrix`, calls to
// local reusable workflows (`uses: ./.github/workflows/…`, flattened: the called jobs keep their
// own names) and local composite actions (`uses: ./.github/actions/…`, inlined), and drops the
// steps and jobs whose condition is decided by the platform, a matrix value or an input. So a
// hand-written workflow compares job for job with the generated one it replaces.
//
// Without `--head` or `--head-dir` the head is the working tree. Jobs are matched by name; two
// base jobs with the same name are told apart by `[runs-on]`, and `--rename` pairs a base job
// with a differently named head job (it applies to `needs` too).
//
// Temporary: it reviews the build simplification's Phase 1 pull requests, and is deleted with the
// CI generator at the end of that phase.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

// === Reading ===

/** Reads repository files as of a git ref; `null` when absent. */
export function gitReader(ref, cwd = process.cwd()) {
  return (file) => {
    try {
      return execFileSync('git', ['show', `${ref}:${file}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      return null
    }
  }
}

/** Reads repository files from a directory; `null` when absent. */
export function dirReader(dir) {
  return (file) => {
    const target = path.join(dir, file)
    return existsSync(target) ? readFileSync(target, 'utf8') : null
  }
}

// === Expressions ===

const EXPRESSION = /\$\{\{\s*([\s\S]*?)\s*\}\}/g
const REFERENCE = /\b(matrix|inputs)\.([A-Za-z0-9_-]+)/g

function lookup(context, reference) {
  const match = /^(matrix|inputs)\.([A-Za-z0-9_-]+)$/.exec(reference.trim())
  if (!match) return undefined
  const scope = context[match[1]]
  return scope && Object.hasOwn(scope, match[2]) ? scope[match[2]] : undefined
}

/** A value as an expression literal; a value that is itself an expression is inlined. */
function literal(value) {
  if (typeof value !== 'string') return JSON.stringify(value)
  const expression = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(value)
  return expression ? `(${expression[1]})` : `'${value.replace(/'/g, "''")}'`
}

/**
 * Replaces the known `matrix.*` and `inputs.*` references, and `runner.os` once the job's
 * platform is known, inside a bare expression.
 */
function substituteInExpression(expression, context) {
  const replaced = expression.replace(REFERENCE, (reference) => {
    const value = lookup(context, reference)
    return value === undefined ? reference : literal(value)
  })
  return context.runnerOs ? replaced.replace(/\brunner\.os\b/g, `'${context.runnerOs}'`) : replaced
}

/** Folds `'a' == 'b'` and `'a' == 'b' && 'x' || 'y'` once both sides are literals. */
function fold(expression) {
  const comparison = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(expression)
  if (comparison)
    return String(
      (comparison[1].toLowerCase() === comparison[3].toLowerCase()) === (comparison[2] === '=='),
    )
  const choice = /^'([^']*)'\s*(==|!=)\s*'([^']*)'\s*&&\s*'([^']*)'\s*\|\|\s*'([^']*)'$/.exec(
    expression,
  )
  if (choice) {
    const holds = (choice[1].toLowerCase() === choice[3].toLowerCase()) === (choice[2] === '==')
    return holds ? choice[4] : choice[5]
  }
  return undefined
}

/** Replaces the known `matrix.*` and `inputs.*` references in a YAML value, recursively. */
export function substitute(value, context) {
  if (typeof value === 'string') {
    const whole = /^\$\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(value)
    if (whole) {
      const found = lookup(context, whole[1])
      if (found !== undefined) return found
    }
    return value.replace(EXPRESSION, (all, inner) => {
      const found = lookup(context, inner)
      if (found !== undefined) return typeof found === 'string' ? found : JSON.stringify(found)
      const replaced = substituteInExpression(inner, context).trim()
      return fold(replaced) ?? `\${{ ${replaced} }}`
    })
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, context)]),
    )
  }
  return value
}

/** Splits at a top-level operator, outside quotes and parentheses. */
function splitTopLevel(expression, operator) {
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "'") quoted = !quoted
    if (quoted) continue
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index))
      start = index + operator.length
      index += operator.length - 1
    }
  }
  parts.push(expression.slice(start))
  return parts.map((part) => part.trim())
}

/** Whether the first parenthesis closes at the very end. */
function wrapsWhole(expression) {
  let depth = 0
  let quoted = false
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "'") quoted = !quoted
    if (quoted) continue
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0 && index < expression.length - 1) return false
    }
  }
  return depth === 0
}

function stripParentheses(expression) {
  let current = expression.trim()
  while (current.startsWith('(') && current.endsWith(')') && wrapsWhole(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
}

/**
 * Decides what it can of a condition: comparisons of the runner's OS, matrix values and inputs.
 * Returns `{ keep: false }` when the condition is statically false, else `{ keep: true, rest }`
 * with the conjuncts it could not decide (`undefined` when none are left).
 */
export function evaluateCondition(condition, context, runnerOs) {
  if (condition === undefined || condition === null) return { keep: true, rest: undefined }
  if (condition === false) return { keep: false }
  if (condition === true) return { keep: true, rest: undefined }
  let expression = String(condition).trim()
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expression)
  if (wrapped) expression = wrapped[1].trim()
  expression = substituteInExpression(expression, context)
  if (runnerOs) expression = expression.replace(/\brunner\.os\b/g, `'${runnerOs}'`)
  expression = stripParentheses(expression)
  const conjuncts =
    splitTopLevel(expression, '||').length > 1 ? [expression] : splitTopLevel(expression, '&&')
  const rest = []
  for (const conjunct of conjuncts) {
    const part = stripParentheses(conjunct)
    const comparison = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(part)
    if (comparison) {
      const equal = comparison[1].toLowerCase() === comparison[3].toLowerCase()
      if ((comparison[2] === '==') !== equal) return { keep: false }
      continue
    }
    if (part === 'true') continue
    if (part === 'false') return { keep: false }
    rest.push(splitTopLevel(part, '||').length > 1 ? `(${part})` : part)
  }
  return { keep: true, rest: rest.length > 0 ? rest.join(' && ') : undefined }
}

function fromJson(value) {
  if (typeof value !== 'string') return value
  const match = /^\$\{\{\s*fromJSON\(\s*'([\s\S]*)'\s*\)\s*\}\}$/.exec(value.trim())
  return match ? JSON.parse(match[1].replace(/''/g, "'")) : value
}

// === Expansion ===

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The legs of a job's matrix, as objects; `[null]` for a job without a matrix. */
export function matrixLegs(strategy, context) {
  if (strategy?.matrix === undefined) return [null]
  const matrix = fromJson(substitute(strategy.matrix, context))
  const { include, exclude, ...axes } = matrix
  let legs = [{}]
  for (const [key, values] of Object.entries(axes)) {
    const list = [fromJson(values)].flat()
    legs = legs.flatMap((leg) => list.map((value) => ({ ...leg, [key]: value })))
  }
  if (Object.keys(axes).length === 0) legs = []
  for (const excluded of [fromJson(exclude) ?? []].flat()) {
    legs = legs.filter(
      (leg) => !Object.entries(excluded).every(([key, value]) => sameValue(leg[key], value)),
    )
  }
  const axisKeys = Object.keys(axes)
  for (const included of [fromJson(include) ?? []].flat()) {
    const keys = axisKeys.filter((key) => key in included)
    const matching =
      keys.length > 0 ?
        legs.filter((leg) => keys.every((key) => sameValue(leg[key], included[key])))
      : []
    if (matching.length === 0) legs.push({ ...included })
    else for (const leg of matching) Object.assign(leg, included)
  }
  return legs
}

export function runnerOsOf(runsOn) {
  const labels = [runsOn ?? []].flat().map(String).join(' ').toLowerCase()
  if (labels.includes('windows')) return 'Windows'
  if (labels.includes('macos')) return 'macOS'
  if (labels.includes('ubuntu') || labels.includes('linux')) return 'Linux'
  return undefined
}

const normalizeToken = (value) =>
  typeof value === 'string' ? value.replace(/\bgithub\.token\b/g, 'secrets.GITHUB_TOKEN') : value

function render(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const oneLine = (text) => normalizeToken(String(text)).replace(/\s+/g, ' ').trim()

/** The steps of a job, with local composite actions inlined. */
function expandSteps(steps, context, runnerOs, read, outerCondition) {
  const result = []
  for (const step of steps ?? []) {
    const condition = evaluateCondition(step.if, context, runnerOs)
    if (!condition.keep) continue
    const combined = [outerCondition, condition.rest].filter(Boolean).join(' && ') || undefined
    const { if: _ignored, ...body } = step
    const resolved = substitute(body, { ...context, runnerOs })
    const uses = resolved.uses === undefined ? undefined : String(resolved.uses)
    if (uses?.startsWith('./.github/actions/')) {
      const text = read(`${uses.slice(2).replace(/\/$/, '')}/action.yml`)
      if (text === null) throw new Error(`Missing composite action ${uses}`)
      const action = parse(text)
      const inputs = Object.fromEntries(
        Object.entries(action.inputs ?? {}).map(([name, spec]) => [name, spec?.default]),
      )
      Object.assign(inputs, resolved.with ?? {})
      result.push(
        ...expandSteps(action.runs?.steps, { ...context, inputs }, runnerOs, read, combined),
      )
      continue
    }
    const shell = resolved.shell ?? (runnerOs === 'Windows' ? 'pwsh' : 'bash')
    result.push({
      uses,
      run: resolved.run,
      shell,
      with: resolved.with,
      env: resolved.env,
      if: combined,
    })
  }
  return result
}

function stepLine(step) {
  const parts = []
  if (step.run !== undefined) parts.push(`run[${step.shell}]: ${oneLine(step.run)}`)
  if (step.uses !== undefined) parts.push(`uses: ${step.uses}`)
  if (step.with) {
    const inputs = Object.entries(step.with)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${oneLine(render(value))}`)
    parts.push(`with: ${inputs.join('; ')}`)
  }
  if (step.if) parts.push(`if: ${oneLine(step.if)}`)
  if (step.env) {
    const env = Object.entries(step.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${oneLine(render(value))}`)
    parts.push(`env: ${env.join('; ')}`)
  }
  return `step: ${parts.join(' | ')}`
}

function jobLines(job) {
  const lines = []
  lines.push(`runs-on: ${[job.runsOn ?? []].flat().map(render).join(', ')}`)
  for (const need of [...job.needs].sort()) lines.push(`needs: ${need}`)
  if (job.if) lines.push(`if: ${oneLine(job.if)}`)
  for (const [key, value] of Object.entries(job.env).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`env: ${key}=${oneLine(render(value))}`)
  }
  if (job.permissions !== undefined) lines.push(`permissions: ${render(job.permissions)}`)
  if (job.continueOnError !== undefined)
    lines.push(`continue-on-error: ${render(job.continueOnError)}`)
  if (job.timeout !== undefined) lines.push(`timeout-minutes: ${render(job.timeout)}`)
  for (const step of job.steps) lines.push(stepLine(step))
  const text = normalizeToken(JSON.stringify({ ...job, needs: [] }))
  const names = (pattern) =>
    [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort()
  const secrets = names(/secrets\.([A-Za-z0-9_]+)/g)
  const vars = names(/vars\.([A-Za-z0-9_]+)/g)
  if (secrets.length > 0) lines.push(`secrets: ${secrets.join(', ')}`)
  if (vars.length > 0) lines.push(`vars: ${vars.join(', ')}`)
  const artifacts = (action) =>
    job.steps
      .filter((step) => step.uses?.startsWith(`actions/${action}-artifact@`))
      .map((step) => render(step.with?.name ?? step.with?.pattern ?? '(all)'))
  const uploads = artifacts('upload')
  const downloads = artifacts('download')
  if (uploads.length > 0) lines.push(`uploads: ${uploads.join(', ')}`)
  if (downloads.length > 0) lines.push(`downloads: ${downloads.join(', ')}`)
  return lines
}

/**
 * Expands a workflow into its jobs: `{ header: string[], jobs: Map<name, string[]> }`. `inputs`
 * are the values a caller passes (the called workflow's defaults fill the rest).
 */
export function expandWorkflow(read, file, inputs = {}, collected = []) {
  const text = read(file)
  if (text === null) throw new Error(`Missing workflow ${file}`)
  const doc = parse(text)
  const declared = doc.on?.workflow_call?.inputs ?? {}
  const workflowInputs = {
    ...Object.fromEntries(Object.entries(declared).map(([name, spec]) => [name, spec?.default])),
    ...inputs,
  }
  const baseContext = { inputs: workflowInputs }
  const workflowEnv = substitute(doc.env ?? {}, baseContext)
  const entriesById = new Map()
  const pending = []
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    entriesById.set(id, [])
    for (const leg of matrixLegs(job.strategy, baseContext)) {
      const context = { inputs: workflowInputs, matrix: leg ?? {} }
      const condition = evaluateCondition(job.if, context, undefined)
      if (!condition.keep) continue
      if (typeof job.uses === 'string' && job.uses.startsWith('./.github/workflows/')) {
        const before = collected.length
        expandWorkflow(read, job.uses.slice(2), substitute(job.with ?? {}, context), collected)
        entriesById.get(id).push(...collected.slice(before))
        continue
      }
      const rawName = job.name ?? id
      let name = String(substitute(rawName, context))
      if (leg && Object.keys(leg).length > 0 && !/matrix\./.test(String(rawName))) {
        name += ` (${Object.values(leg).map(render).join(', ')})`
      }
      const runsOn = substitute(job['runs-on'], context)
      const runnerOs = runnerOsOf(runsOn)
      const entry = {
        name,
        runsOn,
        needIds: [job.needs ?? []].flat(),
        needs: [],
        if:
          condition.rest === undefined ?
            undefined
          : evaluateCondition(condition.rest, context, runnerOs).rest,
        env: { ...workflowEnv, ...substitute(job.env ?? {}, context) },
        permissions: job.permissions,
        continueOnError: substitute(job['continue-on-error'], context),
        timeout: job['timeout-minutes'],
        steps: expandSteps(job.steps, context, runnerOs, read, undefined),
      }
      entriesById.get(id).push(entry)
      pending.push(entry)
      collected.push(entry)
    }
  }
  for (const entry of pending) {
    entry.needs = entry.needIds.flatMap((id) => entriesById.get(id) ?? [{ name: `?${id}` }])
  }
  return { doc, jobs: collected }
}

/** Header lines and job lines for one entry workflow. */
export function describeWorkflow(read, file) {
  const { doc, jobs } = expandWorkflow(read, file)
  const header = [
    `name: ${render(doc.name)}`,
    `on: ${render(doc.on)}`,
    `concurrency: ${render(doc.concurrency)}`,
    `permissions: ${render(doc.permissions)}`,
    `env: ${render(doc.env)}`,
  ]
  const counts = new Map()
  for (const job of jobs) counts.set(job.name, (counts.get(job.name) ?? 0) + 1)
  const keyOf = (job) =>
    counts.get(job.name) > 1 ? `${job.name} [${[job.runsOn].flat().join(', ')}]` : job.name
  const byName = new Map()
  for (const job of jobs) {
    const needs = job.needs.map((need) => (counts.has(need.name) ? keyOf(need) : need.name))
    byName.set(keyOf(job), jobLines({ ...job, needs }))
  }
  return { header, jobs: byName }
}

// === Diff ===

/** A line diff (longest common subsequence); `[]` when equal. */
export function diffLines(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j] ?
          table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) out.push(`- ${before[i++]}`)
    else out.push(`+ ${after[j++]}`)
  }
  while (i < before.length) out.push(`- ${before[i++]}`)
  while (j < after.length) out.push(`+ ${after[j++]}`)
  return out
}

/** The Markdown report for one entry workflow. */
export function compareWorkflow(baseRead, headRead, file, renames = new Map()) {
  const rename = (name) => renames.get(name) ?? name
  const describe = (read) => {
    try {
      return describeWorkflow(read, file)
    } catch (error) {
      if (/^Missing workflow/.test(error.message)) return { header: [], jobs: new Map() }
      throw error
    }
  }
  const base = describe(baseRead)
  const head = describe(headRead)
  const baseJobs = new Map(
    [...base.jobs].map(([name, lines]) => [
      rename(name),
      lines.map((line) => (line.startsWith('needs: ') ? `needs: ${rename(line.slice(7))}` : line)),
    ]),
  )
  const out = [`## \`${file}\``, '']
  const headerDiff = diffLines(base.header, head.header)
  if (headerDiff.length > 0) out.push('### Workflow', '', '```diff', ...headerDiff, '```', '')
  const same = []
  for (const name of [...new Set([...baseJobs.keys(), ...head.jobs.keys()])]) {
    const before = baseJobs.get(name)
    const after = head.jobs.get(name)
    if (before && after) {
      const diff = diffLines(before, after)
      if (diff.length === 0) same.push(name)
      else out.push(`### ${name}`, '', '```diff', ...diff, '```', '')
    } else if (before) {
      out.push(
        `### ${name} (only in base)`,
        '',
        '```diff',
        ...before.map((line) => `- ${line}`),
        '```',
        '',
      )
    } else {
      out.push(
        `### ${name} (only in head)`,
        '',
        '```diff',
        ...after.map((line) => `+ ${line}`),
        '```',
        '',
      )
    }
  }
  if (same.length > 0) out.push('### Unchanged jobs', '', ...same.map((name) => `- ${name}`), '')
  return out.join('\n')
}

function main(argv) {
  let base
  let headRead
  const renames = new Map()
  const files = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--base') base = argv[++index]
    else if (arg === '--head') headRead = gitReader(argv[++index])
    else if (arg === '--head-dir') headRead = dirReader(path.resolve(argv[++index]))
    else if (arg === '--rename') {
      const [from, to] = argv[++index].split('=')
      renames.set(from, to)
    } else files.push(arg)
  }
  if (!base || files.length === 0) {
    console.error(
      'Usage: compare-workflows.mjs --base <ref> [--head <ref> | --head-dir <dir>] [--rename "a=b"]... <workflow>...',
    )
    process.exit(2)
  }
  const baseRead = gitReader(base)
  headRead ??= dirReader(process.cwd())
  const reports = files.map((file) =>
    compareWorkflow(
      baseRead,
      headRead,
      path.posix.join('.github/workflows', path.basename(file)),
      renames,
    ),
  )
  console.log(`# Workflow comparison: \`${base}\` → head\n\n${reports.join('\n')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))
