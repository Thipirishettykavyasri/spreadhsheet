// ─────────────────────────────────────────────────────────────
//  Sort and Filter Engine Module (Pure engine logic, no DOM / React)
//  Handles:
//   - Value parsing & comparison (blanks last, numbers before text, dates as dates)
//   - Data block & totals row detection
//   - Stable sorting with cycle: asc -> desc -> original
//   - Filter-aware sorting (only reorders visible rows, hidden rows remain stationary)
//   - Formula reference adjustment for reordered rows (whole-block ranges stay intact)
//   - Filter conditions and multi-column AND filtering
// ─────────────────────────────────────────────────────────────

import { parseDateString } from './fill.js'

// ── Number and Date parsing for sort and filter ──

export function parseNumberValue(val) {
    if (val == null) return null
    if (typeof val === 'number') return isNaN(val) ? null : val
    const s = String(val).trim()
    if (!s) return null
    if (s.toLowerCase() === 'n/a') return null
    const hasPercent = s.endsWith('%')
    const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    const num = parseFloat(cleaned)
    if (isNaN(num)) return null
    return hasPercent ? num / 100 : num
}

export function parseSortValue(raw) {
    if (raw == null) return { type: 'blank', value: null, raw: '' }
    const s = String(raw).trim()
    if (s === '') return { type: 'blank', value: null, raw: '' }

    const num = parseNumberValue(s)
    if (num !== null) {
        return { type: 'number', value: num, raw: s }
    }

    const dateObj = parseDateString(s)
    if (dateObj !== null) {
        return { type: 'date', value: dateObj.utc, raw: s }
    }

    return { type: 'text', value: s.toLowerCase(), raw: s }
}

const TYPE_PRIORITY = {
    number: 1,
    date: 2,
    text: 3,
    blank: 4
}

/**
 * Compares two sort values.
 * Blanks always sort last, regardless of direction.
 * Numbers sort before text.
 * Dates sort as dates.
 * Text is case-insensitive.
 */
export function compareValues(a, b, direction = 'asc') {
    // 1. Blanks always sort last in both directions
    const aBlank = a.type === 'blank'
    const bBlank = b.type === 'blank'
    if (aBlank && bBlank) return 0
    if (aBlank) return 1
    if (bBlank) return -1

    // 2. Different types: numbers before dates before text in both directions
    if (a.type !== b.type) {
        return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
    }

    // 3. Same types
    let diff = 0
    if (a.type === 'number' || a.type === 'date') {
        diff = a.value - b.value
    } else {
        diff = a.value.localeCompare(b.value)
    }

    return direction === 'desc' ? -diff : diff
}

// ── Totals row detection ──

export const TOTALS_REGEX = /^(grand\s+)?(total|totals|subtotal|sum)\b/i

export function isTotalsRow(getCell, rowIndex, colCount) {
    for (let c = 0; c < colCount; c++) {
        const cell = getCell(rowIndex, c)
        const text = (cell?.raw || '').trim()
        if (text) {
            return TOTALS_REGEX.test(text)
        }
    }
    return false
}

// ── Data Block Detection ──

export function detectSortRange(engine, selectionRange, rowIdentities = null) {
    if (selectionRange && Math.abs(selectionRange.endRow - selectionRange.startRow) >= 1) {
        const startRow = Math.min(selectionRange.startRow, selectionRange.endRow)
        const endRow = Math.max(selectionRange.startRow, selectionRange.endRow)
        const startCol = Math.min(selectionRange.startCol, selectionRange.endCol)
        const endCol = Math.max(selectionRange.startCol, selectionRange.endCol)

        // If selection has header, header is startRow, body is startRow + 1 .. endRow
        return {
            headerRow: startRow,
            startRow: startRow + 1,
            endRow: endRow,
            startCol: startCol,
            endCol: endCol,
            hasTotalsRow: false
        }
    }

    // Otherwise use used range
    const usedRange = engine.getUsedRange()
    const headerRow = 0
    let startRow = 1
    let endRow = usedRange.endRow
    if (rowIdentities && rowIdentities.size > 0) {
        endRow = Math.max(endRow, Math.max(...rowIdentities.keys()))
    }
    const startCol = usedRange.startCol
    const endCol = usedRange.endCol

    let hasTotals = false
    if (endRow >= 1 && isTotalsRow(engine.getCell, endRow, endCol + 1)) {
        hasTotals = true
        endRow = endRow - 1 // exclude totals row from sort
    }

    return {
        headerRow,
        startRow,
        endRow,
        startCol,
        endCol,
        hasTotalsRow: hasTotals
    }
}

// ── Formula Reference Remapping on Row Sort ──

/**
 * Remaps formula references when rows are reordered.
 * A range spanning the whole block (e.g. J2:J32) remains unchanged.
 */
export function remapFormulaRowReferences(formula, rowMapping) {
    if (!formula || !formula.startsWith('=')) return formula

    // 1. First protect ranges like A2:A4, J2:J32, etc. (whole block or multi-cell ranges)
    const preservedRanges = []
    let protectedFormula = formula.replace(/(\$?[A-Za-z]+\$?\d+):(\$?[A-Za-z]+\$?\d+)/g, (match) => {
        const placeholder = `__PRESERVED_RANGE_${preservedRanges.length}__`
        preservedRanges.push(match)
        return placeholder
    })

    // 2. Remap individual row references that moved
    protectedFormula = protectedFormula.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (match, colPin, colLetter, rowPin, rowStr) => {
        const row1 = parseInt(rowStr, 10)
        const rowIdx = row1 - 1

        if (rowMapping.has(rowIdx)) {
            const newRowIdx = rowMapping.get(rowIdx)
            return `${colPin}${colLetter}${rowPin}${newRowIdx + 1}`
        }
        return match
    })

    // 3. Restore preserved ranges
    for (let i = 0; i < preservedRanges.length; i++) {
        protectedFormula = protectedFormula.replace(`__PRESERVED_RANGE_${i}__`, preservedRanges[i])
    }

    return protectedFormula
}

// ── Sorting Implementation ──

/**
 * Sorts data rows.
 * @param {object} engine - spreadsheet engine
 * @param {object} options
 *   - col: column index to sort by
 *   - direction: 'asc' | 'desc' | 'original'
 *   - selectionRange: optional Range
 *   - visibleRowIndices: optional Set/Array of visible row indices
 *   - rowIdentities: optional Map<rowIndex, originalIdentityIndex>
 */
export function executeSort(engine, options) {
    const {
        col,
        direction = 'asc',
        selectionRange = null,
        visibleRowIndices = null,
        rowIdentities = null
    } = options

    const rangeInfo = detectSortRange(engine, selectionRange, rowIdentities)
    const { startRow, endRow, startCol, endCol } = rangeInfo

    if (startRow > endRow) return { success: false, rowIdentities }

    // Identify candidate rows to sort
    let targetRowIndices = []
    for (let r = startRow; r <= endRow; r++) {
        if (!visibleRowIndices || visibleRowIndices.has(r)) {
            targetRowIndices.push(r)
        }
    }

    if (targetRowIndices.length <= 1) return { success: true, rowIdentities }

    // Ensure we have stable row identities
    const stableIdentities = rowIdentities ? new Map(rowIdentities) : new Map()
    for (const r of targetRowIndices) {
        if (!stableIdentities.has(r)) {
            stableIdentities.set(r, r)
        }
    }

    const rawGetter = engine.getCellRaw || engine.getCell

    // Pre-cache sort values for the sort column to avoid duplicate parses
    const sortValCache = new Map()

    // Extract row records
    const colCount = endCol - startCol + 1
    const rowRecords = targetRowIndices.map(r => {
        const cellData = rawGetter(r, col)
        const sortRaw = cellData.raw || ''
        let sortVal = sortValCache.get(sortRaw)
        if (sortVal === undefined) {
            sortVal = parseSortValue(sortRaw)
            sortValCache.set(sortRaw, sortVal)
        }
        const origId = stableIdentities.get(r)

        // Read used cells in this row — only include non-empty cells plus
        // a sparse representation so we can write them back efficiently.
        const rowCells = new Array(colCount)
        for (let ci = 0; ci < colCount; ci++) {
            const c = startCol + ci
            const rawCell = rawGetter(r, c)
            rowCells[ci] = {
                col: c,
                raw: rawCell.raw,
                style: rawCell.style
            }
        }

        return {
            currentRow: r,
            originalId: origId,
            sortVal,
            cells: rowCells
        }
    })

    // Sort the row records
    if (direction === 'original') {
        rowRecords.sort((a, b) => a.originalId - b.originalId)
    } else {
        rowRecords.sort((a, b) => {
            const cmp = compareValues(a.sortVal, b.sortVal, direction)
            if (cmp !== 0) return cmp
            return a.originalId - b.originalId // tie-breaker for stability
        })
    }

    // Create mapping of old row -> new row
    const rowMapping = new Map()
    for (let i = 0; i < targetRowIndices.length; i++) {
        const destRow = targetRowIndices[i]
        const sourceRecord = rowRecords[i]
        rowMapping.set(sourceRecord.currentRow, destRow)
    }

    // Update stableIdentities mapping to reflect new positions
    const newIdentities = new Map(stableIdentities)
    for (let i = 0; i < targetRowIndices.length; i++) {
        const destRow = targetRowIndices[i]
        const sourceRecord = rowRecords[i]
        newIdentities.set(destRow, sourceRecord.originalId)
    }

    // Prepare changes for bulk update
    const changes = []
    for (let i = 0; i < targetRowIndices.length; i++) {
        const destRow = targetRowIndices[i]
        const sourceRecord = rowRecords[i]

        if (sourceRecord.currentRow === destRow) {
            continue
        }

        for (const cell of sourceRecord.cells) {
            // Remap formulas in moved rows
            const newRaw = remapFormulaRowReferences(cell.raw, rowMapping)
            changes.push({
                row: destRow,
                col: cell.col,
                value: newRaw,
                style: cell.style
            })
        }
    }

    const updated = engine.setCells(changes)
    return {
        success: updated,
        rowIdentities: newIdentities,
        rangeInfo
    }
}

// ── Filtering Logic ──

/**
 * Evaluates whether a cell passes a filter condition.
 */
export function evaluateFilterCondition(cellRaw, condition) {
    if (!condition) return true
    const { type, value } = condition
    const s = (cellRaw || '').trim()

    switch (type) {
        case 'contains':
            return s.toLowerCase().includes(String(value || '').trim().toLowerCase())
        case 'gt': {
            const numC = parseNumberValue(s)
            const numV = parseNumberValue(value)
            if (numC !== null && numV !== null) return numC > numV
            const dateC = parseDateString(s)
            const dateV = parseDateString(value)
            if (dateC !== null && dateV !== null) return dateC.utc > dateV.utc
            return s.toLowerCase() > String(value || '').toLowerCase()
        }
        case 'lt': {
            const numC = parseNumberValue(s)
            const numV = parseNumberValue(value)
            if (numC !== null && numV !== null) return numC < numV
            const dateC = parseDateString(s)
            const dateV = parseDateString(value)
            if (dateC !== null && dateV !== null) return dateC.utc < dateV.utc
            return s.toLowerCase() < String(value || '').toLowerCase()
        }
        case 'isEmpty':
            return s === ''
        case 'notEmpty':
            return s !== ''
        default:
            return true
    }
}

/**
 * Evaluates multiple column filters across the engine rows.
 * @param {object} engine
 * @param {Map<number, object>|object} filters - column -> { search, selectedValues, condition }
 * @returns { visibleRows: Set<number>, hiddenRows: Set<number>, totalCount: number, visibleCount: number }
 */
export function evaluateSheetFilters(engine, filters) {
    const usedRange = engine.getUsedRange()
    const headerRow = 0
    let startRow = 1
    let endRow = usedRange.endRow

    if (endRow >= 1 && isTotalsRow(engine.getCell, endRow, usedRange.endCol + 1)) {
        endRow = endRow - 1
    }

    const totalCount = Math.max(0, endRow - startRow + 1)
    const visibleRows = new Set()
    const hiddenRows = new Set()

    // Always include header row and totals row in visible
    visibleRows.add(headerRow)
    if (usedRange.endRow > endRow) {
        visibleRows.add(usedRange.endRow) // totals row is always visible
    }

    const filterEntries = filters instanceof Map ? Array.from(filters.entries()) : Object.entries(filters).map(([k, v]) => [Number(k), v])

    if (filterEntries.length === 0) {
        for (let r = startRow; r <= endRow; r++) visibleRows.add(r)
        return { visibleRows, hiddenRows, totalCount, visibleCount: totalCount }
    }

    for (let r = startRow; r <= endRow; r++) {
        let passes = true

        for (const [colIndex, filter] of filterEntries) {
            if (!filter) continue
            const cell = engine.getCell(r, colIndex)
            const raw = cell ? cell.raw : ''
            const trimmed = (raw || '').trim()
            const normKey = trimmed.toLowerCase()

            // 1. Condition check
            if (filter.condition && !evaluateFilterCondition(raw, filter.condition)) {
                passes = false
                break
            }

            // 2. Distinct values checklist check
            if (filter.selectedValues && filter.selectedValues.size > 0) {
                if (trimmed === '') {
                    if (!filter.selectedValues.has('__BLANKS__')) {
                        passes = false
                        break
                    }
                } else if (!filter.selectedValues.has(normKey)) {
                    passes = false
                    break
                }
            }
        }

        if (passes) {
            visibleRows.add(r)
        } else {
            hiddenRows.add(r)
        }
    }

    return {
        visibleRows,
        hiddenRows,
        totalCount,
        visibleCount: visibleRows.size - (visibleRows.has(headerRow) ? 1 : 0) - (usedRange.endRow > endRow ? 1 : 0)
    }
}

/**
 * Gathers distinct values from a column for filter checklist.
 */
export function getDistinctColumnValues(engine, colIndex) {
    const usedRange = engine.getUsedRange()
    let startRow = 1
    let endRow = usedRange.endRow
    if (endRow >= 1 && isTotalsRow(engine.getCell, endRow, usedRange.endCol + 1)) {
        endRow = endRow - 1
    }

    const distinctMap = new Map()
    let hasBlanks = false

    for (let r = startRow; r <= endRow; r++) {
        const cell = engine.getCell(r, colIndex)
        const raw = (cell?.raw || '').trim()
        if (raw === '') {
            hasBlanks = true
        } else {
            const normKey = raw.toLowerCase()
            if (!distinctMap.has(normKey)) {
                distinctMap.set(normKey, { label: raw, count: 1 })
            } else {
                distinctMap.get(normKey).count++
            }
        }
    }

    return {
        items: Array.from(distinctMap.entries()).map(([key, val]) => ({
            key,
            label: val.label,
            count: val.count
        })),
        hasBlanks
    }
}
