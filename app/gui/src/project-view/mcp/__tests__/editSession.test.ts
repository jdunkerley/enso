import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { ObservableV2 } from 'lib0/observable'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  EDIT_SETTLE_MS,
  EDIT_SHORT_SETTLE_MS,
  EDIT_STEP_IDLE_MS,
  EditSession,
  LIVE_EDIT_ERROR,
  NOT_ON_SCREEN_ERROR,
  type EditSessionDeps,
} from '../editSession'
import { watchExecution, type ExecutionWatch } from '../projectEvents'

const claude = { kind: 'external', name: 'claude-code' } as const
const codex = { kind: 'external', name: 'codex' } as const

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

interface FakeWatch extends ExecutionWatch {
  readonly cancel: ReturnType<typeof vi.fn>
  done: boolean
}

/**
 * The session over fakes. `settle` answers each watch's `settled` (true by default); `watches` are
 * the watches the session started, `openWatches()` those neither settled nor cancelled.
 */
function setup({
  settle: settleImpl = async () => true,
  ...overrides
}: Partial<EditSessionDeps> & { settle?: (timeoutMs: number) => Promise<boolean> } = {}) {
  const log: string[] = []
  const settle = vi.fn(settleImpl)
  const watches: FakeWatch[] = []
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
    afterGraphUpdate: vi.fn(async () => {}),
    watchExecution: vi.fn(() => {
      const watch: FakeWatch = {
        done: false,
        settled: (timeoutMs) =>
          settle(timeoutMs).finally(() => {
            watch.done = true
          }),
        cancel: vi.fn(() => {
          watch.done = true
        }),
      }
      watches.push(watch)
      return watch
    }),
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
    openWatches: () => watches.filter((watch) => !watch.done),
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
    await vi.waitFor(() => expect(t2.deps.afterGraphUpdate).toHaveBeenCalled())
    expect(t2.pending()).toHaveLength(0)
    expect(t2.release).not.toHaveBeenCalled()
    finishSettle(true)
    await running
    expect(t2.pending()).toHaveLength(1)
    expect(t2.pending()[0]!.ms).toBe(EDIT_STEP_IDLE_MS)
    // A second run by the same caller before the timer fires joins the step.
    const second = t2.session.run(claude, () => Ok(2))
    await vi.waitFor(() => expect(t2.pending()).toHaveLength(0))
    await vi.waitFor(() => expect(t2.deps.afterGraphUpdate).toHaveBeenCalledTimes(2))
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
    await vi.waitFor(() => expect(t2.deps.afterGraphUpdate).toHaveBeenCalled())
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
    await vi.waitFor(() => expect(t2.deps.afterGraphUpdate).toHaveBeenCalled())
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
    expect(t2.settle).toHaveBeenCalledWith(EDIT_SETTLE_MS)
  })

  test('a run may wait a shorter time for the execution to settle', async () => {
    const result = await t.session.run(claude, () => Ok('x'), { settleMs: EDIT_SHORT_SETTLE_MS })
    expect(result).toEqual(Ok({ value: 'x', settled: true }))
    expect(t.settle).toHaveBeenCalledWith(EDIT_SHORT_SETTLE_MS)
    expect(EDIT_SHORT_SETTLE_MS).toBeLessThan(EDIT_SETTLE_MS)
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

  test('after reactivation runs work again', async () => {
    t.setActive(false)
    expect((await t.session.run(claude, () => Ok(1))).ok).toBe(false)
    t.setActive(true)
    expect(await t.session.run(claude, () => Ok(2))).toEqual(Ok({ value: 2, settled: true }))
  })
})

class FakeContext extends ObservableV2<{
  executionComplete(): void
  executionFailed(message: string): void
}> {
  /** The listeners on the two events the session watches. */
  count() {
    return (
      (this._observers.get('executionComplete')?.size ?? 0) +
      (this._observers.get('executionFailed')?.size ?? 0)
    )
  }
}

describe('watching the execution', () => {
  test('the watch starts before the edit is applied, and is settled after the graph update', async () => {
    const order: string[] = []
    const t = setup({
      afterGraphUpdate: vi.fn(async () => {
        order.push('graph')
      }),
      settle: async () => {
        order.push('settled')
        return true
      },
    })
    vi.mocked(t.deps.watchExecution).mockImplementationOnce(() => {
      order.push('watch')
      return { settled: t.settle, cancel: () => order.push('cancel') }
    })
    await t.session.run(claude, () => {
      order.push('edit')
      return Ok(1)
    })
    expect(order[0]).toBe('watch')
    expect(order.slice(1, 4)).toEqual(['edit', 'graph', 'settled'])
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

    test('an execution that completes before the graph update settles the edit without waiting', async () => {
      const context = new FakeContext()
      const t = setup({
        watchExecution: () => watchExecution(context),
        afterGraphUpdate: async () => {
          // The engine finished the edit's execution before the node database was updated.
          context.emit('executionComplete', [])
        },
      })
      const settled = vi.fn()
      void t.session.run(claude, () => Ok(1)).then(settled)
      // No timer is advanced: the result does not wait for the settle timeout.
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toHaveBeenCalledWith(Ok({ value: 1, settled: true }))
      expect(context.count()).toBe(0)
    })

    test('an execution after the graph update settles it; the listeners are removed', async () => {
      const t = realSetup()
      const result = t.session.run(claude, () => Ok(1))
      await vi.advanceTimersByTimeAsync(0)
      expect(t.context.count()).toBe(2)
      t.context.emit('executionComplete', [])
      expect(await result).toEqual(Ok({ value: 1, settled: true }))
      expect(t.context.count()).toBe(0)
    })

    test('no execution: settled false at EDIT_SETTLE_MS; the listeners are removed', async () => {
      const t = realSetup()
      const result = t.session.run(claude, () => Ok(1))
      await vi.advanceTimersByTimeAsync(EDIT_SETTLE_MS)
      expect(await result).toEqual(Ok({ value: 1, settled: false }))
      expect(t.context.count()).toBe(0)
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
