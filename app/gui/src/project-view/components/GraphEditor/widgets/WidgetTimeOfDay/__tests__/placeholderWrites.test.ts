/**
 * @file What a number typed into an unset argument of `Time_Of_Day.new` writes, as `WidgetFunction`
 * inserts it (`handleArgUpdate`: a placeholder's value is applied by name only when the placeholder
 * says `insertAsNamed`), reads back as the time the menu opens on.
 */
import {
  makeArgument,
  makeStaticMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentPlaceholder, interpretCall } from '@/util/callTree'
import { isIdentifier } from '@/util/qualifiedName'
import { expect, test } from 'vitest'
import { parseTimeExpression, type TimeChoice } from '../timeExpression'

const timeNew = makeStaticMethod('Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day.new', {
  args: ['hour', 'minute', 'second', 'millisecond', 'microsecond', 'nanosecond'].map((name) =>
    makeArgument(name, 'Standard.Base.Data.Numbers.Integer'),
  ),
})

/** The code after typing `value` into the unset argument `name` of `code`, as `WidgetFunction` writes it. */
function typeInto(code: string, name: string, value: string): string {
  const ast = Ast.parseExpression(code)!
  const call = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: timeNew,
    subjectAsSelf: true,
  })
  if (!(call instanceof ArgumentApplication)) throw new Error(`${code} is not an application`)
  const argApp = [...call.iterApplications()].find(
    (app) => app.argument instanceof ArgumentPlaceholder && app.argument.argInfo.name === name,
  )
  if (argApp == null || !(argApp.argument instanceof ArgumentPlaceholder))
    throw new Error(`${name} is not unset in ${code}`)
  const argName =
    argApp.argument.insertAsNamed && isIdentifier(argApp.argument.argInfo.name) ?
      argApp.argument.argInfo.name
    : undefined
  const edit = Ast.MutableModule.Transient()
  const appTree = edit.copy(argApp.appTree)
  return Ast.App.new(edit, appTree, argName, Ast.parseExpression(value, edit)!).code()
}

test.each([
  ['Time_Of_Day.new', 'hour', '14', 'Time_Of_Day.new 14', { hour: 14, minute: 0 }],
  ['Time_Of_Day.new', 'minute', '30', 'Time_Of_Day.new minute=30', { hour: 0, minute: 30 }],
  ['Time_Of_Day.new 14', 'minute', '30', 'Time_Of_Day.new 14 30', { hour: 14, minute: 30 }],
  [
    'Time_Of_Day.new 14',
    'second',
    '15',
    'Time_Of_Day.new 14 second=15',
    { hour: 14, minute: 0, second: 15 },
  ],
])(
  'typing into the unset argument of %j (%s = %s) writes %j, which opens the menu on it',
  (code, name, value, written, time) => {
    expect(typeInto(code, name, value)).toBe(written)
    expect(parseTimeExpression(written)).toEqual({
      kind: 'time',
      second: 0,
      ...time,
    } satisfies TimeChoice)
  },
)
