import { describe, it, expect } from 'vitest'
import { createEngine } from '../engine/core.js'
import { loadSampleLarge } from '../fixtures/loadSample.js'
import { executeQueryPlan } from './queryExecutor.js'
import { validateAction, extractJsonFromResponse } from './validator.js'
import queriesData from '../../fixtures/ai-eval/queries.json'

function compareCells(actual, expected) {
    if (typeof expected === 'number') {
        expect(typeof actual).toBe('number')
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01)
    } else {
        expect(String(actual).trim()).toBe(String(expected).trim())
    }
}

describe('Challenge 4: AI Ask Your Data Golden Set & Performance', () => {
    // Setup engine with sales-large.tsv once for query evaluation
    const engine = createEngine(3500, 20)
    loadSampleLarge(engine)

    describe('Response Parsing and Validator Guardrails', () => {
        it('extracts JSON wrapped in markdown code blocks and surrounding prose', () => {
            const raw1 = 'Here is the plan:\n\n```json\n{"type": "query", "columns": ["Region"]}\n```\nLet me know!'
            const res1 = extractJsonFromResponse(raw1)
            expect(res1.success).toBe(true)
            expect(res1.data.type).toBe('query')

            const raw2 = '```\n{"type": "clarify", "question": "Which column?"}\n```'
            const res2 = extractJsonFromResponse(raw2)
            expect(res2.success).toBe(true)
            expect(res2.data.question).toBe('Which column?')
        })

        it('rejects mutation action with READ_ONLY', () => {
            const mutationPlan = {
                type: 'mutation',
                action: 'deleteRows',
                filters: [{ column: 'Region', op: 'eq', value: 'East' }]
            }
            const validation = validateAction(mutationPlan)
            expect(validation.valid).toBe(false)
            expect(validation.error).toBe('READ_ONLY')

            const execRes = executeQueryPlan(engine, mutationPlan)
            expect(execRes.error).toBe('READ_ONLY')
        })

        it('rejects unknown column with UNKNOWN_COLUMN:Territory', () => {
            const plan = {
                type: 'query',
                groupBy: ['Territory'],
                aggregates: [{ fn: 'sum', column: 'Total', as: 'Total' }]
            }
            const res = executeQueryPlan(engine, plan)
            expect(res.error).toBe('UNKNOWN_COLUMN')
            expect(res.detail).toBe('UNKNOWN_COLUMN:Territory')
        })
    })

    describe('Golden set: 20 prompts in fixtures/ai-eval/queries.json', () => {
        for (const testCase of queriesData.cases) {
            it(`Case ${testCase.id}: "${testCase.prompt}"`, () => {
                const plan = testCase.plan
                const expected = testCase.expect

                // 1. Validate plan if it's an allowed action
                const validation = validateAction(plan)
                if (expected.error === 'READ_ONLY') {
                    expect(validation.valid).toBe(false)
                    expect(validation.error).toBe('READ_ONLY')
                    return
                }

                expect(validation.valid).toBe(true)

                // 2. Measure execution time
                const t0 = performance.now()
                const result = executeQueryPlan(engine, plan)
                const duration = performance.now() - t0

                // Golden plan budget: under 50 ms
                expect(duration).toBeLessThan(50)

                // 3. Verify Error or Result
                if (expected.error) {
                    expect(result.error).toBe(expected.error)
                    if (expected.detail) {
                        expect(result.detail).toBe(expected.detail)
                    }
                    return
                }

                // Verify columns
                expect(result.columns).toEqual(expected.columns)
                // Verify rowCount
                expect(result.rowCount).toBe(expected.rowCount)
                // Verify truncated
                expect(result.truncated).toBe(expected.truncated)

                // Verify rows or preview rows
                if (expected.rows) {
                    expect(result.rows.length).toBe(expected.rows.length)
                    for (let r = 0; r < expected.rows.length; r++) {
                        for (let c = 0; c < expected.rows[r].length; c++) {
                            compareCells(result.rows[r][c], expected.rows[r][c])
                        }
                    }
                } else if (expected.rowsPreview) {
                    for (let r = 0; r < expected.rowsPreview.length; r++) {
                        for (let c = 0; c < expected.rowsPreview[r].length; c++) {
                            compareCells(result.rows[r][c], expected.rowsPreview[r][c])
                        }
                    }
                }
            })
        }
    })

    describe('Performance Budget: 2-level group-by over 100,000 generated rows', () => {
        it('executes 2-level group-by over 100,000 rows in under 500 ms', () => {
            const bigEngine = createEngine(100100, 10)
            const regions = ['East', 'West', 'North', 'South', 'Central']
            const categories = ['Electronics', 'Furniture', 'Software', 'Accessories']

            // Generate 100,000 data rows
            const rowsData = []
            // Row 0 is header
            rowsData.push({ row: 0, col: 0, value: 'Region' })
            rowsData.push({ row: 0, col: 1, value: 'Category' })
            rowsData.push({ row: 0, col: 2, value: 'Total' })

            for (let r = 1; r <= 100000; r++) {
                const reg = regions[r % regions.length]
                const cat = categories[r % categories.length]
                const val = (r % 500) + 10
                rowsData.push({ row: r, col: 0, value: reg })
                rowsData.push({ row: r, col: 1, value: cat })
                rowsData.push({ row: r, col: 2, value: String(val) })
            }
            bigEngine.setCells(rowsData)

            const plan = {
                type: 'query',
                groupBy: ['Region', 'Category'],
                aggregates: [
                    { fn: 'sum', column: 'Total', as: 'SumTotal' },
                    { fn: 'avg', column: 'Total', as: 'AvgTotal' }
                ],
                sort: [
                    { column: 'SumTotal', dir: 'desc' }
                ]
            }

            const t0 = performance.now()
            const result = executeQueryPlan(bigEngine, plan)
            const duration = performance.now() - t0

            console.log(`Measured 100,000-row 2-level group-by duration: ${duration.toFixed(2)} ms`)
            expect(result.rowCount).toBe(20) // 5 regions * 4 categories = 20 groups
            expect(duration).toBeLessThan(500)
        })
    })
})
