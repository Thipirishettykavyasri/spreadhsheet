// ─────────────────────────────────────────────────────────────
//  Query Executor (Pure engine module, no React or DOM)
//  Executes read-only query plans deterministically over sheet data
//  Strictly conforms to AI_CONTRACT.md §3
// ─────────────────────────────────────────────────────────────

import { parseDateString } from '../engine/fill.js'
import { isTotalsRow } from '../engine/sortFilter.js'
import { MAX_RESULT_ROWS } from './contract.js'

// ── Coercions & Normalizations (§3.2) ──

export function norm(v) {
    if (v == null) return ''
    return String(v).trim().toLowerCase()
}

export function toNum(v) {
    if (v == null) return null
    if (typeof v === 'number') return isNaN(v) ? null : v
    const s = String(v).trim()
    if (!s) return null
    if (s.toLowerCase() === 'n/a') return null
    const hasPercent = s.endsWith('%')
    const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    const num = parseFloat(cleaned)
    if (isNaN(num)) return null
    return hasPercent ? num / 100 : num
}

export function toDate(v) {
    if (v == null) return null
    const s = String(v).trim()
    if (!s || s.toLowerCase() === 'n/a') return null
    const parsed = parseDateString(s)
    if (!parsed) return null
    // Format to YYYY-MM-DD
    const y = String(parsed.year).padStart(4, '0')
    const m = String(parsed.month).padStart(2, '0')
    const d = String(parsed.day).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/**
 * Executes a validated query plan against the engine.
 * @param {object} engine - spreadsheet engine
 * @param {object} plan - query action object
 * @returns {object} result shape or error object
 */
export function executeQueryPlan(engine, plan) {
    if (!plan || plan.type !== 'query') {
        return { error: 'READ_ONLY', detail: 'Executor only supports read-only query actions' }
    }

    const usedRange = engine.getUsedRange()
    const headerColCount = Math.min(engine.cols, (usedRange.endCol ?? 0) + 1)
    const lastRow = usedRange.endRow
    const rawAt = engine.getCellRaw
        ? (r, c) => engine.getCellRaw(r, c)
        : (r, c) => engine.getCell(r, c)

    // 1. Read Header Row (Row 0)
    const headerCols = []
    const colNameToIndex = new Map()
    for (let c = 0; c < headerColCount; c++) {
        const name = String(rawAt(0, c)?.raw || '').trim()
        if (name) {
            headerCols.push({ index: c, name })
            colNameToIndex.set(name.toLowerCase(), c)
        }
    }

    function resolveColIndex(colName) {
        if (!colName || typeof colName !== 'string') return null
        const key = colName.trim().toLowerCase()
        if (colNameToIndex.has(key)) return colNameToIndex.get(key)
        return null
    }

    // 2. Validate columns in plan
    if (plan.filters) {
        for (const f of plan.filters) {
            if (resolveColIndex(f.column) === null) {
                return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${f.column}` }
            }
        }
    }
    if (plan.groupBy) {
        for (const col of plan.groupBy) {
            if (resolveColIndex(col) === null) {
                return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${col}` }
            }
        }
    }
    if (plan.aggregates) {
        for (const agg of plan.aggregates) {
            if (resolveColIndex(agg.column) === null) {
                return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${agg.column}` }
            }
        }
    }
    if (plan.columns) {
        for (const col of plan.columns) {
            if (resolveColIndex(col) === null) {
                return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${col}` }
            }
        }
    }

    // 3. Determine data rows range
    const excludeTotals = plan.excludeTotalsRow !== false
    let endRow = lastRow
    if (excludeTotals && endRow >= 1 && isTotalsRow(rawAt, endRow, headerCols.length || headerColCount)) {
        endRow = endRow - 1
    }

    const hasAggregates = Array.isArray(plan.aggregates) && plan.aggregates.length > 0
    const neededColIndices = new Set()
    if (plan.filters) {
        for (const f of plan.filters) {
            const idx = resolveColIndex(f.column)
            if (idx !== null) neededColIndices.add(idx)
        }
    }
    if (plan.groupBy) {
        for (const col of plan.groupBy) {
            const idx = resolveColIndex(col)
            if (idx !== null) neededColIndices.add(idx)
        }
    }
    if (plan.aggregates) {
        for (const agg of plan.aggregates) {
            const idx = resolveColIndex(agg.column)
            if (idx !== null) neededColIndices.add(idx)
        }
    }
    if (plan.columns && plan.columns.length > 0) {
        for (const col of plan.columns) {
            const idx = resolveColIndex(col)
            if (idx !== null) neededColIndices.add(idx)
        }
    } else if (!hasAggregates) {
        for (const h of headerCols) {
            neededColIndices.add(h.index)
        }
    }
    const neededColsArray = Array.from(neededColIndices)

    const cellReader = engine.getCellFast
        ? (r, c) => engine.getCellFast(r, c)
        : (r, c) => {
            const cell = engine.getCell(r, c)
            return (cell.computed !== null && cell.computed !== undefined && cell.computed !== '')
                ? cell.computed
                : (cell.raw || '')
        }

    const numCache = new Map()
    const dateCache = new Map()
    const normCache = new Map()

    function cachedToNum(v) {
        if (v == null) return null
        if (typeof v === 'number') return isNaN(v) ? null : v
        const key = typeof v === 'string' ? v : String(v)
        if (numCache.has(key)) return numCache.get(key)
        const n = toNum(v)
        numCache.set(key, n)
        return n
    }

    function cachedToDate(v) {
        if (v == null) return null
        const key = typeof v === 'string' ? v : String(v)
        if (dateCache.has(key)) return dateCache.get(key)
        const d = toDate(v)
        dateCache.set(key, d)
        return d
    }

    function cachedNorm(v) {
        if (v == null) return ''
        const key = typeof v === 'string' ? v : String(v)
        if (normCache.has(key)) return normCache.get(key)
        const n = key.trim().toLowerCase()
        normCache.set(key, n)
        return n
    }

    // 4. Collect non-blank data rows as packed column arrays (avoids per-row objects)
    const neededCount = neededColsArray.length
    const colValues = new Array(neededCount)
    for (let i = 0; i < neededCount; i++) colValues[i] = []
    const liveRowIndices = []

    for (let r = 1; r <= endRow; r++) {
        let allEmpty = true
        const rowVals = new Array(neededCount)
        for (let i = 0; i < neededCount; i++) {
            const val = cellReader(r, neededColsArray[i])
            rowVals[i] = val
            if (val !== '' && val !== null && val !== undefined) allEmpty = false
        }
        if (!allEmpty) {
            const packedIndex = liveRowIndices.length
            liveRowIndices.push(r)
            for (let i = 0; i < neededCount; i++) colValues[i][packedIndex] = rowVals[i]
        }
    }

    const colOffset = new Map()
    for (let i = 0; i < neededCount; i++) colOffset.set(neededColsArray[i], i)

    function cellAt(packedIndex, sheetCol) {
        const off = colOffset.get(sheetCol)
        return off === undefined ? '' : colValues[off][packedIndex]
    }

    // 5. Apply Filters (AND)
    const filters = plan.filters || []
    const filteredPacked = []
    for (let p = 0; p < liveRowIndices.length; p++) {
        let pass = true
        for (let fi = 0; fi < filters.length; fi++) {
            const f = filters[fi]
            const colIdx = resolveColIndex(f.column)
            const cVal = cellAt(p, colIdx)
            const vVal = f.value
            const op = f.op
            switch (op) {
                case 'eq': {
                    const nC = cachedToNum(cVal)
                    const nV = cachedToNum(vVal)
                    if (nC !== null && nV !== null) {
                        if (nC !== nV) pass = false
                    } else if (cachedNorm(cVal) !== cachedNorm(vVal)) {
                        pass = false
                    }
                    break
                }
                case 'neq': {
                    const nC = cachedToNum(cVal)
                    const nV = cachedToNum(vVal)
                    if (nC !== null && nV !== null) {
                        if (nC === nV) pass = false
                    } else if (cachedNorm(cVal) === cachedNorm(vVal)) {
                        pass = false
                    }
                    break
                }
                case 'gt':
                case 'gte':
                case 'lt':
                case 'lte': {
                    const dateV = cachedToDate(vVal)
                    if (dateV !== null) {
                        const dateC = cachedToDate(cVal)
                        if (dateC === null) { pass = false; break }
                        if (op === 'gt' && !(dateC > dateV)) pass = false
                        else if (op === 'gte' && !(dateC >= dateV)) pass = false
                        else if (op === 'lt' && !(dateC < dateV)) pass = false
                        else if (op === 'lte' && !(dateC <= dateV)) pass = false
                    } else {
                        const nC = cachedToNum(cVal)
                        const nV = cachedToNum(vVal)
                        if (nC === null || nV === null) { pass = false; break }
                        if (op === 'gt' && !(nC > nV)) pass = false
                        else if (op === 'gte' && !(nC >= nV)) pass = false
                        else if (op === 'lt' && !(nC < nV)) pass = false
                        else if (op === 'lte' && !(nC <= nV)) pass = false
                    }
                    break
                }
                case 'contains':
                    if (!cachedNorm(cVal).includes(cachedNorm(vVal))) pass = false
                    break
                case 'startsWith':
                    if (!cachedNorm(cVal).startsWith(cachedNorm(vVal))) pass = false
                    break
                case 'endsWith':
                    if (!cachedNorm(cVal).endsWith(cachedNorm(vVal))) pass = false
                    break
                case 'isEmpty':
                    if (cachedNorm(cVal) !== '') pass = false
                    break
                case 'notEmpty':
                    if (cachedNorm(cVal) === '') pass = false
                    break
                default:
                    return { error: 'UNKNOWN_OP', detail: `UNKNOWN_OP:${op}` }
            }
            if (!pass) break
        }
        if (pass) filteredPacked.push(p)
    }

    // 6. Grouping and Aggregates (§3.4)

    let outputColumns = []
    let resultRows = []

    if (hasAggregates) {
        const groupCols = plan.groupBy || []
        const groupIndices = groupCols.map(name => resolveColIndex(name))
        const aggDefs = plan.aggregates.map(agg => ({
            fn: agg.fn,
            colIdx: resolveColIndex(agg.column),
            alias: agg.as || `${agg.fn}(${agg.column})`
        }))

        outputColumns = [...groupCols, ...aggDefs.map(a => a.alias)]

        // Map: groupKey -> { labels: [], rows: [] }
        const groups = new Map()

        if (groupCols.length > 0) {
            for (let i = 0; i < filteredPacked.length; i++) {
                const p = filteredPacked[i]
                const keyParts = []
                const labels = []

                for (let g = 0; g < groupIndices.length; g++) {
                    const rawVal = cellAt(p, groupIndices[g])
                    keyParts.push(cachedNorm(rawVal))
                    labels.push(String(rawVal == null ? '' : rawVal).trim())
                }

                const groupKey = keyParts.join('\u0000')
                let group = groups.get(groupKey)
                if (!group) {
                    group = { labels, packed: [] }
                    groups.set(groupKey, group)
                }
                group.packed.push(p)
            }
        }

        if (groupCols.length === 0) {
            groups.set('__ALL__', { labels: [], packed: filteredPacked })
        }

        for (const [, group] of groups.entries()) {
            const rowValues = group.labels.slice()

            for (const agg of aggDefs) {
                let aggResult = null
                switch (agg.fn) {
                    case 'count': {
                        let n = 0
                        for (let i = 0; i < group.packed.length; i++) {
                            if (cachedNorm(cellAt(group.packed[i], agg.colIdx)) !== '') n++
                        }
                        aggResult = n
                        break
                    }
                    case 'countDistinct': {
                        const distinctSet = new Set()
                        for (let i = 0; i < group.packed.length; i++) {
                            const nv = cachedNorm(cellAt(group.packed[i], agg.colIdx))
                            if (nv !== '') distinctSet.add(nv)
                        }
                        aggResult = distinctSet.size
                        break
                    }
                    case 'sum':
                    case 'avg':
                    case 'min':
                    case 'max': {
                        let countN = 0
                        let sum = 0
                        let minV = Infinity
                        let maxV = -Infinity
                        for (let i = 0; i < group.packed.length; i++) {
                            const num = cachedToNum(cellAt(group.packed[i], agg.colIdx))
                            if (num === null) continue
                            countN++
                            sum += num
                            if (num < minV) minV = num
                            if (num > maxV) maxV = num
                        }
                        if (countN === 0) aggResult = null
                        else if (agg.fn === 'sum') aggResult = sum
                        else if (agg.fn === 'avg') aggResult = sum / countN
                        else if (agg.fn === 'min') aggResult = minV
                        else aggResult = maxV
                        break
                    }
                    default:
                        return { error: 'UNKNOWN_FN', detail: `UNKNOWN_FN:${agg.fn}` }
                }

                if (typeof aggResult === 'number') {
                    aggResult = Number(aggResult.toFixed(2))
                }
                rowValues.push(aggResult)
            }

            resultRows.push(rowValues)
        }
    } else {
        // Row results (no aggregates)
        if (plan.columns && plan.columns.length > 0) {
            outputColumns = [...plan.columns]
        } else {
            outputColumns = headerCols.map(h => h.name)
        }

        const outIndices = outputColumns.map(name => resolveColIndex(name))

        for (let i = 0; i < filteredPacked.length; i++) {
            const p = filteredPacked[i]
            const rowVals = []
            for (let j = 0; j < outIndices.length; j++) {
                rowVals.push(cellAt(p, outIndices[j]))
            }
            resultRows.push(rowVals)
        }
    }

    // 7. Multi-key Stable Sort (§3.5)
    if (plan.sort && plan.sort.length > 0) {
        // Tag with original insertion index for stable sorting
        const tagged = resultRows.map((r, i) => ({ row: r, index: i }))

        const sortKeys = []
        for (const s of plan.sort) {
            // Match output column
            const outColIdx = outputColumns.findIndex(c => c.trim().toLowerCase() === s.column.trim().toLowerCase())
            if (outColIdx === -1) {
                return { error: 'UNKNOWN_SORT_COLUMN', detail: `UNKNOWN_SORT_COLUMN:${s.column}` }
            }
            sortKeys.push({ colIdx: outColIdx, dir: s.dir === 'desc' ? 'desc' : 'asc' })
        }

        tagged.sort((a, b) => {
            for (const { colIdx, dir } of sortKeys) {
                const valA = a.row[colIdx]
                const valB = b.row[colIdx]

                const numA = cachedToNum(valA)
                const numB = cachedToNum(valB)

                let cmp = 0
                if (numA !== null && numB !== null) {
                    cmp = numA - numB
                } else if (numA !== null) {
                    cmp = -1 // numbers before non-numbers
                } else if (numB !== null) {
                    cmp = 1
                } else {
                    cmp = cachedNorm(valA).localeCompare(cachedNorm(valB))
                }

                if (cmp !== 0) {
                    return dir === 'desc' ? -cmp : cmp
                }
            }
            return a.index - b.index // stable tie-breaker
        })

        resultRows = tagged.map(t => t.row)
    }

    // 8. Limit and Truncation (§3.5)
    const effectiveLimit = Math.min(plan.limit || MAX_RESULT_ROWS, MAX_RESULT_ROWS)
    const totalCountBeforeCut = resultRows.length
    let truncated = false

    if (resultRows.length > effectiveLimit) {
        resultRows = resultRows.slice(0, effectiveLimit)
        truncated = true
    } else if (plan.limit !== undefined && totalCountBeforeCut > plan.limit) {
        truncated = true
    }

    return {
        columns: outputColumns,
        rows: resultRows,
        rowCount: resultRows.length,
        truncated
    }
}
