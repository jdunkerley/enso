import { describe, expect, test } from 'vitest'
import { CommandError, runCommand } from '../runCommand.js'

describe('runCommand', () => {
  test('collects stdout', async () => {
    const { stdout } = await runCommand(process.execPath, ['-e', 'process.stdout.write("hi")'])
    expect(stdout).toBe('hi')
  })

  test('a non-zero exit throws a CommandError with the output', async () => {
    const error = await runCommand(process.execPath, [
      '-e',
      'console.error("bad"); process.exit(3)',
    ]).catch((e) => e)
    expect(error).toBeInstanceOf(CommandError)
    expect(error.code).toBe(3)
    expect(error.stderr).toContain('bad')
  })

  test('input is written to stdin', async () => {
    const { stdout } = await runCommand(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      { input: 'x' },
    )
    expect(stdout).toBe('x')
  })

  test('a missing command rejects', async () => {
    await expect(runCommand('definitely-not-a-command-xyz', [])).rejects.toThrow()
  })
})
