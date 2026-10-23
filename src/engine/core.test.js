
import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'

describe('engine basics', () => {
    it('evaluates arithmetic and ranges', () => {
        const engine = createEngine(10, 10)

        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)*2')

        expect(engine.getCell(2, 0).computed).toBe(60)
    })

    it('reports a cycle instead of hanging', () => {
        const engine = createEngine(10, 10)

        engine.setCell(0, 0, '=B1')
        engine.setCell(0, 1, '=A1')

        expect(engine.getCell(0, 1).error).toBe('#CYCLE!')
    })

    it('undoes and redoes a single edit', () => {
        const engine = createEngine(10, 10)

        engine.setCell(0, 0, 'hello')
        engine.setCell(0, 0, 'world')

        engine.undo()
        expect(engine.getCell(0, 0).raw).toBe('hello')

        engine.redo()
        expect(engine.getCell(0, 0).raw).toBe('world')
    })

    it('shifts references when a row is inserted above them', () => {
        const engine = createEngine(10, 10)

        engine.setCell(2, 0, '5')
        engine.setCell(4, 0, '=A3+1')
        engine.insertRow(1)

        expect(engine.getCell(5, 0).raw).toBe('=A4+1')
        expect(engine.getCell(5, 0).computed).toBe(6)
    })

    it('updates multiple cells with one undo and redo', () => {
        const engine = createEngine(10, 10)

        engine.setCells([
            { row: 0, col: 0, value: 'Apple' },
            { row: 1, col: 0, value: 'Banana' }
        ])

        expect(engine.getCell(0, 0).raw).toBe('Apple')
        expect(engine.getCell(1, 0).raw).toBe('Banana')

        engine.undo()

        expect(engine.getCell(0, 0).raw).toBe('')
        expect(engine.getCell(1, 0).raw).toBe('')

        engine.redo()

        expect(engine.getCell(0, 0).raw).toBe('Apple')
        expect(engine.getCell(1, 0).raw).toBe('Banana')
    })
})
