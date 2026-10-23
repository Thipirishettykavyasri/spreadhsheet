// ─────────────────────────────────────────────────────────────
//  Virtual Grid Engine Module (Pure logic, no DOM / React)
//  Handles:
//   - Prefix sums & binary search for variable row heights & column widths
//   - Window calculation (visible range + overscan)
//   - Column resize & auto-fit calculation
//   - Navigation coordinate translation (AZ5000 -> { row: 4999, col: 51 })
//   - Structural row/column resizing tracking through insert/delete
// ─────────────────────────────────────────────────────────────

import { columnLetterToIndex } from './fill.js'

export const DEFAULT_COL_WIDTH = 110
export const DEFAULT_ROW_HEIGHT = 28
export const ROW_HEADER_WIDTH = 50
export const COL_HEADER_HEIGHT = 28

/**
 * Manages grid layout metrics (row heights, column widths, prefix sums).
 */
export function createGridLayout(initialRows = 100000, initialCols = 200) {
    let rowCount = initialRows
    let colCount = initialCols
    let freezeRows = 0
    let freezeCols = 0

    // Sparse maps for customized sizes: index -> size
    const customColWidths = new Map()
    const customRowHeights = new Map()

    function getColWidth(col) {
        return customColWidths.get(col) || DEFAULT_COL_WIDTH
    }

    function setColWidth(col, width) {
        if (width <= 0) return
        customColWidths.set(col, Math.max(30, Math.min(600, Math.round(width))))
    }

    function getRowHeight(row) {
        return customRowHeights.get(row) || DEFAULT_ROW_HEIGHT
    }

    function setRowHeight(row, height) {
        if (height <= 0) return
        customRowHeights.set(row, Math.max(18, Math.min(200, Math.round(height))))
    }

    // ── Coordinate / Offset translation using prefix sums ──

    function getColLeft(col) {
        // Since customColWidths is sparse, calculate default + custom deltas
        let left = col * DEFAULT_COL_WIDTH
        for (const [c, w] of customColWidths.entries()) {
            if (c < col) {
                left += (w - DEFAULT_COL_WIDTH)
            }
        }
        return left
    }

    function getRowTop(row) {
        let top = row * DEFAULT_ROW_HEIGHT
        for (const [r, h] of customRowHeights.entries()) {
            if (r < row) {
                top += (h - DEFAULT_ROW_HEIGHT)
            }
        }
        return top
    }

    function getTotalWidth() {
        return getColLeft(colCount)
    }

    function getTotalHeight() {
        return getRowTop(rowCount)
    }

    /**
     * Finds column index at horizontal scroll offset using binary search.
     */
    function findColIndexAtOffset(x) {
        if (x <= 0) return 0
        let low = 0
        let high = colCount - 1
        while (low <= high) {
            const mid = Math.floor((low + high) / 2)
            const left = getColLeft(mid)
            const width = getColWidth(mid)
            if (x >= left && x < left + width) {
                return mid
            } else if (x < left) {
                high = mid - 1
            } else {
                low = mid + 1
            }
        }
        return Math.min(colCount - 1, Math.max(0, low))
    }

    /**
     * Finds row index at vertical scroll offset using binary search.
     */
    function findRowIndexAtOffset(y) {
        if (y <= 0) return 0
        let low = 0
        let high = rowCount - 1
        while (low <= high) {
            const mid = Math.floor((low + high) / 2)
            const top = getRowTop(mid)
            const height = getRowHeight(mid)
            if (y >= top && y < top + height) {
                return mid
            } else if (y < top) {
                high = mid - 1
            } else {
                low = mid + 1
            }
        }
        return Math.min(rowCount - 1, Math.max(0, low))
    }

    /**
     * Calculates visible slice for viewport.
     */
    function getVisibleSlice(scrollTop, scrollLeft, viewportHeight, viewportWidth, overscanRows = 5, overscanCols = 3) {
        const startRow = Math.max(0, findRowIndexAtOffset(scrollTop) - overscanRows)
        const endRow = Math.min(rowCount - 1, findRowIndexAtOffset(scrollTop + viewportHeight) + overscanRows)

        const startCol = Math.max(0, findColIndexAtOffset(scrollLeft) - overscanCols)
        const endCol = Math.min(colCount - 1, findColIndexAtOffset(scrollLeft + viewportWidth) + overscanCols)

        return { startRow, endRow, startCol, endCol }
    }

    // ── Structural adjustments for row/col insert/delete ──

    function onInsertColumn(atIndex) {
        const updated = new Map()
        for (const [col, width] of customColWidths.entries()) {
            if (col >= atIndex) {
                updated.set(col + 1, width)
            } else {
                updated.set(col, width)
            }
        }
        customColWidths.clear()
        for (const [c, w] of updated.entries()) customColWidths.set(c, w)
        colCount++
    }

    function onDeleteColumn(atIndex) {
        const updated = new Map()
        for (const [col, width] of customColWidths.entries()) {
            if (col === atIndex) continue
            if (col > atIndex) {
                updated.set(col - 1, width)
            } else {
                updated.set(col, width)
            }
        }
        customColWidths.clear()
        for (const [c, w] of updated.entries()) customColWidths.set(c, w)
        colCount--
    }

    function onInsertRow(atIndex) {
        const updated = new Map()
        for (const [row, height] of customRowHeights.entries()) {
            if (row >= atIndex) {
                updated.set(row + 1, height)
            } else {
                updated.set(row, height)
            }
        }
        customRowHeights.clear()
        for (const [r, h] of updated.entries()) customRowHeights.set(r, h)
        rowCount++
    }

    function onDeleteRow(atIndex) {
        const updated = new Map()
        for (const [row, height] of customRowHeights.entries()) {
            if (row === atIndex) continue
            if (row > atIndex) {
                updated.set(row - 1, height)
            } else {
                updated.set(row, height)
            }
        }
        customRowHeights.clear()
        for (const [r, h] of updated.entries()) customRowHeights.set(r, h)
        rowCount--
    }

    function ensureCapacity(minRows, minCols) {
        if (minRows > rowCount) rowCount = minRows
        if (minCols > colCount) colCount = minCols
    }

    function snapshot() {
        return {
            rowCount,
            colCount,
            freezeRows,
            freezeCols,
            colWidths: Array.from(customColWidths.entries()),
            rowHeights: Array.from(customRowHeights.entries()),
        }
    }

    function restore(snap) {
        if (!snap) return
        rowCount = snap.rowCount
        colCount = snap.colCount
        freezeRows = snap.freezeRows || 0
        freezeCols = snap.freezeCols || 0
        customColWidths.clear()
        customRowHeights.clear()
        for (const [c, w] of snap.colWidths || []) customColWidths.set(c, w)
        for (const [r, h] of snap.rowHeights || []) customRowHeights.set(r, h)
    }

    return {
        get rowCount() { return rowCount },
        get colCount() { return colCount },
        get freezeRows() { return freezeRows },
        set freezeRows(value) { freezeRows = Math.max(0, value | 0) },
        get freezeCols() { return freezeCols },
        set freezeCols(value) { freezeCols = Math.max(0, value | 0) },
        getColWidth,
        setColWidth,
        getRowHeight,
        setRowHeight,
        getColLeft,
        getRowTop,
        getTotalWidth,
        getTotalHeight,
        findColIndexAtOffset,
        findRowIndexAtOffset,
        getVisibleSlice,
        onInsertColumn,
        onDeleteColumn,
        onInsertRow,
        onDeleteRow,
        ensureCapacity,
        snapshot,
        restore,
    }
}

// ── Auto-fit column measurement ──

export function computeAutoFitWidth(engine, colIndex, usedRange) {
    const startRow = usedRange ? usedRange.startRow : 0
    const endRow = usedRange ? usedRange.endRow : Math.min(100, engine.rows - 1)

    let maxChars = 4
    for (let r = startRow; r <= endRow; r++) {
        const cell = engine.getCell(r, colIndex)
        const text = cell ? String(cell.computed !== null && cell.computed !== undefined ? cell.computed : cell.raw) : ''
        if (text.length > maxChars) {
            maxChars = text.length
        }
    }

    // Approx 8.5px per character in monospace/sans font + 24px cell padding
    const calculated = Math.ceil(maxChars * 8.5) + 24
    return Math.max(60, Math.min(500, calculated))
}

// ── Name Box coordinate parser ──

export function parseNameBoxCoordinate(input) {
    if (!input || typeof input !== 'string') return null
    const s = input.trim().toUpperCase()
    const match = s.match(/^([A-Z]+)(\d+)$/)
    if (!match) return null

    const colIndex = columnLetterToIndex(match[1])
    const rowIndex = parseInt(match[2], 10) - 1

    if (colIndex < 0 || rowIndex < 0) return null
    return { row: rowIndex, col: colIndex }
}
