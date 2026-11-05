/** @file The headless training driver against a fake Language Server. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { driveOpen, welcomeNodeId } from '../driver.js'
import { startFakeLanguageServer, type FakeLanguageServer } from './fakeLanguageServer.js'

const TEMPLATE_MAIN = path.resolve(
  import.meta.dirname,
  '../../../../../lib/scala/pkg/src/main/resources/default/src/Main.enso',
)
const WELCOME_NODE = 'fcf199e6-d2b1-44b7-be92-a47545d6a593'
const TOKEN = 'a'.repeat(64)

let root: string
let ls: FakeLanguageServer | undefined

/** A project made from the real template, as `enso --new` makes it. */
async function project(): Promise<string> {
  const projectRoot = path.join(root, 'Train')
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'package.yaml'), 'name: Train\nnamespace: local\n')
  await fs.copyFile(TEMPLATE_MAIN, path.join(projectRoot, 'src', 'Main.enso'))
  return projectRoot
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-driver-'))
})

afterEach(async () => {
  await ls?.close()
  ls = undefined
  await fs.rm(root, { recursive: true, force: true })
})

test('welcomeNodeId finds the template node with a visualisation shown', async () => {
  expect(welcomeNodeId(await fs.readFile(TEMPLATE_MAIN, 'utf8'))).toBe(WELCOME_NODE)
  expect(welcomeNodeId('main = 42\n')).toBeUndefined()
})

test('driveOpen plays an open: init, create, push, then attach the welcome node', async () => {
  ls = await startFakeLanguageServer({ token: TOKEN })
  await driveOpen({
    rpcPort: ls.port,
    token: TOKEN,
    projectRoot: await project(),
    timeoutMs: 10_000,
  })
  const sent = ls.received.filter((r) => r.channel === 'json' || r.channel === 'vis-control')
  expect(
    sent.map(
      (r) =>
        (r.message as { method?: string; kind?: string }).method ??
        (r.message as { kind?: string }).kind,
    ),
  ).toEqual([
    'session/initProtocolConnection',
    'executionContext/create',
    'executionContext/push',
    'attach',
  ])
  const push = sent[2]!.message as { params: { contextId: string; stackItem: unknown } }
  expect(push.params.stackItem).toEqual({
    type: 'ExplicitCall',
    methodPointer: { module: 'local.Train.Main', definedOnType: 'local.Train.Main', name: 'main' },
    positionalArgumentsExpressions: [],
  })
  const attach = sent[3]!.message as Record<string, unknown>
  expect(attach).toMatchObject({
    kind: 'attach',
    contextId: push.params.contextId,
    nodeExternalId: WELCOME_NODE,
    request: {
      visualizationModule: 'Standard.Visualization.Table.Visualization',
      expression: {
        module: 'Standard.Visualization.Table.Visualization',
        definedOnType: 'Standard.Visualization.Table.Visualization',
        name: 'prepare_visualization',
      },
      positionalArgumentsExpressions: ['1000'],
    },
  })
})

test('driveOpen rejects after timeoutMs when the execution never completes', async () => {
  ls = await startFakeLanguageServer({ token: TOKEN, completeAfterMs: null })
  const projectRoot = await project()
  const started = Date.now()
  await expect(
    driveOpen({ rpcPort: ls.port, token: TOKEN, projectRoot, timeoutMs: 500 }),
  ).rejects.toThrow(/did not finish in 500 ms/)
  expect(Date.now() - started).toBeLessThan(5_000)
})

test('driveOpen rejects a wrong token', async () => {
  ls = await startFakeLanguageServer({ token: TOKEN })
  await expect(
    driveOpen({ rpcPort: ls.port, token: 'wrong', projectRoot: await project(), timeoutMs: 5_000 }),
  ).rejects.toThrow(/403/)
})

test('driveOpen stops on abort', async () => {
  ls = await startFakeLanguageServer({ token: TOKEN, completeAfterMs: null })
  const projectRoot = await project()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 200)
  await expect(
    driveOpen({
      rpcPort: ls.port,
      token: TOKEN,
      projectRoot,
      timeoutMs: 10_000,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
