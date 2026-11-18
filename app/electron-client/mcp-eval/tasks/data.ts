/**
 * @file The tasks' synthetic data, generated from a fixed seed, and the values the tasks expect,
 * computed straight from it (no engine). The committed CSV files are exactly this output
 * (`tests/headless/mcpEvalTasks.test.ts` compares them), and `generateFixtures.ts` writes them.
 */

/** A small deterministic generator (mulberry32), so the data never changes between runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const REGIONS = ['North', 'South', 'East', 'West'] as const
export const PRODUCTS = ['Widget', 'Gadget', 'Doohickey', 'Gizmo', 'Sprocket', 'Flange'] as const
const BASE_PRICES = [12.5, 30, 7.25, 18, 4.75, 22] as const

export interface SaleRow {
  readonly date: string
  readonly region: string
  readonly product: string
  readonly units: number
  readonly price: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 500 sales over 2024 and 2025. */
export function generateSales(): SaleRow[] {
  const random = seededRandom(865)
  const rows: SaleRow[] = []
  for (let i = 0; i < 500; i++) {
    const year = random() < 0.5 ? 2024 : 2025
    const month = 1 + Math.floor(random() * 12)
    const day = 1 + Math.floor(random() * 28)
    const productIndex = Math.floor(random() * PRODUCTS.length)
    rows.push({
      date: `${year}-${pad(month)}-${pad(day)}`,
      region: REGIONS[Math.floor(random() * REGIONS.length)]!,
      product: PRODUCTS[productIndex]!,
      units: 1 + Math.floor(random() * 20),
      price: BASE_PRICES[productIndex]! + Math.floor(random() * 10) * 0.25,
    })
  }
  return rows
}

/** The sales as sales.csv. */
export function salesCsv(rows: readonly SaleRow[] = generateSales()): string {
  return (
    'date,region,product,units,price\n' +
    rows
      .map((r) => `${r.date},${r.region},${r.product},${r.units},${r.price.toFixed(2)}`)
      .join('\n') +
    '\n'
  )
}

/** Revenue (units times price) of `region`'s sales in `year`, per product, largest first. */
export function revenueByProduct(
  rows: readonly SaleRow[],
  region: string,
  year: number | undefined,
): { product: string; total: number }[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (row.region !== region) continue
    if (year != null && !row.date.startsWith(`${year}-`)) continue
    totals.set(
      row.product,
      (totals.get(row.product) ?? 0) + row.units * Number(row.price.toFixed(2)),
    )
  }
  return [...totals.entries()]
    .map(([product, total]) => ({ product, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
}

export interface CustomerRow {
  readonly id: string
  readonly region: string
  readonly joined: string
}
export interface OrderRow {
  readonly customerId: string
  readonly amount: number
}

/**
 * 40 customers over four regions; every region has joiners in 2024, and the West's 2024 joiners
 * have no orders, so the join must keep a region with nothing to total.
 */
export function generateCustomers(): CustomerRow[] {
  const random = seededRandom(2024)
  const rows: CustomerRow[] = []
  for (let i = 1; i <= 40; i++) {
    const region = REGIONS[(i - 1) % REGIONS.length]!
    // The first eight are 2024 joiners, two per region, so every region is listed.
    const year = i <= 8 ? 2024 : [2023, 2024, 2025][Math.floor(random() * 3)]!
    rows.push({
      id: `C${String(i).padStart(3, '0')}`,
      region,
      joined: `${year}-${pad(1 + Math.floor(random() * 12))}-${pad(1 + Math.floor(random() * 28))}`,
    })
  }
  return rows
}

/** About 150 orders, from the customers (none from a West customer who joined in 2024). */
export function generateOrders(
  customers: readonly CustomerRow[] = generateCustomers(),
): OrderRow[] {
  const random = seededRandom(77)
  const rows: OrderRow[] = []
  // No order from a West customer who joined in 2024.
  const eligible = customers.filter((c) => !(c.region === 'West' && c.joined.startsWith('2024-')))
  for (let i = 0; i < 150; i++) {
    const customer = eligible[Math.floor(random() * eligible.length)]!
    rows.push({ customerId: customer.id, amount: 5 + Math.floor(random() * 19500) / 100 })
  }
  return rows
}

/** The customers as customers.csv. */
export function customersCsv(rows: readonly CustomerRow[] = generateCustomers()): string {
  return 'id,region,joined\n' + rows.map((r) => `${r.id},${r.region},${r.joined}`).join('\n') + '\n'
}
/** The orders as orders.csv. */
export function ordersCsv(rows: readonly OrderRow[] = generateOrders()): string {
  return (
    'customer_id,amount\n' +
    rows.map((r) => `${r.customerId},${r.amount.toFixed(2)}`).join('\n') +
    '\n'
  )
}

/** The total order amount per region of the customers who joined in 2024 (0 where none). */
export function ordersOf2024Joiners(
  customers: readonly CustomerRow[],
  orders: readonly OrderRow[],
): Record<string, number> {
  const totals: Record<string, number> = {}
  const regionOf = new Map<string, string>()
  for (const c of customers) {
    if (!c.joined.startsWith('2024-')) continue
    regionOf.set(c.id, c.region)
    totals[c.region] ??= 0
  }
  for (const order of orders) {
    const region = regionOf.get(order.customerId)
    if (region != null) totals[region] = (totals[region] ?? 0) + order.amount
  }
  for (const region of Object.keys(totals)) totals[region] = Math.round(totals[region]! * 100) / 100
  return totals
}

/** The `monthly` table of the `visualize` task: month number and revenue. */
export const MONTHLY_REVENUE: readonly (readonly [number, number])[] = [
  [1, 1200],
  [2, 1350],
  [3, 1280],
  [4, 1700],
  [5, 1900],
  [6, 2100],
  [7, 2050],
  [8, 2300],
  [9, 2150],
  [10, 2600],
  [11, 2800],
  [12, 3300],
]
