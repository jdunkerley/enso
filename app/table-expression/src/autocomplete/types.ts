export interface AnyCompletion {
  type: string
  pos?: number
  /**
   * True if the completion dialog should be opened automatically; otherwise, it may be triggered
   * with a hotkey.
   */
  auto?: boolean
}

export interface NameCompletion extends AnyCompletion {
  type: 'functionName' | 'columnName'
  pos: number
  auto: boolean
  /**
   * True if a delimiter should be inserted after the completion; false if it is unnecessary, e.g.,
   * when editing a name already followed by a delimiter.
   */
  insertDelim: boolean
}

export interface FunctionInfoCompletion extends AnyCompletion {
  type: 'functionInfo'
  pos: number
  functionName: string
  /** The argument the cursor is in, counting from 0. */
  argIndex: number
  /**
   * Where a value for that argument starts, when the cursor is where one could be offered: in an
   * empty argument, or at the end of a `..Name` being typed. Undefined anywhere else in the
   * argument.
   */
  argValueFrom: number | undefined
}

export interface ValueCompletion extends AnyCompletion {
  type: 'value'
}

export interface BinOpCompletion extends AnyCompletion {
  type: 'binop'
  pos: number
  auto: boolean
  insertDelim: boolean
}

export type CompletionType =
  NameCompletion | FunctionInfoCompletion | ValueCompletion | BinOpCompletion
