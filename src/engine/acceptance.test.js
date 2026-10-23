import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'
import { loadSampleSmall } from '../fixtures/loadSample.js'

describe('Challenge 1 Acceptance Tests on fixtures/sales.tsv', () => {
    it('Acceptance A: Text series (Select A2:A3, drag to A6 -> A4:A6 are ORD-1003..ORD-1005, one Ctrl+Z restores)', () => {
        const engine = createEngine(50, 20)
        loadSampleSmall(engine)

        // Verify initial fixture state at A2, A3, A4, A5, A6
        // Row 1 = A2, Row 2 = A3, Row 3 = A4, Row 4 = A5, Row 5 = A6
        expect(engine.getCell(1, 0).raw).toBe('ORD-1001')
        expect(engine.getCell(2, 0).raw).toBe('ORD-1002')
        const originalA4 = engine.getCell(3, 0).raw
        const originalA5 = engine.getCell(4, 0).raw
        const originalA6 = engine.getCell(5, 0).raw

        // Select A2:A3 (rows 1..2, col 0) and drag to A6 (row 5, col 0)
        engine.fill(
            { startRow: 1, startCol: 0, endRow: 2, endCol: 0 },
            { row: 5, col: 0 }
        )

        expect(engine.getCell(3, 0).raw).toBe('ORD-1003')
        expect(engine.getCell(4, 0).raw).toBe('ORD-1004')
        expect(engine.getCell(5, 0).raw).toBe('ORD-1005')

        // Press Ctrl+Z once and verify the entire fill is reverted
        expect(engine.canUndo()).toBe(true)
        engine.undo()

        expect(engine.getCell(3, 0).raw).toBe(originalA4)
        expect(engine.getCell(4, 0).raw).toBe(originalA5)
        expect(engine.getCell(5, 0).raw).toBe(originalA6)
    })

    it('Acceptance B: Formula translation (Put =G2*H2 in K2 and =$G$2*H2 in L2, fill to row 32)', () => {
        const engine = createEngine(50, 20)
        loadSampleSmall(engine)

        // Row 2 is index 1. Col 6 is G, Col 7 is H, Col 10 is K, Col 11 is L
        // In sales.tsv row 2: G2 = 4, H2 = $1,200.00
        // Set clean numbers in G and H for numerical formula verification
        engine.setCell(1, 6, '4')
        engine.setCell(1, 7, '1200')
        engine.setCell(31, 6, '10') // G32
        engine.setCell(31, 7, '25') // H32

        engine.setCell(1, 10, '=G2*H2')
        engine.setCell(1, 11, '=$G$2*H2')

        // Fill both formulas down through row 32 (index 31)
        engine.fill(
            { startRow: 1, startCol: 10, endRow: 1, endCol: 11 },
            { row: 31, col: 11 }
        )

        // Verify K32 is =G32*H32
        expect(engine.getCell(31, 10).raw).toBe('=G32*H32')
        expect(engine.getCell(31, 10).computed).toBe(250)

        // Verify L32 is =$G$2*H32
        expect(engine.getCell(31, 11).raw).toBe('=$G$2*H32')
        expect(engine.getCell(31, 11).computed).toBe(100) // 4 * 25 = 100
    })

    it('Acceptance C: Structural row insertion (Insert row above row 10 -> L33 reads =$G$2*H33)', () => {
        const engine = createEngine(50, 20)
        loadSampleSmall(engine)

        engine.setCell(1, 6, '4')
        engine.setCell(1, 7, '1200')
        engine.setCell(31, 6, '10')
        engine.setCell(31, 7, '25')

        engine.setCell(1, 10, '=G2*H2')
        engine.setCell(1, 11, '=$G$2*H2')

        engine.fill(
            { startRow: 1, startCol: 10, endRow: 1, endCol: 11 },
            { row: 31, col: 11 }
        )

        // Insert row above row 10 (index 9)
        engine.insertRow(9)

        // Previous row 32 is now row 33 (index 32). L33 should read =$G$2*H33
        expect(engine.getCell(32, 11).raw).toBe('=$G$2*H33')
        expect(engine.getCell(32, 11).computed).toBe(100)
    })

    it('Acceptance D: Dates (Select B2:B4, fill down to B8: increments correctly and preserves formats)', () => {
        const engine = createEngine(50, 20)
        loadSampleSmall(engine)

        // In sales.tsv:
        // Row 2 (index 1): B2 = 2024-01-03 (ISO)
        // Row 3 (index 2): B3 = 2024-01-05 (ISO)
        // Row 4 (index 3): B4 = 1/8/2024 (US)
        expect(engine.getCell(1, 1).raw).toBe('2024-01-03')
        expect(engine.getCell(2, 1).raw).toBe('2024-01-05')
        expect(engine.getCell(3, 1).raw).toBe('1/8/2024')

        // Fill down to B8 (index 7)
        engine.fill(
            { startRow: 1, startCol: 1, endRow: 3, endCol: 1 },
            { row: 7, col: 1 }
        )

        // Formats are preserved cyclically matching seeds:
        // B5 (index 4) matches B2 format (ISO)
        expect(engine.getCell(4, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(engine.getCell(4, 1).raw).toBe('2024-01-11')

        // B6 (index 5) matches B3 format (ISO)
        expect(engine.getCell(5, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(engine.getCell(5, 1).raw).toBe('2024-01-13')

        // B7 (index 6) matches B4 format (US)
        expect(engine.getCell(6, 1).raw).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
        expect(engine.getCell(6, 1).raw).toBe('1/16/2024')

        // B8 (index 7) matches B2 format (ISO)
        expect(engine.getCell(7, 1).raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(engine.getCell(7, 1).raw).toBe('2024-01-18')
    })
})

describe('Additional Challenge 1 Automated Tests', () => {
    it('supports horizontal numeric series (1, 2 -> 3, 4, 5)', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '1')
        engine.setCell(0, 1, '2')

        engine.fill(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
            { row: 0, col: 4 }
        )

        expect(engine.getCell(0, 2).raw).toBe('3')
        expect(engine.getCell(0, 3).raw).toBe('4')
        expect(engine.getCell(0, 4).raw).toBe('5')
    })

    it('supports text suffixes with zero padding (Item 01 -> Item 02, Item 03)', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'Item 01')

        engine.fill(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
            { row: 2, col: 0 }
        )

        expect(engine.getCell(1, 0).raw).toBe('Item 02')
        expect(engine.getCell(2, 0).raw).toBe('Item 03')
    })

    it('supports text suffixes without zero padding (Item 1 -> Item 2, Item 3)', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'Item 1')

        engine.fill(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
            { row: 2, col: 0 }
        )

        expect(engine.getCell(1, 0).raw).toBe('Item 2')
        expect(engine.getCell(2, 0).raw).toBe('Item 3')
    })

    it('fills leftward and upward with negative offset', () => {
        const engine = createEngine(10, 10)

        // Horizontal leftward fill
        engine.setCell(0, 3, '40')
        engine.setCell(0, 4, '50')
        engine.fill(
            { startRow: 0, startCol: 3, endRow: 0, endCol: 4 },
            { row: 0, col: 1 }
        )
        expect(engine.getCell(0, 2).raw).toBe('30')
        expect(engine.getCell(0, 1).raw).toBe('20')

        // Vertical upward fill
        engine.setCell(3, 0, 'ORD-1004')
        engine.setCell(4, 0, 'ORD-1005')
        engine.fill(
            { startRow: 3, startCol: 0, endRow: 4, endCol: 0 },
            { row: 1, col: 0 }
        )
        expect(engine.getCell(2, 0).raw).toBe('ORD-1003')
        expect(engine.getCell(1, 0).raw).toBe('ORD-1002')
    })

    it('clears multi-cell selection in one undo step', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'A')
        engine.setCell(0, 1, 'B')
        engine.setCell(1, 0, 'C')
        engine.setCell(1, 1, 'D')

        engine.clearRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 })

        expect(engine.getCell(0, 0).raw).toBe('')
        expect(engine.getCell(0, 1).raw).toBe('')
        expect(engine.getCell(1, 0).raw).toBe('')
        expect(engine.getCell(1, 1).raw).toBe('')

        // One undo restores all four cells
        engine.undo()
        expect(engine.getCell(0, 0).raw).toBe('A')
        expect(engine.getCell(0, 1).raw).toBe('B')
        expect(engine.getCell(1, 0).raw).toBe('C')
        expect(engine.getCell(1, 1).raw).toBe('D')
    })

    it('formats a multi-cell selection in one undo step', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'A')
        engine.setCell(0, 1, 'B')

        engine.setRangeStyle({ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }, { bold: true, color: '#123456' })

        expect(engine.getCell(0, 0).style.bold).toBe(true)
        expect(engine.getCell(0, 1).style.bold).toBe(true)

        // One undo reverts styling on all cells
        engine.undo()
        expect(engine.getCell(0, 0).style?.bold).toBeFalsy()
        expect(engine.getCell(0, 1).style?.bold).toBeFalsy()
    })

    it('computes used range correctly for Ctrl+A', () => {
        const engine = createEngine(50, 50)
        expect(engine.getUsedRange()).toEqual({ startRow: 0, startCol: 0, endRow: 49, endCol: 49 })

        engine.setCell(2, 3, 'Data')
        engine.setCell(10, 8, 'Data 2')

        const range = engine.getUsedRange()
        expect(range.startRow).toBe(0)
        expect(range.startCol).toBe(0)
        expect(range.endRow).toBe(10)
        expect(range.endCol).toBe(8)
    })

    it('ignores no-op fills and does not create unnecessary undo history', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'Static')

        const canUndoBefore = engine.canUndo()
        // Target is the same as source (no drag displacement)
        engine.fill(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
            { row: 0, col: 0 }
        )

        // Undo stack should not have grown with a meaningless entry
        expect(engine.canUndo()).toBe(canUndoBefore)
    })

    it('handles non-series text and empty cells by copying cleanly without errors', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'Apple')
        engine.setCell(1, 0, '')

        engine.fill(
            { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
            { row: 3, col: 0 }
        )

        expect(engine.getCell(2, 0).raw).toBe('Apple')
        expect(engine.getCell(3, 0).raw).toBe('')
    })

    it('handles complex formulas with multiple references and ranges', () => {
        const engine = createEngine(20, 20)
        engine.setCell(0, 0, '=SUM(A1:B1) + $C$1 * D1')

        engine.fill(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
            { row: 2, col: 0 }
        )

        expect(engine.getCell(1, 0).raw).toBe('=SUM(A2:B2) + $C$1 * D2')
        expect(engine.getCell(2, 0).raw).toBe('=SUM(A3:B3) + $C$1 * D3')
    })

    describe('Bug regressions: typing, formula results, and multi-column fill', () => {
        it('Bug 2 regression: G2=10, H2=5, K2==G2*H2 evaluates to 50 and updates dynamically on dependency change', () => {
            const engine = createEngine(20, 20)
            engine.setCell(1, 6, '10') // G2 (row 1, col 6)
            engine.setCell(1, 7, '5')  // H2 (row 1, col 7)
            engine.setCell(1, 10, '=G2*H2') // K2 (row 1, col 10)

            expect(engine.getCell(1, 10).raw).toBe('=G2*H2')
            expect(engine.getCell(1, 10).computed).toBe(50)

            // Update G2 to 20 -> K2 recalculates to 100
            engine.setCell(1, 6, '20')
            expect(engine.getCell(1, 10).computed).toBe(100)

            // Lowercase formula support: =g2+h2
            engine.setCell(2, 10, '=g2+h2')
            expect(engine.getCell(2, 10).computed).toBe(25)

            // Division and subtraction
            engine.setCell(3, 10, '=G2/H2')
            expect(engine.getCell(3, 10).computed).toBe(4) // 20 / 5 = 4
            engine.setCell(4, 10, '=G2-H2')
            expect(engine.getCell(4, 10).computed).toBe(15) // 20 - 5 = 15
        })

        it('Bug 3 regression: multi-column fill preserves seed cells and extrapolates each column according to its series type', () => {
            const engine = createEngine(20, 10)
            // Column 0: ORD-1001, ORD-1002 (text series)
            // Column 1: 10, 20 (number series)
            // Column 2: 2024-01-01, 2024-01-02 (date series)
            // Column 3: =A1+B1, =A2+B2 (formula)
            engine.setCell(0, 0, 'ORD-1001')
            engine.setCell(1, 0, 'ORD-1002')
            engine.setCell(0, 1, '10')
            engine.setCell(1, 1, '20')
            engine.setCell(0, 2, '2024-01-01')
            engine.setCell(1, 2, '2024-01-02')
            engine.setCell(0, 3, '=A1+B1')
            engine.setCell(1, 3, '=A2+B2')

            // Fill all 4 columns down to row 4 (indices 2 and 3)
            engine.fill(
                { startRow: 0, startCol: 0, endRow: 1, endCol: 3 },
                { row: 3, col: 3 }
            )

            // Verify original seeds are preserved
            expect(engine.getCell(0, 0).raw).toBe('ORD-1001')
            expect(engine.getCell(1, 0).raw).toBe('ORD-1002')
            expect(engine.getCell(0, 1).raw).toBe('10')
            expect(engine.getCell(1, 1).raw).toBe('20')

            // Verify filled rows 2 and 3
            expect(engine.getCell(2, 0).raw).toBe('ORD-1003')
            expect(engine.getCell(3, 0).raw).toBe('ORD-1004')
            expect(engine.getCell(2, 1).raw).toBe('30')
            expect(engine.getCell(3, 1).raw).toBe('40')
            expect(engine.getCell(2, 2).raw).toBe('2024-01-03')
            expect(engine.getCell(3, 2).raw).toBe('2024-01-04')
            expect(engine.getCell(2, 3).raw).toBe('=A3+B3')
            expect(engine.getCell(3, 3).raw).toBe('=A4+B4')

            // 1 undo restores all 4 columns
            engine.undo()
            expect(engine.getCell(2, 0).raw).toBe('')
            expect(engine.getCell(2, 1).raw).toBe('')
            expect(engine.getCell(2, 2).raw).toBe('')
            expect(engine.getCell(2, 3).raw).toBe('')

            // 1 redo reapplies the complete multi-column fill
            engine.redo()
            expect(engine.getCell(2, 0).raw).toBe('ORD-1003')
            expect(engine.getCell(3, 0).raw).toBe('ORD-1004')
        })

        it('Bug 1 regression: typing into empty cell vs replacing existing content, commit and cancel', () => {
            const engine = createEngine(10, 10)
            // Empty cell typing:
            engine.setCell(0, 0, '1')
            expect(engine.getCell(0, 0).raw).toBe('1')

            // Replacing existing content (cell containing 25):
            engine.setCell(1, 0, '25')
            expect(engine.getCell(1, 0).raw).toBe('25')
            // Typing '1' replaces '25'
            engine.setCell(1, 0, '1')
            expect(engine.getCell(1, 0).raw).toBe('1')

            // Undo restores '25'
            engine.undo()
            expect(engine.getCell(1, 0).raw).toBe('25')

            // Formula entry
            engine.setCell(2, 0, '=A2*2')
            expect(engine.getCell(2, 0).raw).toBe('=A2*2')
            expect(engine.getCell(2, 0).computed).toBe(50) // 25 * 2 = 50
        })
    })
})
