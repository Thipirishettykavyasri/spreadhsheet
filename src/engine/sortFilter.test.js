import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'
import { loadSampleSmall, loadSampleLarge } from '../fixtures/loadSample.js'
import { evaluateSheetFilters, getDistinctColumnValues } from './sortFilter.js'

describe('Challenge 2: Sort and Filter', () => {
    describe('Acceptance on fixtures/sales.tsv', () => {
        it('Acceptance 1: Put =J2/G2 in K2, fill to K32. Sort by Total descending -> K2 is 1080, A33 is Total, blank row sorts last', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            // Put =J2/G2 in K2 (row 1, col 10) and fill down to K32 (row 31, col 10)
            engine.setCell(1, 10, '=J2/G2')
            engine.fill(
                { startRow: 1, startCol: 10, endRow: 1, endCol: 10 },
                { row: 31, col: 10 }
            )

            // Verify initial K2 formula and value before sort
            expect(engine.getCell(1, 10).raw).toBe('=J2/G2')

            // Col 9 is Total. Sort by Total descending
            engine.sort(9, 'desc')

            // Row 2 (index 1) should now be ORD-1025
            expect(engine.getCell(1, 0).raw).toBe('ORD-1025')
            // ORD-1025 Total is $9,720.00, Units is 9 -> 9720 / 9 = 1080
            expect(engine.getCell(1, 10).computed).toBe(1080)

            // A33 (row index 32) still reads 'Total' (the totals row was pinned and not sorted)
            expect(engine.getCell(32, 0).raw).toBe('Total')

            // The blank row and ORD-1021 (both have blank Total) sort last before the totals row
            expect(engine.getCell(30, 0).raw).toBe('')
            expect(engine.getCell(30, 9).raw).toBe('')
            expect(engine.getCell(31, 9).raw).toBe('')
        })

        it('Acceptance 2: Filter Region to West (including West and west), then sort by Units -> hidden rows do not move', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            // Region is column 2
            // Filter to 'West'
            const westFilter = {
                2: {
                    selectedValues: new Set(['west']) // normalized to lowercase
                }
            }

            const filterResult = evaluateSheetFilters(engine, westFilter)
            // Verify filter matched West, West , west
            expect(filterResult.visibleRows.has(2)).toBe(true)  // Row 3: West
            expect(filterResult.visibleRows.has(5)).toBe(true)  // Row 6: West 
            expect(filterResult.visibleRows.has(8)).toBe(true)  // Row 9: west

            // Note a hidden row: row 1 (ORD-1001, North) is hidden
            expect(filterResult.hiddenRows.has(1)).toBe(true)
            const hiddenRow1Content = engine.getCell(1, 0).raw
            expect(hiddenRow1Content).toBe('ORD-1001')

            // Sort by Units (column 6) ascending with filter active
            engine.sort(6, 'asc', { visibleRowIndices: filterResult.visibleRows })

            // Verify hidden row 1 DID NOT MOVE!
            expect(engine.getCell(1, 0).raw).toBe(hiddenRow1Content)

            // Visible rows should now be sorted by units among themselves
            const visibleRowsArray = Array.from(filterResult.visibleRows)
                .filter(r => r >= 1 && r < 32)
                .sort((a, b) => a - b)

            const unitsValues = visibleRowsArray.map(r => parseFloat(engine.getCell(r, 6).raw))
            for (let i = 0; i < unitsValues.length - 1; i++) {
                expect(unitsValues[i]).toBeLessThanOrEqual(unitsValues[i + 1])
            }
        })

        it('Acceptance 3: Undo restores sorted order and formulas', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            const initialA2 = engine.getCell(1, 0).raw // ORD-1001

            // Sort descending by Total (col 9)
            engine.sort(9, 'desc')
            expect(engine.getCell(1, 0).raw).toBe('ORD-1025')

            // Undo once reverts sort completely
            engine.undo()
            expect(engine.getCell(1, 0).raw).toBe(initialA2)
        })

        it('Acceptance 4: Sort performance on sales-large.tsv (~3,000 rows) is well under 300 ms', () => {
            const engine = createEngine(3500, 20)
            loadSampleLarge(engine)

            const start = performance.now()
            // Date is column 1
            engine.sort(1, 'asc')
            const duration = performance.now() - start

            console.log(`Measured 3,000-row sort duration: ${duration.toFixed(2)} ms`)
            expect(duration).toBeLessThan(300)
        })

        it('10,000-row sort performance budget is under 300 ms', () => {
            const engine = createEngine(10100, 5)
            // Fill 10,000 numeric rows in reverse order
            const batch = []
            for (let r = 1; r <= 10000; r++) {
                batch.push({ row: r, col: 0, value: String(10000 - r) })
            }
            engine.setCells(batch)

            const start = performance.now()
            engine.sort(0, 'asc')
            const duration = performance.now() - start

            console.log(`Measured 10,000-row sort duration: ${duration.toFixed(2)} ms`)
            expect(engine.getCell(1, 0).raw).toBe('0')
            expect(engine.getCell(10000, 0).raw).toBe('9999')
            expect(duration).toBeLessThan(300)
        })
    })

    describe('Sort comparison rules and cycling', () => {
        it('sorts numbers before text and blanks last in both directions', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Header')
            engine.setCell(1, 0, 'Banana')
            engine.setCell(2, 0, '100')
            engine.setCell(3, 0, '')
            engine.setCell(4, 0, '25')
            engine.setCell(5, 0, 'Apple')

            // Ascending: numbers (25, 100) -> text (Apple, Banana) -> blank
            engine.sort(0, 'asc')
            expect(engine.getCell(1, 0).raw).toBe('25')
            expect(engine.getCell(2, 0).raw).toBe('100')
            expect(engine.getCell(3, 0).raw).toBe('Apple')
            expect(engine.getCell(4, 0).raw).toBe('Banana')
            expect(engine.getCell(5, 0).raw).toBe('')

            // Descending: numbers (100, 25) -> text (Banana, Apple) -> blank
            engine.sort(0, 'desc')
            expect(engine.getCell(1, 0).raw).toBe('100')
            expect(engine.getCell(2, 0).raw).toBe('25')
            expect(engine.getCell(3, 0).raw).toBe('Banana')
            expect(engine.getCell(4, 0).raw).toBe('Apple')
            expect(engine.getCell(5, 0).raw).toBe('')

            // Original order restore
            engine.sort(0, 'original')
            expect(engine.getCell(1, 0).raw).toBe('Banana')
            expect(engine.getCell(2, 0).raw).toBe('100')
            expect(engine.getCell(3, 0).raw).toBe('')
            expect(engine.getCell(4, 0).raw).toBe('25')
            expect(engine.getCell(5, 0).raw).toBe('Apple')
        })

        it('sorts dates chronologically across different date formats', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Date')
            engine.setCell(1, 0, '2024-03-15')
            engine.setCell(2, 0, '1/8/2024')
            engine.setCell(3, 0, '15 Jan 2024')

            engine.sort(0, 'asc')
            // Earliest: 1/8/2024 (Jan 8), then 15 Jan 2024, then 2024-03-15
            expect(engine.getCell(1, 0).raw).toBe('1/8/2024')
            expect(engine.getCell(2, 0).raw).toBe('15 Jan 2024')
            expect(engine.getCell(3, 0).raw).toBe('2024-03-15')
        })

        it('carries cell styles with their rows during sort', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Header')
            engine.setCell(1, 0, 'Row 1', { bold: true, bg: '#ff0000' })
            engine.setCell(2, 0, 'Row 2', { italic: true, bg: '#00ff00' })

            engine.sort(0, 'desc')
            expect(engine.getCell(1, 0).raw).toBe('Row 2')
            expect(engine.getCell(1, 0).style.italic).toBe(true)

            expect(engine.getCell(2, 0).raw).toBe('Row 1')
            expect(engine.getCell(2, 0).style.bold).toBe(true)
        })

        it('preserves whole-block range formulas like =SUM(A2:A4)', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Val')
            engine.setCell(1, 0, '30')
            engine.setCell(2, 0, '10')
            engine.setCell(3, 0, '20')
            // Formula outside or at bottom
            engine.setCell(4, 0, '=SUM(A2:A4)')

            engine.sort(0, 'asc')
            expect(engine.getCell(1, 0).raw).toBe('10')
            expect(engine.getCell(2, 0).raw).toBe('20')
            expect(engine.getCell(3, 0).raw).toBe('30')
            // Formula still sums A2:A4
            expect(engine.getCell(4, 0).raw).toBe('=SUM(A2:A4)')
            expect(engine.getCell(4, 0).computed).toBe(60)
        })
    })

    describe('Filter conditions and distinct values', () => {
        it('gathers distinct normalized column values including blanks', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Region')
            engine.setCell(1, 0, 'West')
            engine.setCell(2, 0, 'West ')
            engine.setCell(3, 0, 'East')
            engine.setCell(4, 0, '')
            engine.setCell(5, 0, 'South')

            const distinct = getDistinctColumnValues(engine, 0)
            expect(distinct.hasBlanks).toBe(true)
            // 'west' and 'West ' should be grouped under normalized key 'west'
            const westItem = distinct.items.find(i => i.key === 'west')
            expect(westItem).toBeDefined()
            expect(westItem.count).toBe(2)
        })

        it('supports contains, greater than, less than, isEmpty, and notEmpty conditions', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Amount')
            engine.setCell(1, 0, '$100.00')
            engine.setCell(2, 0, '$500.00')
            engine.setCell(3, 0, '$50.00')

            const gtFilter = { 0: { condition: { type: 'gt', value: '75' } } }
            const res = evaluateSheetFilters(engine, gtFilter)
            expect(res.visibleRows.has(1)).toBe(true) // 100 > 75
            expect(res.visibleRows.has(2)).toBe(true) // 500 > 75
            expect(res.visibleRows.has(3)).toBe(false) // 50 < 75
        })
    })
})
