import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { ObservableV2 } from 'lib0/observable'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  EDIT_ANSWER_MARGIN_MS,
  EDIT_MIN_REMAINING_MS,
  EDIT_SETTLE_MS,
  EDIT_STEP_IDLE_MS,
  EditSession,
  GRAPH_UPDATE_WAIT_MS,
  LIVE_EDIT_ERROR,
  NOT_ON_SCREEN_ERROR,
  TIMED_OUT_BEFORE_RUN_ERROR,
  type EditSessionDeps,
} from '../editSession'
import {
  watchExecution,
  watchGraphUpdate,
  type AffectedExpressions,
  type ExecutionWatch,
  type ExpressionUpdateLike,
  type GraphUpdateWatch,
} from '../projectEvents'

const claude = { kind: 'external', name: 'claude-code' } as const
const codex = { kind: 'external', name: 'codex' } as const

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

interface FakeWatch extends ExecutionWatch {
  readonly editApplied: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
  done: boolean
}

interface FakeGraphWatch extends GraphUpdateWatch {
  readonly cancel: ReturnType<typeof vi.fn>
  done: boolean
}

/**
 * The session over fakes. `settle` answers each execution watch's `settled`, and `graphUpdated`
 * each graph watch's `updated` (both true by default); `watches` and `graphWatches` are the watches
 * the session started, `openWatches()` those of either kind neither finished nor cancelled.
 */
function setup({
  settle: settleImpl = async () => true,
  graphUpdated: graphUpdatedImpl = async () => true,
  ...overrides
}: Partial<EditSessionDeps> & {
  settle?: (affected: AffectedExpressions, timeoutMs: number) => Promise<boolean>
  graphUpdated?: (timeoutMs: number) => Promise<boolean>
} = {}) {
  const log: string[] = []
  const settle = vi.fn(settleImpl)
  const updated = vi.fn(graphUpdatedImpl)
  const watches: FakeWatch[] = []
  const graphWatches: FakeGraphWatch[] = []
  let live = false
  let active = true
  let foreign: (() => void) | undefined
  let failNextSetTimeout = false
  const timers: { f: () => void; ms: number; handle: number; cleared: boolean }[] = []
  const unsubscribe = vi.fn()
  const release = vi.fn(() => {
    log.push('release')
  })
  const deps: EditSessionDeps = {
    isLive: () => live,
    isActive: () => active,
    holdUndoStep: vi.fn(() => {
      log.push('hold')
      return release
    }),
    onForeignEdit: (listener) => {
      foreign = listener
      return unsubscribe
    },
    saveVersion: vi.fn(async (comment: string) => {
      log.push(`save:${comment}`)
    }),
    watchGraphUpdate: vi.fn(() => {
      const watch: FakeGraphWatch = {
        done: false,
        updated: (timeoutMs) =>
          updated(timeoutMs).finally(() => {
            watch.done = true
          }),
        cancel: vi.fn(() => {
          watch.done = true
        }),
      }
      graphWatches.push(watch)
      return watch
    }),
    watchExecution: vi.fn(() => {
      const watch: FakeWatch = {
        done: false,
        editApplied: vi.fn(),
        settled: (affected, timeoutMs) =>
          settle(affected, timeoutMs).finally(() => {
            watch.done = true
          }),
        cancel: vi.fn(() => {
          watch.done = true
        }),
      }
      watches.push(watch)
      return watch
    }),
    now: () => 0,
    setTimeout: (f, ms) => {
      if (failNextSetTimeout) {
        failNextSetTimeout = false
        throw new Error('no timers today')
      }
      const handle = timers.length + 1
      timers.push({ f, ms, handle, cleared: false })
      return handle
    },
    clearTimeout: (handle) => {
      const timer = timers.find((t) => t.handle === handle)
      if (timer) timer.cleared = true
    },
    ...overrides,
  }
  const session = new EditSession(deps)
  const pending = () => timers.filter((t) => !t.cleared)
  return {
    session,
    deps,
    log,
    settle,
    watches,
    updated,
    graphWatches,
    openWatches: () => [...watches, ...graphWatches].filter((watch) => !watch.done),
    release,
    unsubscribe,
    pending,
    setLive: (v: boolean) => {
      live = v
    },
    setActive: (v: boolean) => {
      active = v
    },
    foreign: () => foreign?.(),
    failNextSetTimeout: () => {
      failNextSetTimeout = true
    },
    /** Fires the single armed timer. */
    fire: () => {
      const armed = pending()
      expect(armed).toHaveLength(1)
      armed[0]!.cleared = true
      armed[0]!.f()
    },
  }
}

const okEdit = (log: string[]) => () => {
  log.push('edit')
  return Ok('done')
}

describe('EditSession', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  test('refuses in Live mode without touching anything', async () => {
    t.setLive(true)
    const edit = vi.fn(() => Ok(1))
    const result = await t.session.run(claude, edit)
    expect(errorOf(result)).toBe(LIVE_EDIT_ERROR)
    expect(edit).not.toHaveBeenCalled()
    expect(t.deps.saveVersion).not.toHaveBeenCalled()
    expect(t.deps.holdUndoStep).not.toHaveBeenCalled()
  })

  test('first run saves a version, holds a step, then edits', async () => {
    const result = await t.session.run(claude, okEdit(t.log))
    expect(t.log).toEqual(['save:Before changes by claude-code', 'hold', 'edit'])
    expect(result).toEqual(Ok({ value: 'done', settled: true }))
  })

  test('the chat is labelled "the chat"', async () => {
    await t.session.run({ kind: 'chat' }, okEdit(t.log))
    expect(t.log[0]).toBe('save:Before changes by the chat')
  })

  test('a second run by the same caller joins the step', async () => {
    await t.session.run(claude, okEdit(t.log))
    await t.session.run(claude, okEdit(t.log))
    expect(t.deps.saveVersion).toHaveBeenCalledTimes(1)
    expect(t.deps.holdUndoStep).toHaveBeenCalledTimes(1)
    expect(t.release).not.toHaveBeenCalled()
  })

  test('the idle timer releases the step; the next run saves and holds again', async () => {
    await t.session.run(claude, okEdit(t.log))
    expect(t.pending()).toHaveLength(1)
    expect(t.pending()[0]!.ms).toBe(EDIT_STEP_IDLE_MS)
    t.fire()
    expect(t.release).toHaveBeenCalledTimes(1)
    await t.session.run(claude, okEdit(t.log))
    expect(t.deps.saveVersion).toHaveBeenCalledTimes(2)
    expect(t.deps.holdUndoStep).toHaveBeenCalledTimes(2)
  })

  test('no idle timer runs during a run; the idle period starts when it ends', async () => {
    let finishSettle: (settled: boolean) => void = () => {}
    const t2 = setup({
      settle: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
    })
    const running = t2.session.run(claude, () => Ok(1))
    await vi.waitFor(() => expect(t2.updated).toHaveBeenCalled())
    expect(t2.pending()).toHaveLength(0)
    expect(t2.release).not.toHaveBeenCalled()
    finishSettle(true)
    await running
    expect(t2.pending()).toHaveLength(1)
    expect(t2.pending()[0]!.ms).toBe(EDIT_STEP_IDLE_MS)
    // A second run by the same caller before the timer fires joins the step.
    const second = t2.session.run(claude, () => Ok(2))
    await vi.waitFor(() => expect(t2.pending()).toHaveLength(0))
    await vi.waitFor(() => expect(t2.updated).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    finishSettle(true)
    await second
    expect(t2.deps.saveVersion).toHaveBeenCalledTimes(1)
    expect(t2.deps.holdUndoStep).toHaveBeenCalledTimes(1)
  })

  test('a starting run cancels the pending timer of the previous one', async () => {
    await t.session.run(claude, okEdit(t.log))
    const firstTimer = t.pending()[0]!
    let duringEdit = -1
    await t.session.run(claude, () => {
      duringEdit = t.pending().length
      return Ok(1)
    })
    expect(firstTimer.cleared).toBe(true)
    expect(duringEdit).toBe(0)
    expect(t.pending()).toHaveLength(1)
  })

  test('a foreign edit during the settle wait releases the step; the run still succeeds', async () => {
    let finishSettle: (settled: boolean) => void = () => {}
    const t2 = setup({
      settle: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
    })
    const running = t2.session.run(claude, () => Ok(1))
    await vi.waitFor(() => expect(t2.updated).toHaveBeenCalled())
    t2.foreign()
    expect(t2.release).toHaveBeenCalledTimes(1)
    finishSettle(true)
    expect((await running).ok).toBe(true)
    expect(t2.pending()).toHaveLength(0)
    const next = t2.session.run(claude, () => Ok(2))
    await vi.waitFor(() => expect(t2.deps.holdUndoStep).toHaveBeenCalledTimes(2))
    finishSettle(true)
    await next
    expect(t2.deps.saveVersion).toHaveBeenCalledTimes(2)
  })

  test('dispose with one run in progress and one queued', async () => {
    let finishSettle: (settled: boolean) => void = () => {}
    const t2 = setup({
      settle: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
    })
    const first = t2.session.run(claude, () => Ok(1))
    const secondEdit = vi.fn(() => Ok(2))
    const second = t2.session.run(claude, secondEdit)
    await vi.waitFor(() => expect(t2.updated).toHaveBeenCalled())
    t2.session.dispose()
    finishSettle(true)
    expect((await first).ok).toBe(true)
    expect(errorOf(await second)).toBe('The project is no longer open.')
    expect(secondEdit).not.toHaveBeenCalled()
    expect(t2.release).toHaveBeenCalledTimes(1)
    expect(t2.pending()).toHaveLength(0)
  })

  test('a throwing setTimeout does not stop a following run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    t.failNextSetTimeout()
    expect((await t.session.run(claude, okEdit(t.log))).ok).toBe(true)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
    expect((await t.session.run(claude, okEdit(t.log))).ok).toBe(true)
    expect(t.pending()).toHaveLength(1)
  })

  test('a different caller releases the open step and starts its own', async () => {
    await t.session.run(claude, okEdit(t.log))
    await t.session.run(codex, okEdit(t.log))
    expect(t.log).toEqual([
      'save:Before changes by claude-code',
      'hold',
      'edit',
      'release',
      'save:Before changes by codex',
      'hold',
      'edit',
    ])
  })

  test('a foreign edit releases the step; one raised inside edit does not', async () => {
    await t.session.run(claude, okEdit(t.log))
    await t.session.run(claude, () => {
      t.foreign()
      return Ok(1)
    })
    expect(t.release).not.toHaveBeenCalled()
    t.foreign()
    expect(t.release).toHaveBeenCalledTimes(1)
    await t.session.run(claude, okEdit(t.log))
    expect(t.deps.holdUndoStep).toHaveBeenCalledTimes(2)
  })

  test('a failed saveVersion refuses the edit and takes no hold', async () => {
    const failing = setup({
      saveVersion: vi.fn(async () => {
        throw new Error('The repository is blocked')
      }),
    })
    const edit = vi.fn(() => Ok(1))
    const result = await failing.session.run(claude, edit)
    expect(errorOf(result)).toBe('The repository is blocked')
    expect(edit).not.toHaveBeenCalled()
    expect(failing.deps.holdUndoStep).not.toHaveBeenCalled()
    // The queue continues.
    expect(errorOf(await failing.session.run(claude, edit))).toBe('The repository is blocked')
  })

  test('runs started together execute strictly one after the other', async () => {
    const order: string[] = []
    const finishers: ((settled: boolean) => void)[] = []
    const t2 = setup({
      settle: () => {
        order.push('settle-start')
        return new Promise<boolean>((resolve) => {
          finishers.push((v) => {
            order.push('settle-end')
            resolve(v)
          })
        })
      },
    })
    const first = t2.session.run(claude, () => {
      order.push('edit1')
      return Ok(1)
    })
    const second = t2.session.run(claude, () => {
      order.push('edit2')
      return Ok(2)
    })
    await vi.waitFor(() => expect(finishers).toHaveLength(1))
    expect(order).toEqual(['edit1', 'settle-start'])
    finishers[0]!(true)
    await first
    await vi.waitFor(() => expect(finishers).toHaveLength(2))
    expect(order).toEqual(['edit1', 'settle-start', 'settle-end', 'edit2', 'settle-start'])
    finishers[1]!(true)
    expect(await second).toEqual(Ok({ value: 2, settled: true }))
  })

  test('the settle wait uses EDIT_SETTLE_MS; false gives settled: false', async () => {
    const t2 = setup({ settle: async () => false })
    const result = await t2.session.run(claude, () => Ok('x'))
    expect(result).toEqual(Ok({ value: 'x', settled: false }))
    expect(t2.settle).toHaveBeenCalledWith({}, EDIT_SETTLE_MS)
  })

  test("the affected ids come from the edit's value, after the edit is applied", async () => {
    const result = await t.session.run(claude, () => Ok(['n1', 'n2']), {
      affected: (ids) => ({ added: ids, changed: ['old'] }),
    })
    expect(result).toEqual(Ok({ value: ['n1', 'n2'], settled: true }))
    expect(t.settle).toHaveBeenCalledWith({ added: ['n1', 'n2'], changed: ['old'] }, EDIT_SETTLE_MS)
    expect(t.watches[0]!.editApplied).toHaveBeenCalledTimes(1)
  })

  test('an Err from edit is returned, leaves the step open, and skips the settle wait', async () => {
    await t.session.run(claude, okEdit(t.log))
    const result = await t.session.run(claude, () => Err('nope'))
    expect(errorOf(result)).toBe('nope')
    expect(t.release).not.toHaveBeenCalled()
    expect(t.settle).toHaveBeenCalledTimes(1)
    await t.session.run(claude, okEdit(t.log))
    expect(t.deps.holdUndoStep).toHaveBeenCalledTimes(1)
  })

  test('an edit that throws gives Err and the queue continues', async () => {
    const result = await t.session.run(claude, () => {
      throw new Error('boom')
    })
    expect(errorOf(result)).toBe('boom')
    expect(await t.session.run(claude, () => Ok('after'))).toEqual(
      Ok({ value: 'after', settled: true }),
    )
  })

  test('an edit that rejects gives Err and the queue continues', async () => {
    const result = await t.session.run(claude, () => Promise.reject(new Error('later')))
    expect(errorOf(result)).toBe('later')
    expect((await t.session.run(claude, () => Ok(1))).ok).toBe(true)
  })

  test('releaseStep releases, cancels the timer, and the next run starts a new step', async () => {
    await t.session.run(claude, okEdit(t.log))
    t.session.releaseStep()
    expect(t.release).toHaveBeenCalledTimes(1)
    expect(t.pending()).toHaveLength(0)
    await t.session.run(claude, okEdit(t.log))
    expect(t.deps.saveVersion).toHaveBeenCalledTimes(2)
    expect(t.deps.holdUndoStep).toHaveBeenCalledTimes(2)
  })

  test('dispose releases, unsubscribes, refuses later runs, and is safe twice', async () => {
    await t.session.run(claude, okEdit(t.log))
    t.session.dispose()
    t.session.dispose()
    expect(t.release).toHaveBeenCalledTimes(1)
    expect(t.unsubscribe).toHaveBeenCalled()
    const edit = vi.fn(() => Ok(1))
    expect(errorOf(await t.session.run(claude, edit))).toBe('The project is no longer open.')
    expect(edit).not.toHaveBeenCalled()
  })

  test('an inactive session refuses without saving, holding or editing', async () => {
    t.setActive(false)
    const edit = vi.fn(() => Ok(1))
    expect(errorOf(await t.session.run(claude, edit))).toBe(NOT_ON_SCREEN_ERROR)
    expect(NOT_ON_SCREEN_ERROR).toBe('The project is no longer on screen.')
    expect(t.deps.saveVersion).not.toHaveBeenCalled()
    expect(t.deps.holdUndoStep).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })

  test('deactivated while the version is saving: refused, no hold, no edit', async () => {
    let finishSave: () => void = () => {}
    const t2 = setup({
      saveVersion: vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve))),
    })
    const edit = vi.fn(() => Ok(1))
    const result = t2.session.run(claude, edit)
    await vi.waitFor(() => expect(t2.deps.saveVersion).toHaveBeenCalled())
    t2.setActive(false)
    finishSave()
    expect(errorOf(await result)).toBe(NOT_ON_SCREEN_ERROR)
    expect(t2.deps.holdUndoStep).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })

  test('a run queued behind one in progress is refused when its turn comes after deactivation', async () => {
    let finishSettle: ((settled: boolean) => void) | undefined
    const t2 = setup({
      settle: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
    })
    const first = t2.session.run(claude, () => Ok(1))
    const secondEdit = vi.fn(() => Ok(2))
    const second = t2.session.run(claude, secondEdit)
    await vi.waitFor(() => expect(finishSettle).toBeDefined())
    t2.setActive(false)
    finishSettle!(true)
    // The run already past its checks finishes normally.
    expect(await first).toEqual(Ok({ value: 1, settled: true }))
    expect(errorOf(await second)).toBe(NOT_ON_SCREEN_ERROR)
    expect(secondEdit).not.toHaveBeenCalled()
  })

  test('switched to Live while the version was saving: refused, no hold, no edit', async () => {
    let finishSave: () => void = () => {}
    const t2 = setup({
      saveVersion: vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve))),
    })
    const edit = vi.fn(() => Ok(1))
    const result = t2.session.run(claude, edit)
    await vi.waitFor(() => expect(t2.deps.saveVersion).toHaveBeenCalled())
    t2.setLive(true)
    finishSave()
    expect(errorOf(await result)).toBe(LIVE_EDIT_ERROR)
    expect(t2.deps.holdUndoStep).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })

  test('after reactivation runs work again', async () => {
    t.setActive(false)
    expect((await t.session.run(claude, () => Ok(1))).ok).toBe(false)
    t.setActive(true)
    expect(await t.session.run(claude, () => Ok(2))).toEqual(Ok({ value: 2, settled: true }))
  })
})

describe('the deadline', () => {
  const TEXT = 'The call timed out before it ran. Nothing was changed; try again.'

  test('the constants and the refusal text', () => {
    expect(EDIT_MIN_REMAINING_MS).toBe(25_000)
    expect(EDIT_ANSWER_MARGIN_MS).toBe(3_000)
    expect(TIMED_OUT_BEFORE_RUN_ERROR).toBe(TEXT)
  })

  test('a run whose turn comes with less than 25 s left is refused, and edit is not called', async () => {
    let clock = 0
    const t = setup({ now: () => clock })
    let finishSettle: (settled: boolean) => void = () => {}
    vi.mocked(t.deps.watchExecution).mockImplementationOnce(() => ({
      editApplied: () => {},
      settled: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
      cancel: () => {},
    }))
    const first = t.session.run(claude, () => Ok(1), { deadline: 60_000 })
    const secondEdit = vi.fn(() => Ok(2))
    // Queued at 0 with a 60 s budget; its turn comes 36 s later.
    const second = t.session.run(claude, secondEdit, { deadline: 60_000 })
    await vi.waitFor(() => expect(t.updated).toHaveBeenCalled())
    clock = 36_000
    finishSettle(true)
    expect((await first).ok).toBe(true)
    expect(errorOf(await second)).toBe(TEXT)
    expect(secondEdit).not.toHaveBeenCalled()
  })

  test('exactly 25 s left at the turn is enough', async () => {
    const t = setup({ now: () => 35_000 })
    expect(await t.session.run(claude, () => Ok(1), { deadline: 60_000 })).toEqual(
      Ok({ value: 1, settled: true }),
    )
  })

  test('a version save that outlasts the budget refuses the run; a late save changes nothing', async () => {
    let clock = 0
    let finishSave: () => void = () => {}
    const t = setup({
      now: () => clock,
      saveVersion: vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve))),
    })
    const edit = vi.fn(() => Ok(1))
    const result = t.session.run(claude, edit, { deadline: 60_000 })
    await vi.waitFor(() => expect(t.deps.saveVersion).toHaveBeenCalled())
    // The save may take until 25 s are left: 35 s.
    const race = t.pending().find((timer) => timer.ms === 35_000)
    expect(race).toBeDefined()
    clock = 35_000
    race!.cleared = true
    race!.f()
    expect(errorOf(await result)).toBe(TEXT)
    finishSave()
    await Promise.resolve()
    expect(edit).not.toHaveBeenCalled()
    expect(t.deps.holdUndoStep).not.toHaveBeenCalled()
  })

  test('a save that returns in time clears its race timer', async () => {
    const t = setup({ now: () => 0 })
    await t.session.run(claude, () => Ok(1), { deadline: 60_000 })
    // Only the step's idle timer is left.
    expect(t.pending().map((timer) => timer.ms)).toEqual([EDIT_STEP_IDLE_MS])
  })

  test('a save that returns with less than 25 s left refuses the run', async () => {
    let clock = 0
    const t = setup({
      now: () => clock,
      saveVersion: vi.fn(async () => {
        clock = 40_000
      }),
    })
    const edit = vi.fn(() => Ok(1))
    expect(errorOf(await t.session.run(claude, edit, { deadline: 60_000 }))).toBe(TEXT)
    expect(edit).not.toHaveBeenCalled()
  })

  test('the settle wait is capped at the time left minus 3 s', async () => {
    let clock = 0
    const t = setup({
      now: () => clock,
      graphUpdated: async () => {
        clock = 30_000
        return true
      },
    })
    await t.session.run(claude, () => Ok(['n']), {
      deadline: 50_000,
      affected: (ids) => ({ added: ids }),
    })
    expect(t.settle).toHaveBeenCalledWith({ added: ['n'] }, 50_000 - 30_000 - EDIT_ANSWER_MARGIN_MS)
  })

  test('with time to spare the settle wait is EDIT_SETTLE_MS', async () => {
    const t = setup({ now: () => 0 })
    await t.session.run(claude, () => Ok(1), { deadline: 120_000 })
    expect(t.settle).toHaveBeenCalledWith({}, EDIT_SETTLE_MS)
  })
})

class FakeContext extends ObservableV2<{
  executionComplete(): void
  executionFailed(message: string): void
  expressionUpdates(updates: readonly ExpressionUpdateLike[]): void
}> {
  /** The listeners on the events the session watches; `executionComplete` is not one of them. */
  count() {
    return (
      (this._observers.get('executionComplete')?.size ?? 0) +
      (this._observers.get('executionFailed')?.size ?? 0) +
      (this._observers.get('expressionUpdates')?.size ?? 0)
    )
  }
  /** The engine reports these expressions, each with a payload of this type. */
  report(type: string, ...ids: string[]) {
    this.emit('expressionUpdates', [
      ids.map((expressionId) => ({ expressionId, payload: { type } })),
    ])
  }
}

describe('watching the execution', () => {
  test('the watch starts before the edit is applied, and is settled after the graph update', async () => {
    const order: string[] = []
    const t = setup({
      graphUpdated: async () => {
        order.push('graph')
        return true
      },
      settle: async () => {
        order.push('settled')
        return true
      },
    })
    vi.mocked(t.deps.watchExecution).mockImplementationOnce(() => {
      order.push('watch')
      return {
        editApplied: () => order.push('applied'),
        settled: t.settle,
        cancel: () => order.push('cancel'),
      }
    })
    await t.session.run(claude, () => {
      order.push('edit')
      return Ok(1)
    })
    expect(order[0]).toBe('watch')
    expect(order.slice(1, 5)).toEqual(['edit', 'applied', 'graph', 'settled'])
  })

  describe('against the real watch', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function realSetup(overrides: Partial<EditSessionDeps> = {}) {
      const context = new FakeContext()
      const t = setup({ watchExecution: () => watchExecution(context), ...overrides })
      return { ...t, context }
    }

    /** A run of an edit whose value is the ids it adds. */
    function runAffecting(t: ReturnType<typeof realSetup>, ids: string[], during?: () => void) {
      const done = vi.fn()
      void t.session
        .run(
          claude,
          () => {
            during?.()
            return Ok(ids)
          },
          { affected: (value) => ({ added: value }) },
        )
        .then(done)
      return done
    }

    test('an executionComplete alone (from an earlier evaluation) does not settle a run with affected ids', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['n'])
      await vi.advanceTimersByTimeAsync(0)
      t.context.emit('executionComplete', [])
      await vi.advanceTimersByTimeAsync(EDIT_SETTLE_MS - 1)
      expect(done).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['n'], settled: false }))
      expect(t.context.count()).toBe(0)
    })

    test('values for all affected ids settle the run without an executionComplete', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['a', 'b'])
      await vi.advanceTimersByTimeAsync(0)
      t.context.report('Value', 'a')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).not.toHaveBeenCalled()
      t.context.report('Value', 'b')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['a', 'b'], settled: true }))
      expect(t.context.count()).toBe(0)
    })

    test('a Pending payload for an affected id does not count; a later value does', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['a'])
      await vi.advanceTimersByTimeAsync(0)
      t.context.report('Pending', 'a')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).not.toHaveBeenCalled()
      t.context.report('Value', 'a')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['a'], settled: true }))
    })

    test('a Pending batch and an executionComplete do not settle; the value does', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['a'])
      await vi.advanceTimersByTimeAsync(0)
      t.context.report('Pending', 'a', 'b')
      t.context.report('Value', 'someone-else')
      t.context.emit('executionComplete', [])
      await vi.advanceTimersByTimeAsync(0)
      expect(done).not.toHaveBeenCalled()
      t.context.report('Value', 'a')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['a'], settled: true }))
    })

    test('an executionFailed after the edit settles', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['a'])
      await vi.advanceTimersByTimeAsync(0)
      t.context.emit('executionFailed', ['boom'])
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['a'], settled: true }))
      expect(t.context.count()).toBe(0)
    })

    test('no affected ids: settled at once, with no timer armed', async () => {
      const t = realSetup()
      const done = runAffecting(t, [])
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: [], settled: true }))
      expect(vi.getTimerCount()).toBe(0)
      expect(t.context.count()).toBe(0)
    })

    test('updates that arrive during the edit, before it is applied, do not count', async () => {
      const t = realSetup()
      const done = runAffecting(t, ['new'], () => t.context.report('Value', 'new'))
      await vi.advanceTimersByTimeAsync(0)
      expect(done).not.toHaveBeenCalled()
      t.context.report('Value', 'new')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['new'], settled: true }))
      expect(t.context.count()).toBe(0)
    })

    test('an edited node settles on a Pending and then a value after the edit, not on a stale value', async () => {
      const t = realSetup()
      const done = vi.fn()
      void t.session
        .run(claude, () => Ok('y'), { affected: (id) => ({ changed: [id] }) })
        .then(done)
      await vi.advanceTimersByTimeAsync(0)
      // The run started for the previous edit reports `y`.
      t.context.report('Value', 'y')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).not.toHaveBeenCalled()
      t.context.report('Pending', 'y')
      t.context.report('Value', 'y')
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: 'y', settled: true }))
    })

    test('the values may come before the graph update is awaited', async () => {
      const context = new FakeContext()
      const t = setup({
        watchExecution: () => watchExecution(context),
        graphUpdated: async () => {
          context.report('Value', 'n')
          return true
        },
      })
      const done = vi.fn()
      void t.session
        .run(claude, () => Ok(['n']), { affected: (ids) => ({ added: ids }) })
        .then(done)
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toHaveBeenCalledWith(Ok({ value: ['n'], settled: true }))
      expect(context.count()).toBe(0)
    })

    test('an edit that returns Err or throws leaves no listener', async () => {
      const t = realSetup()
      expect((await t.session.run(claude, () => Err('nope'))).ok).toBe(false)
      expect(t.context.count()).toBe(0)
      const thrown = await t.session.run(claude, () => {
        throw new Error('boom')
      })
      expect(errorOf(thrown)).toBe('boom')
      expect(t.context.count()).toBe(0)
    })

    test('an async edit that rejects leaves no listener', async () => {
      const t = realSetup()
      const result = await t.session.run(claude, async () => {
        throw new Error('later')
      })
      expect(errorOf(result)).toBe('later')
      expect(t.context.count()).toBe(0)
    })

    test('a refused run leaves no listener: Live, not on screen, a failed version save', async () => {
      const t = realSetup({
        saveVersion: vi.fn(async () => {
          throw new Error('The repository is blocked')
        }),
      })
      expect(errorOf(await t.session.run(claude, () => Ok(1)))).toBe('The repository is blocked')
      expect(t.context.count()).toBe(0)
      t.setLive(true)
      expect(errorOf(await t.session.run(claude, () => Ok(1)))).toBe(LIVE_EDIT_ERROR)
      expect(t.context.count()).toBe(0)
      t.setLive(false)
      t.setActive(false)
      expect(errorOf(await t.session.run(claude, () => Ok(1)))).toBe(NOT_ON_SCREEN_ERROR)
      expect(t.context.count()).toBe(0)
    })
  })

  test('a fake watch is cancelled when the edit returns Err or throws, and none is left open', async () => {
    const t = setup()
    await t.session.run(claude, () => Err('nope'))
    expect(t.watches).toHaveLength(1)
    expect(t.watches[0]!.cancel).toHaveBeenCalled()
    await t.session.run(claude, () => {
      throw new Error('boom')
    })
    expect(t.watches[1]!.cancel).toHaveBeenCalled()
    expect(t.openWatches()).toHaveLength(0)
    expect(t.settle).not.toHaveBeenCalled()
  })
})

/** A graph like `graph.ts`'s: `doAfterUpdate` queues a callback that the next update runs. */
function fakeGraph() {
  const callbacks: (() => void)[] = []
  return {
    doAfterUpdate: (f: () => void) => {
      callbacks.push(f)
    },
    /** The node database update, as Vue's effect runs it after a module change. */
    update: () => {
      for (const callback of callbacks.splice(0)) callback()
    },
    queued: () => callbacks.length,
  }
}

describe('waiting for the graph update', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('the graph watch starts before the edit, and is awaited after it', async () => {
    const order: string[] = []
    const t = setup({
      graphUpdated: async () => {
        order.push('updated')
        return true
      },
    })
    vi.mocked(t.deps.watchGraphUpdate).mockImplementationOnce(() => {
      order.push('watch')
      return { updated: t.updated, cancel: () => order.push('cancel') }
    })
    await t.session.run(claude, () => {
      order.push('edit')
      return Ok(1)
    })
    expect(order.slice(0, 3)).toEqual(['watch', 'edit', 'updated'])
    expect(t.updated).toHaveBeenCalledWith(GRAPH_UPDATE_WAIT_MS)
  })

  test('an update that runs during the edit, before the wait is awaited, ends the wait at once', async () => {
    const graph = fakeGraph()
    const t = setup({ watchGraphUpdate: () => watchGraphUpdate(graph) })
    const done = vi.fn()
    void t.session
      .run(claude, () => {
        // The module change: Vue runs the update effect before the session continues.
        queueMicrotask(graph.update)
        return Ok(1)
      })
      .then(done)
    // No timer is advanced.
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toHaveBeenCalledWith(Ok({ value: 1, settled: true }))
  })

  test('an update after the edit ends the wait; without one, it ends at GRAPH_UPDATE_WAIT_MS', async () => {
    const graph = fakeGraph()
    const t = setup({ watchGraphUpdate: () => watchGraphUpdate(graph) })
    const first = vi.fn()
    void t.session.run(claude, () => Ok(1)).then(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(first).not.toHaveBeenCalled()
    graph.update()
    await vi.advanceTimersByTimeAsync(0)
    expect(first).toHaveBeenCalled()

    const second = vi.fn()
    void t.session.run(claude, () => Ok(2)).then(second)
    await vi.advanceTimersByTimeAsync(GRAPH_UPDATE_WAIT_MS - 1)
    expect(second).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(second).toHaveBeenCalledWith(Ok({ value: 2, settled: true }))
  })

  test('Err, a throw or a refusal cancels the graph wait: no timer and no live callback is left', async () => {
    const graph = fakeGraph()
    const t = setup({ watchGraphUpdate: () => watchGraphUpdate(graph) })
    await t.session.run(claude, () => Err('nope'))
    await t.session.run(claude, () => {
      throw new Error('boom')
    })
    t.setLive(true)
    await t.session.run(claude, () => Ok(1))
    expect(vi.getTimerCount()).toBe(0)
    expect(t.updated).not.toHaveBeenCalled()
    // A cancelled watch's callback stays queued until the next update, which it ignores.
    graph.update()
    expect(graph.queued()).toBe(0)
  })

  test('a fake graph watch is cancelled on Err and on a throw, and none is left open', async () => {
    const t = setup()
    await t.session.run(claude, () => Err('nope'))
    await t.session.run(claude, () => {
      throw new Error('boom')
    })
    expect(t.graphWatches).toHaveLength(2)
    for (const watch of t.graphWatches) expect(watch.cancel).toHaveBeenCalled()
    expect(t.openWatches()).toHaveLength(0)
  })
})
