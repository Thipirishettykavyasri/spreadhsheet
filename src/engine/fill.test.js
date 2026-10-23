import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'

describe('Challenge 1 - Fill Handle', () => {
    describe('Numeric series', () => {
        it('copies a single numeric seed', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, '42')

            engine.fill(
                { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
                { row: 3, col: 0 }
            )

            expect(engine.getCell(1, 0).raw).toBe('42')
            expect(engine.getCell(2, 0).raw).toBe('42')
            expect(engine.getCell(3, 0).raw).toBe('42')
        })

        it('extrapolates numeric progression for 2 or more seeds (1, 2 -> 3, 4, ...)', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, '1')
            engine.setCell(1, 0, '2')

            engine.fill(
                { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
                { row: 4, col: 0 }
            )

            expect(engine.getCell(2, 0).raw).toBe('3')
            expect(engine.getCell(3, 0).raw).toBe('4')
            expect(engine.getCell(4, 0).raw).toBe('5')
        })

        it('supports non-unit steps and decimal values', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, '10')
            engine.setCell(1, 0, '25')

            engine.fill(
                { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
                { row: 3, col: 0 }
            )

            expect(engine.getCell(2, 0).raw).toBe('40')
            expect(engine.getCell(3, 0).raw).toBe('55')
        })

        it('fills upward/backward with negative progression', () => {
            const engine = createEngine(10, 10)
            engine.setCell(3, 0, '30')
            engine.setCell(4, 0, '40')

            engine.fill(
                { startRow: 3, startCol: 0, endRow: 4, endCol: 0 },
                { row: 1, col: 0 }
            )

            expect(engine.getCell(2, 0).raw).toBe('20')
            expect(engine.getCell(1, 0).raw).toBe('10')
        })
    })

    describe('Text numbers (ORD-1001, Item 1, Q4, 2024-W01)', () => {
        it('acceptance: Select A2:A3 (ORD-1001, ORD-1002), drag to A6: A4:A6 become ORD-1003 … ORD-1005 with 1-step undo', () => {
            const engine = createEngine(10, 10)
            // Row index 1 = A2, row index 2 = A3
            engine.setCell(1, 0, 'ORD-1001')
            engine.setCell(2, 0, 'ORD-1002')

            engine.fill(
                { startRow: 1, startCol: 0, endRow: 2, endCol: 0 },
                { row: 5, col: 0 } // A6 is row index 5
            )

            expect(engine.getCell(3, 0).raw).toBe('ORD-1003')
            expect(engine.getCell(4, 0).raw).toBe('ORD-1004')
            expect(engine.getCell(5, 0).raw).toBe('ORD-1005')

            // One undo restores them
            engine.undo()
            expect(engine.getCell(3, 0).raw).toBe('')
            expect(engine.getCell(4, 0).raw).toBe('')
            expect(engine.getCell(5, 0).raw).toBe('')
            expect(engine.getCell(1, 0).raw).toBe('ORD-1001')
            expect(engine.getCell(2, 0).raw).toBe('ORD-1002')

            // Redo brings them back
            engine.redo()
            expect(engine.getCell(3, 0).raw).toBe('ORD-1003')
            expect(engine.getCell(4, 0).raw).toBe('ORD-1004')
            expect(engine.getCell(5, 0).raw).toBe('ORD-1005')
        })

        it('increments single seed text ending in a number (Item 1, Q4, 2024-W01) preserving padding', () => {
            const engine = createEngine(10, 10)

            // Item 1
            engine.setCell(0, 0, 'Item 1')
            engine.fill({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { row: 2, col: 0 })
            expect(engine.getCell(1, 0).raw).toBe('Item 2')
            expect(engine.getCell(2, 0).raw).toBe('Item 3')

            // Q4
            engine.setCell(0, 1, 'Q4')
            engine.fill({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, { row: 2, col: 1 })
            expect(engine.getCell(1, 1).raw).toBe('Q5')
            expect(engine.getCell(2, 1).raw).toBe('Q6')

            // 2024-W01 (zero padding 2 digits)
            engine.setCell(0, 2, '2024-W01')
            engine.fill({ startRow: 0, startCol: 2, endRow: 0, endCol: 2 }, { row: 2, col: 2 })
            expect(engine.getCell(1, 2).raw).toBe('2024-W02')
            expect(engine.getCell(2, 2).raw).toBe('2024-W03')
        })
    })

    describe('Dates', () => {
        it('steps a single date by 1 day, keeping its format', () => {
            const engine = createEngine(10, 10)

            // ISO format
            engine.setCell(0, 0, '2024-01-15')
            engine.fill({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { row: 2, col: 0 })
            expect(engine.getCell(1, 0).raw).toBe('2024-01-16')
            expect(engine.getCell(2, 0).raw).toBe('2024-01-17')

            // US slash format
            engine.setCell(0, 1, '1/15/2024')
            engine.fill({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, { row: 2, col: 1 })
            expect(engine.getCell(1, 1).raw).toBe('1/16/2024')
            expect(engine.getCell(2, 1).raw).toBe('1/17/2024')

            // Day Month Year format
            engine.setCell(0, 2, '15 Jan 2024')
            engine.fill({ startRow: 0, startCol: 2, endRow: 0, endCol: 2 }, { row: 2, col: 2 })
            expect(engine.getCell(1, 2).raw).toBe('16 Jan 2024')
            expect(engine.getCell(2, 2).raw).toBe('17 Jan 2024')
        })

        it('acceptance: Select B2:B4 (three date formats), fill to B8: each cell keeps its seeds format', () => {
            const engine = createEngine(10, 10)
            // Row 1 = B2 (ISO), Row 2 = B3 (US), Row 3 = B4 (DMY)
            engine.setCell(1, 1, '2024-01-01')
            engine.setCell(2, 1, '1/2/2024')
            engine.setCell(3, 1, '3 Jan 2024')

            // Fill to B8 (row index 7)
            engine.fill(
                { startRow: 1, startCol: 1, endRow: 3, endCol: 1 },
                { row: 7, col: 1 }
            )

            // Delta between Jan 1 and Jan 3 across 2 intervals is 1 day.
            // B5 (row 4): corresponds to B2 (ISO) -> 2024-01-04
            expect(engine.getCell(4, 1).raw).toBe('2024-01-04')
            // B6 (row 5): corresponds to B3 (US) -> 1/5/2024
            expect(engine.getCell(5, 1).raw).toBe('1/5/2024')
            // B7 (row 6): corresponds to B4 (DMY) -> 6 Jan 2024
            expect(engine.getCell(6, 1).raw).toBe('6 Jan 2024')
            // B8 (row 7): corresponds to B2 (ISO) -> 2024-01-07
            expect(engine.getCell(7, 1).raw).toBe('2024-01-07')
        })

        it('handles the exact sales.tsv sample dates for B2:B4', () => {
            const engine = createEngine(10, 10)
            engine.setCell(1, 1, '2024-01-03') // ISO
            engine.setCell(2, 1, '2024-01-05') // ISO
            engine.setCell(3, 1, '1/8/2024')   // US

            engine.fill(
                { startRow: 1, startCol: 1, endRow: 3, endCol: 1 },
                { row: 7, col: 1 }
            )

            // Formats are preserved cyclically:
            // B5 (index 4) matches B2 format (ISO)
            expect(engine.getCell(4, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            // B6 (index 5) matches B3 format (ISO)
            expect(engine.getCell(5, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            // B7 (index 6) matches B4 format (US)
            expect(engine.getCell(6, 1).raw).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
            // B8 (index 7) matches B2 format (ISO)
            expect(engine.getCell(7, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        })
    })

    describe('Weekday and Month names', () => {
        it('cycles weekdays and preserves case (Mon -> Tue)', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, 'Mon')
            engine.fill({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { row: 6, col: 0 })

            expect(engine.getCell(1, 0).raw).toBe('Tue')
            expect(engine.getCell(2, 0).raw).toBe('Wed')
            expect(engine.getCell(3, 0).raw).toBe('Thu')
            expect(engine.getCell(4, 0).raw).toBe('Fri')
            expect(engine.getCell(5, 0).raw).toBe('Sat')
            expect(engine.getCell(6, 0).raw).toBe('Sun')
        })

        it('cycles months and preserves case (Jan -> Feb, UPPERCASE, lowercase)', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, 'JAN')
            engine.fill({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { row: 2, col: 0 })
            expect(engine.getCell(1, 0).raw).toBe('FEB')
            expect(engine.getCell(2, 0).raw).toBe('MAR')

            engine.setCell(0, 1, 'dec')
            engine.fill({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, { row: 2, col: 1 })
            expect(engine.getCell(1, 1).raw).toBe('jan')
            expect(engine.getCell(2, 1).raw).toBe('feb')
        })
    })

    describe('Formula reference adjustment', () => {
        it('acceptance: Put =G2*H2 in K2 and =$G$2*H2 in L2, fill to row 32: K32 is =G32*H32, L32 is =$G$2*H32', () => {
            const engine = createEngine(50, 20)

            // Setup mock data in row 2 (index 1) and row 32 (index 31)
            // G is col 6, H is col 7, K is col 10, L is col 11
            engine.setCell(1, 6, '10') // G2
            engine.setCell(1, 7, '2')  // H2
            engine.setCell(31, 6, '5') // G32
            engine.setCell(31, 7, '4') // H32

            // K2 = =G2*H2
            engine.setCell(1, 10, '=G2*H2')
            // L2 = =$G$2*H2
            engine.setCell(1, 11, '=$G$2*H2')

            expect(engine.getCell(1, 10).computed).toBe(20)
            expect(engine.getCell(1, 11).computed).toBe(20)

            // Select K2:L2 (rows 1..1, cols 10..11) and fill to row 32 (row index 31)
            engine.fill(
                { startRow: 1, startCol: 10, endRow: 1, endCol: 11 },
                { row: 31, col: 11 }
            )

            // Check K32
            expect(engine.getCell(31, 10).raw).toBe('=G32*H32')
            expect(engine.getCell(31, 10).computed).toBe(20) // 5 * 4 = 20

            // Check L32 ($G$2 stays pinned, H2 shifts to H32)
            expect(engine.getCell(31, 11).raw).toBe('=$G$2*H32')
            expect(engine.getCell(31, 11).computed).toBe(40) // $G$2 is 10, H32 is 4 -> 40
        })

        it('acceptance: Insert a row above row 10: L33 now reads =$G$2*H33', () => {
            const engine = createEngine(50, 20)

            engine.setCell(1, 6, '10') // G2
            engine.setCell(1, 7, '2')  // H2
            engine.setCell(31, 6, '5') // G32
            engine.setCell(31, 7, '4') // H32

            engine.setCell(1, 10, '=G2*H2')
            engine.setCell(1, 11, '=$G$2*H2')

            engine.fill(
                { startRow: 1, startCol: 10, endRow: 1, endCol: 11 },
                { row: 31, col: 11 }
            )

            // Insert row above row 10 (row index 9)
            engine.insertRow(9)

            // L32 was shifted to L33 (row index 32)
            // L33 should read =$G$2*H33
            expect(engine.getCell(32, 11).raw).toBe('=$G$2*H33')
            expect(engine.getCell(32, 11).computed).toBe(40)
        })

        it('handles mixed relative and absolute references ($A1 and A$1) horizontally and vertically', () => {
            const engine = createEngine(20, 20)
            engine.setCell(0, 0, '=$A1+B$1')

            // Fill horizontally to col 2 (C1)
            engine.fill(
                { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
                { row: 0, col: 2 }
            )

            // $A stays $A, B$1 shifts horizontally to C$1
            expect(engine.getCell(0, 1).raw).toBe('=$A1+C$1')
            expect(engine.getCell(0, 2).raw).toBe('=$A1+D$1')

            // Fill vertically to row 2 (A3)
            engine.fill(
                { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
                { row: 2, col: 0 }
            )
            // $A1 row shifts to $A2, B$1 stays row 1 (pinned)
            expect(engine.getCell(1, 0).raw).toBe('=$A2+B$1')
            expect(engine.getCell(2, 0).raw).toBe('=$A3+B$1')
        })
    })

    describe('Style inheritance and Shrinking', () => {
        it('inherits seed cell style on fill', () => {
            const engine = createEngine(10, 10)
            const boldStyle = { bold: true, bg: 'yellow', color: '#ff0000' }
            engine.setCell(0, 0, 'Header', boldStyle)

            engine.fill(
                { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
                { row: 2, col: 0 }
            )

            expect(engine.getCell(1, 0).style).toEqual(boldStyle)
            expect(engine.getCell(2, 0).style).toEqual(boldStyle)
        })

        it('clears cells when dragging back (shrink fill) and one-step undo restores them', () => {
            const engine = createEngine(10, 10)
            engine.setCell(0, 0, 'A')
            engine.setCell(1, 0, 'B')
            engine.setCell(2, 0, 'C')
            engine.setCell(3, 0, 'D')

            // Selection is row 0 to 3. Drag handle up to row 1.
            engine.fill(
                { startRow: 0, startCol: 0, endRow: 3, endCol: 0 },
                { row: 1, col: 0 }
            )

            expect(engine.getCell(0, 0).raw).toBe('A')
            expect(engine.getCell(1, 0).raw).toBe('B')
            expect(engine.getCell(2, 0).raw).toBe('')
            expect(engine.getCell(3, 0).raw).toBe('')

            // Undo restores C and D
            engine.undo()
            expect(engine.getCell(2, 0).raw).toBe('C')
            expect(engine.getCell(3, 0).raw).toBe('D')
        })
    })

    describe('Performance budget', () => {
        it('fills 5,000 cells in under 200 ms', () => {
            const engine = createEngine(5100, 10)
            engine.setCell(0, 0, 'ORD-1001')
            engine.setCell(1, 0, 'ORD-1002')

            const start = performance.now()
            engine.fill(
                { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
                { row: 5001, col: 0 } // fills 5,000 rows
            )
            const duration = performance.now() - start

            expect(engine.getCell(5001, 0).raw).toBe('ORD-6002')
            expect(duration).toBeLessThan(200)
        })
    })
})
