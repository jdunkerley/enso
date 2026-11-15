import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  EDIT_SETTLE_MS,
  EDIT_STEP_IDLE_MS,
  EditSession,
  LIVE_EDIT_ERROR,
  type EditSessionDeps,
} from '../editSession'

const claude = { kind: 'external', name: 'claude-code' } as const
const codex = { kind: 'external', name: 'codex' } as const

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

function setup(overrides: Partial<EditSessionDeps> = {}) {
  const log: string[] = []
  let live = false
  let foreign: (() => void) | undefined
  let failNextSetTimeout = false
  const timers: { f: () => void; ms: number; handle: number; cleared: boolean }[] = []
  const unsubscribe = vi.fn()
  const release = vi.fn(() => {
    log.push('release')
  })
  const deps: EditSessionDeps = {
    isLive: () => live,
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
    executionSettled: vi.fn(async () => true),
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
    release,
    unsubscribe,
    pending,
    setLive: (v: boolean) => {
      live = v
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
      executionSettled: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
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
      executionSettled: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
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
      executionSettled: () => new Promise<boolean>((resolve) => (finishSettle = resolve)),
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
      executionSettled: () => {
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
    const t2 = setup({ executionSettled: vi.fn(async () => false) })
    const result = await t2.session.run(claude, () => Ok('x'))
    expect(result).toEqual(Ok({ value: 'x', settled: false }))
    expect(t2.deps.executionSettled).toHaveBeenCalledWith(EDIT_SETTLE_MS)
  })

  test('an Err from edit is returned, leaves the step open, and skips the settle wait', async () => {
    await t.session.run(claude, okEdit(t.log))
    const result = await t.session.run(claude, () => Err('nope'))
    expect(errorOf(result)).toBe('nope')
    expect(t.release).not.toHaveBeenCalled()
    expect(t.deps.executionSettled).toHaveBeenCalledTimes(1)
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
})
