// ─────────────────────────────────────────────────────────────
//  AI Format Sheet Applier (Pure engine module, no React or DOM)
//  Applies formatting intent through the engine's style system
//  Strictly conforms to AI_CONTRACT.md §4
// ─────────────────────────────────────────────────────────────

import { TOTALS_REGEX, parseNumberValue } from '../engine/sortFilter.js'
import { computeAutoFitWidth } from '../engine/virtualGrid.js'
import { parseDateString } from '../engine/fill.js'

/**
 * Checks if the last row looks like a totals row according to §4 rule 2.
 */
export function looksLikeTotalsRow(engine, rowIndex, colCount) {
    if (rowIndex <= 0) return false

    // Check first filled cell
    let firstFilledCol = -1
    let filledCount = 0
    let hasEmpty = false
    let hasNumberAfterFirst = false

    for (let c = 0; c < colCount; c++) {
        const cell = engine.getCell(rowIndex, c)
        const text = (cell?.raw || '').trim()
        if (text) {
            filledCount++
            if (firstFilledCol === -1) {
                firstFilledCol = c
                if (TOTALS_REGEX.test(text)) {
                    return true
                }
            } else {
                if (parseNumberValue(text) !== null) {
                    hasNumberAfterFirst = true
                }
            }
        } else {
            hasEmpty = true
        }
    }

    if (firstFilledCol !== -1 && filledCount >= 2 && filledCount < colCount && hasEmpty && hasNumberAfterFirst) {
        return true
    }

    return false
}

/**
 * Formats a display value according to a numberFormat style.
 * Does not mutate stored raw value.
 */
export function formatCellValueForDisplay(rawValue, numberFormat) {
    if (rawValue == null || rawValue === '' || !numberFormat || numberFormat === 'general') {
        return rawValue
    }

    const s = String(rawValue).trim()
    if (!s) return rawValue

    switch (numberFormat) {
        case 'currency': {
            const num = parseNumberValue(s)
            if (num === null) return rawValue
            const formatted = Math.abs(num).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
            return num < 0 ? `-$${formatted}` : `$${formatted}`
        }
        case 'number': {
            const num = parseNumberValue(s)
            if (num === null) return rawValue
            return num.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
        }
        case 'percent': {
            const num = parseNumberValue(s)
            if (num === null) return rawValue
            // e.g. 0.1 -> 10%
            const pct = Math.round(num * 100)
            return `${pct}%`
        }
        case 'date': {
            const parsed = parseDateString(s)
            if (!parsed) return rawValue
            const y = String(parsed.year).padStart(4, '0')
            const m = String(parsed.month).padStart(2, '0')
            const d = String(parsed.day).padStart(2, '0')
            return `${y}-${m}-${d}`
        }
        default:
            return rawValue
    }
}

/**
 * Applies format_sheet action to engine and layout.
 * @param {object} engine - spreadsheet engine
 * @param {object} action - format_sheet action
 * @param {object} layout - optional grid layout for freezeRows and columnWidths
 * @returns {object} { result: 'SUCCESS' | 'NO_CHANGES' | 'OUT_OF_RANGE', undoSteps: number, ... }
 */
export function applyFormatSheet(engine, action, layout = null) {
    if (!action || action.type !== 'format_sheet') {
        return { result: 'NO_CHANGES', undoSteps: 0 }
    }

    const usedRange = engine.getUsedRange()
    const headerRow = 0
    const lastRow = usedRange.endRow
    const totalUsedRows = lastRow + 1
    const totalUsedCols = usedRange.endCol + 1

    // 1. Validate freezeRows rule (§4 rule 5)
    if (action.freezeRows !== undefined && action.freezeRows !== null) {
        if (action.freezeRows >= totalUsedRows) {
            return {
                result: 'OUT_OF_RANGE',
                undoSteps: 0,
                error: 'OUT_OF_RANGE',
                detail: `Cannot freeze ${action.freezeRows} rows when table only has ${totalUsedRows} rows`
            }
        }
    }

    // 2. Determine body and totals row (§4 rule 1 and 2)
    const hasBody = totalUsedRows > 1
    let bodyEndRow = lastRow
    let isTotals = false

    if (hasBody && looksLikeTotalsRow(engine, lastRow, totalUsedCols)) {
        isTotals = true
        bodyEndRow = lastRow - 1
    }

    const changes = []

    // 3. Clear formatting if requested (§4 rule 3)
    if (action.clearFormatting) {
        for (let r = 0; r <= lastRow; r++) {
            for (let c = 0; c < totalUsedCols; c++) {
                const cell = engine.getCell(r, c)
                if (cell && cell.style) {
                    changes.push({ row: r, col: c, value: cell.raw, style: undefined })
                }
            }
        }
    }

    // Map: 'r,c' -> style accumulator
    const cellStyles = new Map()

    function getMergedStyle(r, c) {
        const key = `${r},${c}`
        if (cellStyles.has(key)) return cellStyles.get(key)
        const cur = engine.getCell(r, c)
        const base = (action.clearFormatting ? undefined : cur.style) || {}
        const clone = { ...base }
        cellStyles.set(key, clone)
        return clone
    }

    function setMergedStyle(r, c, updates) {
        const cur = getMergedStyle(r, c)
        Object.assign(cur, updates)
    }

    // 4. bodyStyle (§4 rule 3)
    if (action.bodyStyle && hasBody) {
        for (let r = 1; r <= bodyEndRow; r++) {
            for (let c = 0; c < totalUsedCols; c++) {
                setMergedStyle(r, c, action.bodyStyle)
            }
        }
    }

    // 5. columns[] styles (§4 rule 3)
    if (action.columns && hasBody) {
        for (const colEntry of action.columns) {
            const colIdx = colEntry.col
            // Ignore column indices outside 0..colCount-1
            if (colIdx >= 0 && colIdx < totalUsedCols) {
                for (let r = 1; r <= bodyEndRow; r++) {
                    setMergedStyle(r, colIdx, colEntry.style)
                }
            }
        }
    }

    // 6. totalsStyle (§4 rule 3)
    if (action.totalsStyle && isTotals) {
        for (let c = 0; c < totalUsedCols; c++) {
            setMergedStyle(lastRow, c, action.totalsStyle)
        }
    }

    // 7. headerStyle last (§4 rule 3)
    if (action.headerStyle) {
        for (let c = 0; c < totalUsedCols; c++) {
            setMergedStyle(headerRow, c, action.headerStyle)
        }
    }

    // Convert accumulated styles to changes
    for (const [key, style] of cellStyles.entries()) {
        const [rStr, cStr] = key.split(',')
        const r = parseInt(rStr, 10)
        const c = parseInt(cStr, 10)
        const rawCell = engine.getCell(r, c)
        changes.push({
            row: r,
            col: c,
            value: rawCell.raw,
            style
        })
    }

    // 8. Apply freezeRows & column widths to layout if provided
    let layoutModified = false
    if (layout) {
        if (action.freezeRows !== undefined && action.freezeRows !== null) {
            // Apply freezeRows if supported by layout
            if (layout.freezeRows !== action.freezeRows) {
                layout.freezeRows = action.freezeRows
                layoutModified = true
            }
        }

        if (action.columnWidths) {
            for (const cw of action.columnWidths) {
                if (cw.col >= 0 && cw.col < totalUsedCols && cw.width >= 30 && cw.width <= 600) {
                    if (layout.getColWidth(cw.col) !== cw.width) {
                        layout.setColWidth(cw.col, cw.width)
                        layoutModified = true
                    }
                }
            }
        }

        if (action.autoFitColumns) {
            for (let c = 0; c < totalUsedCols; c++) {
                const autoW = computeAutoFitWidth(engine, c, usedRange)
                layout.setColWidth(c, autoW)
                layoutModified = true
            }
        }
    }

    if (changes.length > 0) {
        const applied = engine.setCells(changes)
        if (applied) {
            return {
                result: 'SUCCESS',
                undoSteps: 1,
                frozenRows: action.freezeRows !== undefined ? action.freezeRows : undefined
            }
        }
    }

    if (layoutModified) {
        return {
            result: 'SUCCESS',
            undoSteps: 1,
            frozenRows: action.freezeRows !== undefined ? action.freezeRows : undefined
        }
    }

    return {
        result: 'NO_CHANGES',
        undoSteps: 0,
        frozenRows: action.freezeRows !== undefined ? action.freezeRows : undefined
    }
}
