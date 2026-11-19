/**
 * @file The Enso source of every task's starting project and reference solution (`Main.enso`
 * without its metadata; `generateFixtures.ts` adds the trailers and writes the files).
 */
import { MONTHLY_REVENUE } from './data'

const IMPORTS = `from Standard.Base import all
from Standard.Table import all
import Standard.Visualization
`

const READ = `(..Delimited headers=..Has_Headers)`

/** A project with no nodes: only the output of `main`. */
const EMPTY_MAIN = `${IMPORTS}
main =
    Nothing
`

export const CSV_PIPELINE_SOLUTION = `${IMPORTS}
main =
    sales = Data.read (enso_project.data / 'sales.csv') ${READ}
    north = sales.filter 'region' (..Equal 'North')
    in_2025 = north.filter 'date' (..Between (Date.new 2025 1 1) (Date.new 2025 12 31))
    revenue = in_2025.set (in_2025.at 'units' * in_2025.at 'price') 'revenue'
    by_product = revenue.aggregate ['product'] [..Sum 'revenue' 'total']
    result = by_product.sort [..Name 'total' ..Descending]
    result
`

/** The pipeline of `fix-error` with its fourth node (\`revenue\`) naming a column that is not there. */
const fixErrorMain = (units: string) => `${IMPORTS}
main =
    sales_file = enso_project.data / 'sales.csv'
    sales = Data.read sales_file ${READ}
    north = sales.filter 'region' (..Equal 'North')
    revenue = north.set (north.at '${units}' * north.at 'price') 'revenue'
    by_product = revenue.aggregate ['product'] [..Sum 'revenue' 'total']
    result = by_product.sort [..Name 'total' ..Descending]
    result
`
export const FIX_ERROR_PROJECT = fixErrorMain('unit')
export const FIX_ERROR_SOLUTION = fixErrorMain('units')

/** Names of the stored layout's nodes, in the order of the data flow. */
export const LAYOUT_NODES = Array.from({ length: 12 }, (_, i) => `n${i + 1}`)
export const LAYOUT_MAIN = `${IMPORTS}
main =
    n1 = 10
    n2 = n1 + 1
    n3 = n1 * 2
    n4 = n2 + n3
    n5 = n4 + 1
    n6 = n3 - 1
    n7 = n5 + n6
    n8 = n7 * 2
    n9 = n6 + 3
    n10 = n8 + n9
    n11 = n10 - n7
    n12 = n11 + n1
    n12
`

/**
 * The table is built by a function, so that the `monthly` node is short and its default
 * visualization width (the node's own, else 200) is far below the task's 400.
 */
export const VISUALIZE_MAIN = `${IMPORTS}
revenue_table =
    months = [${MONTHLY_REVENUE.map(([m]) => m).join(', ')}]
    revenue = [${MONTHLY_REVENUE.map(([, r]) => r).join(', ')}]
    Table.new [['month', months], ['revenue', revenue]]

main =
    monthly = Main.revenue_table
    monthly
`

export const DOCUMENT_PROJECT = `${IMPORTS}
clean_names text =
    text.trim.to_case ..Title

main =
    raw = ['  alice SMITH', 'bOB  jones ', 'carol   white']
    first_name = Main.clean_names (raw.at 0)
    cleaned = raw.map Main.clean_names
    summary = [first_name, cleaned.length]
    summary
`

export const JOIN_SOLUTION = `${IMPORTS}
main =
    customers = Data.read (enso_project.data / 'customers.csv') ${READ}
    orders = Data.read (enso_project.data / 'orders.csv') ${READ}
    joiners = customers.filter 'joined' (..Between (Date.new 2024 1 1) (Date.new 2024 12 31))
    with_orders = joiners.join orders ..Left_Outer [..Equals 'id' 'customer_id']
    totals = with_orders.aggregate ['region'] [..Sum 'amount' 'total']
    result = totals.sort ['region']
    result
`

const REFACTOR_RAW = `    raw = Table.new [['name', ['  Ann ', 'bob', ' Cy', 'bob', 'Dee']], ['score', [10, 20, Nothing, 20, 40]]]`
const REFACTOR_TAIL = `    total = (cleaned.at 'score').to_vector.fold 0 (+)
    count = cleaned.row_count
    result = Table.new [['total', [total]], ['count', [count]]]
    result
`
export const REFACTOR_PROJECT = `${IMPORTS}
main =
${REFACTOR_RAW}
    trimmed = raw.set ((raw.at 'name').map (n-> n.trim)) 'name'
    unique = trimmed.distinct ['name']
    scored = unique.filter 'score' (..Not_Nothing)
    cleaned = scored.sort ['name']
${REFACTOR_TAIL}`
export const REFACTOR_SOLUTION = `${IMPORTS}
clean raw =
    trimmed = raw.set ((raw.at 'name').map (n-> n.trim)) 'name'
    unique = trimmed.distinct ['name']
    scored = unique.filter 'score' (..Not_Nothing)
    cleaned = scored.sort ['name']
    cleaned

main =
${REFACTOR_RAW}
    ## Trims the names, drops repeated names and rows without a score, and sorts by name.
    cleaned = Main.clean raw
${REFACTOR_TAIL}`

export { EMPTY_MAIN }

export const DOCUMENT_SOLUTION = `${IMPORTS}
## Trims \`text\` and puts each word in title case.

   ## Arguments
   - \`text\`: The name to tidy up, such as \`  alice SMITH\`.

   ## Examples
   ### A messy name
   \`\`\`
   name = '  alice SMITH'
   tidy = Main.clean_names name
   \`\`\`
clean_names text =
    text.trim.to_case ..Title

## Tidies three names and counts them.

   Each name goes through \`clean_names\`.
main =
    raw = ['  alice SMITH', 'bOB  jones ', 'carol   white']
    first_name = Main.clean_names (raw.at 0)
    cleaned = raw.map Main.clean_names
    summary = [first_name, cleaned.length]
    summary
`
