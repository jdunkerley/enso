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

  test('stdin is closed when input is undefined', async () => {
    const { stdout } = await runCommand(process.execPath, [
      '-e',
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(s.length)))",
    ])
    expect(stdout).toBe('0')
  })

  test('stdin is closed when input is empty string', async () => {
    const { stdout } = await runCommand(
      process.execPath,
      [
        '-e',
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(s.length)))",
      ],
      { input: '' },
    )
    expect(stdout).toBe('0')
  })

  test('large input to a child that exits immediately does not crash', async () => {
    const largeInput = 'x'.repeat(10_000_000)
    const result = await runCommand(process.execPath, ['-e', 'process.exit(0)'], {
      input: largeInput,
    })
    expect(result.stdout).toBe('')
  })

  test('multibyte characters split across chunks are decoded correctly', async () => {
    const { stdout } = await runCommand(process.execPath, [
      '-e',
      "process.stdout.write('é'.repeat(10000))",
    ])
    expect(stdout).toBe('é'.repeat(10000))
  })
})
