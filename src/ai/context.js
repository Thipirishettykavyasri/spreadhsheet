// ─────────────────────────────────────────────────────────────
//  Privacy-Preserving Sheet Context Generator
//  Never sends the full dataset; sends at most 5 sample rows,
//  column headers with inferred types, selection, and row count.
// ─────────────────────────────────────────────────────────────

import { indexToColumnLetter } from '../engine/fill.js'
import { looksLikeTotalsRow } from './formatApplier.js'
import { parseDateString } from '../engine/fill.js'

/**
 * Infers column data type from sample cell values.
 * Types: 'id' | 'date' | 'percent' | 'currency' | 'number' | 'text'
 */
export function inferColumnType(values) {
    const nonEmpties = values.map(v => String(v || '').trim()).filter(v => v !== '' && v.toLowerCase() !== 'n/a')
    if (nonEmpties.length === 0) return 'text'

    // 1. ID: matches pattern like ORD-1001, ID-123
    const isId = nonEmpties.every(v => /^[A-Z]{2,}-\d+$/i.test(v))
    if (isId) return 'id'

    // 2. Percent: e.g. 10%, 0.1
    const isPercent = nonEmpties.every(v => v.endsWith('%') || (/^0?\.\d+$/.test(v) && parseFloat(v) <= 1))
    if (isPercent) return 'percent'

    // 3. Currency: starts with $
    const isCurrency = nonEmpties.every(v => /^\$\s*\d+/.test(v))
    if (isCurrency) return 'currency'

    // 4. Date: parses via parseDateString
    const isDate = nonEmpties.every(v => parseDateString(v) !== null)
    if (isDate) return 'date'

    // 5. Number: numeric digits
    const isNumber = nonEmpties.every(v => /^-?\d+(\.\d+)?$/.test(v.replace(/[$,\s]/g, '')))
    if (isNumber) return 'number'

    return 'text'
}

/**
 * Builds the sheet context payload for the AI model.
 */
export function buildSheetContext(engine, selectionRange = null) {
    const usedRange = engine.getUsedRange()
    const colCount = usedRange.endCol + 1
    const lastRow = usedRange.endRow

    const headerCols = []
    for (let c = 0; c < colCount; c++) {
        const cell = engine.getCell(0, c)
        const name = (cell?.raw || '').trim() || `${indexToColumnLetter(c)}`
        headerCols.push({ index: c, name })
    }

    const hasTotals = lastRow >= 1 && looksLikeTotalsRow(engine, lastRow, colCount)
    const dataEndRow = hasTotals ? lastRow - 1 : lastRow
    const totalDataRows = Math.max(0, dataEndRow)

    // Collect at most 5 non-empty sample rows
    const sampleRows = []
    for (let r = 1; r <= dataEndRow && sampleRows.length < 5; r++) {
        let hasContent = false
        const rowVals = []
        for (let c = 0; c < colCount; c++) {
            const raw = engine.getCell(r, c)?.raw || ''
            rowVals.push(raw)
            if (raw.trim() !== '') hasContent = true
        }
        if (hasContent) {
            sampleRows.push(rowVals)
        }
    }

    // Infer column types and gather sample examples
    const columns = headerCols.map(({ index, name }) => {
        const colSamples = sampleRows.map(r => r[index])
        const type = inferColumnType(colSamples)
        const examples = Array.from(new Set(colSamples.filter(s => s && s.trim() !== ''))).slice(0, 3)
        return {
            name,
            index,
            type,
            examples
        }
    })

    let selection = null
    if (selectionRange) {
        const r1 = Math.min(selectionRange.startRow, selectionRange.endRow)
        const r2 = Math.max(selectionRange.startRow, selectionRange.endRow)
        const c1 = Math.min(selectionRange.startCol, selectionRange.endCol)
        const c2 = Math.max(selectionRange.startCol, selectionRange.endCol)
        selection = `${indexToColumnLetter(c1)}${r1 + 1}:${indexToColumnLetter(c2)}${r2 + 1}`
    }

    const startCell = `A1`
    const endCell = `${indexToColumnLetter(usedRange.endCol)}${lastRow + 1}`

    return {
        range: `${startCell}:${endCell}`,
        rowCount: totalDataRows,
        columns,
        sampleRows,
        selection,
        hasTotalsRow: hasTotals
    }
}

export function buildSystemPrompt() {
    return [
        'You translate spreadsheet questions into ONE JSON action and nothing else.',
        'Allowed types: query, format_sheet, clarify.',
        'Never compute numbers. The engine executes query plans and applies formatting.',
        'Use column names exactly as provided in the sheet context.',
        'If a column is ambiguous or missing, return {"type":"clarify","question":"..."}.',
        'query fields: excludeTotalsRow, filters, groupBy, aggregates, columns, sort, limit.',
        'Filter ops: eq neq gt gte lt lte contains startsWith endsWith isEmpty notEmpty.',
        'Aggregate fns: sum avg count countDistinct min max.',
        'format_sheet may include clearFormatting, headerStyle, bodyStyle, totalsStyle, columns, freezeRows, columnWidths, autoFitColumns.',
        'Reply with a single JSON object. You may wrap it in a markdown code fence.',
    ].join(' ')
}

export function buildUserTurn(context, prompt) {
    return `Sheet context:\n${JSON.stringify(context, null, 2)}\n\nUser prompt:\n${prompt}`
}

export function describeQueryPlan(plan) {
    if (!plan || plan.type !== 'query') return 'Not a query plan.'
    const bits = []
    if (plan.filters?.length) {
        bits.push('filter ' + plan.filters.map(f => `${f.column} ${f.op} ${f.value ?? ''}`.trim()).join(' AND '))
    }
    if (plan.groupBy?.length) bits.push('group by ' + plan.groupBy.join(', '))
    if (plan.aggregates?.length) {
        bits.push('aggregate ' + plan.aggregates.map(a => `${a.fn}(${a.column})${a.as ? ' as ' + a.as : ''}`).join(', '))
    } else if (plan.columns?.length) {
        bits.push('columns ' + plan.columns.join(', '))
    }
    if (plan.sort?.length) bits.push('sort ' + plan.sort.map(s => `${s.column} ${s.dir || 'asc'}`).join(', '))
    if (plan.limit) bits.push('limit ' + plan.limit)
    if (plan.excludeTotalsRow === false) bits.push('include totals row')
    return bits.length ? bits.join('; ') : 'Return matching rows.'
}

export function describeFormatAction(action) {
    if (!action || action.type !== 'format_sheet') return 'Not a formatting action.'
    const bits = []
    if (action.clearFormatting) bits.push('clear existing formatting')
    if (action.headerStyle) bits.push('header: ' + summarizeStyle(action.headerStyle))
    if (action.bodyStyle) bits.push('body: ' + summarizeStyle(action.bodyStyle))
    if (action.columns?.length) {
        bits.push(action.columns.length + ' columns: ' + action.columns.map(c => summarizeStyle(c.style)).join('; '))
    }
    if (action.totalsStyle) bits.push('totals row: ' + summarizeStyle(action.totalsStyle))
    if (action.freezeRows === 0) bits.push('unfreeze rows')
    else if (typeof action.freezeRows === 'number') bits.push('freeze ' + action.freezeRows + ' row' + (action.freezeRows === 1 ? '' : 's'))
    if (action.autoFitColumns) bits.push('auto-fit columns')
    if (action.columnWidths?.length) bits.push('set column widths')
    return bits.length ? bits.join('; ') : 'No formatting changes.'
}

function summarizeStyle(style) {
    if (!style) return ''
    const parts = []
    if (style.bold) parts.push('bold')
    if (style.italic) parts.push('italic')
    if (style.underline) parts.push('underline')
    if (style.bg) parts.push(style.bg === '#f0f0f0' ? 'grey' : style.bg)
    if (style.color) parts.push('color ' + style.color)
    if (style.align) parts.push(style.align)
    if (style.fontSize) parts.push('size ' + style.fontSize)
    if (style.numberFormat && style.numberFormat !== 'general') parts.push(style.numberFormat)
    return parts.join(', ') || 'style'
}
