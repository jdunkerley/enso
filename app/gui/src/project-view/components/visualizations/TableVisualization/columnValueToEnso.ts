/** @file How the table toolbar writes a cell's text as an Enso value of its column's type. */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { getCellValueType, isNumericType } from './tableVizUtils'

const createDateTimeValue = (patternString: string, item: string, module: Ast.MutableModule) => {
  const pattern = Pattern.parseExpression(patternString)!
  return pattern.instantiateCopied([Ast.TextLiteral.new(item, module)])
}

const createDateValue = (item: string, module: Ast.MutableModule) => {
  const dateOrTimePattern = Pattern.parseExpression('(Date.new __ __ __)')
  const dateTimeParts = item
    .match(/\d+/g)!
    .filter((part, i) => i < 3)
    .map((part) => Ast.tryNumberToEnso(Number(part), module)!)
  return dateOrTimePattern.instantiateCopied([...dateTimeParts])
}

const getFormattedValueForCell = (item: string, module: Ast.MutableModule, cellType: string) => {
  if (isNumericType(cellType)) {
    return Ast.tryNumberToEnso(Number(item), module)!
  }
  if (cellType === 'Date') {
    return createDateValue(item, module)
  }
  if (cellType === 'Time') {
    return createDateTimeValue('Time_Of_Day.parse (__)', item, module)
  }
  if (cellType === 'Date_Time') {
    return createDateTimeValue('Date_Time.parse (__)', item, module)
  }
  return Ast.TextLiteral.new(item)
}

/**
 * For a column, the function writing one of its cells' text as an Enso value of the column's
 * type (`columnTypes` maps each column to its value type's constructor).
 */
export function columnValueToEnso(columnTypes: ReadonlyMap<string, string>) {
  return (columnName: string) => {
    const columnType = columnTypes.get(columnName) ?? ''
    if (isNumericType(columnType)) {
      return (item: string, module: Ast.MutableModule) => Ast.tryNumberToEnso(Number(item), module)!
    }
    if (columnType === 'Date') {
      return (item: string, module: Ast.MutableModule) => createDateValue(item, module)
    }
    if (columnType === 'Time') {
      return (item: string, module: Ast.MutableModule) =>
        createDateTimeValue('Time_Of_Day.parse (__)', item, module)
    }
    if (columnType === 'Date_Time') {
      return (item: string, module: Ast.MutableModule) =>
        createDateTimeValue('Date_Time.parse (__)', item, module)
    }
    if (columnType === 'Mixed') {
      return (item: string, module: Ast.MutableModule) => {
        const parsedCellType = getCellValueType(item)
        return getFormattedValueForCell(item, module, parsedCellType)
      }
    }
    if (columnType === 'Boolean') {
      return (item: string, module: Ast.MutableModule) => {
        return item === 'false' ?
            Ast.Ident.new(module, Ast.identifier('False')!)
          : Ast.Ident.new(module, Ast.identifier('True')!)
      }
    }
    return (item: string) => Ast.TextLiteral.new(item)
  }
}
