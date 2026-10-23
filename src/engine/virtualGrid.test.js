import { describe, it, expect } from 'vitest'
import {
    createGridLayout,
    parseNameBoxCoordinate,
    computeAutoFitWidth,
    DEFAULT_COL_WIDTH
} from './virtualGrid.js'
import { createEngine } from './core.js'

describe('Challenge 3: Virtualized Grid and Sizing', () => {
    it('supports 100,000 rows x 200 columns with prefix sums and binary search', () => {
        const layout = createGridLayout(100000, 200)

        expect(layout.rowCount).toBe(100000)
        expect(layout.colCount).toBe(200)

        // Row 95,000 top offset calculation
        const row95kTop = layout.getRowTop(95000)
        expect(row95kTop).toBe(95000 * 28)

        // Binary search finds row 95,000 exactly from offset
        const foundRow = layout.findRowIndexAtOffset(row95kTop + 5)
        expect(foundRow).toBe(95000)

        // Viewport slice around row 95,000 with 600px height only computes a small window
        const slice = layout.getVisibleSlice(row95kTop, 0, 600, 800)
        expect(slice.startRow).toBeGreaterThanOrEqual(94990)
        expect(slice.endRow).toBeLessThanOrEqual(95035)
        expect(slice.endRow - slice.startRow).toBeLessThan(40)
    })

    it('Acceptance: resize column D to 300 px, insert column before D -> inserted column is default width, old D keeps 300 px', () => {
        const layout = createGridLayout(1000, 50)
        // D is column index 3
        layout.setColWidth(3, 300)
        expect(layout.getColWidth(3)).toBe(300)

        // Insert a column before D (at index 3)
        layout.onInsertColumn(3)

        // The newly inserted column at index 3 uses default width
        expect(layout.getColWidth(3)).toBe(DEFAULT_COL_WIDTH)

        // The original D shifted to index 4 (E) and kept 300 px
        expect(layout.getColWidth(4)).toBe(300)
    })

    it('Name box jump to AZ5000 parses correctly to 0-based coordinates', () => {
        // AZ is col: 'A'*26 + 'Z' = 1*26 + 26 = 52 -> index 51
        // 5000 is row: 5000 -> index 4999
        const coords = parseNameBoxCoordinate('AZ5000')
        expect(coords).toEqual({ row: 4999, col: 51 })

        expect(parseNameBoxCoordinate('A1')).toEqual({ row: 0, col: 0 })
        expect(parseNameBoxCoordinate('B10')).toEqual({ row: 9, col: 1 })
        expect(parseNameBoxCoordinate('invalid')).toBeNull()
    })

    it('computes auto-fit width based on longest cell content', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'Short')
        engine.setCell(1, 0, 'This is a significantly longer string for testing auto fit')

        const width = computeAutoFitWidth(engine, 0, { startRow: 0, endRow: 1 })
        expect(width).toBeGreaterThan(150)
    })
})
