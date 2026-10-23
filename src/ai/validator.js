// ─────────────────────────────────────────────────────────────
//  AI Action Validator & Response Parser
//  No external schema libraries; pure handcrafted validation
//  strictly conforming to AI_CONTRACT.md and src/ai/contract.js
// ─────────────────────────────────────────────────────────────

import {
    ACTION_TYPES,
    FILTER_OPS,
    AGGREGATE_FNS,
    NUMBER_FORMATS
} from './contract.js'

/**
 * Extracts and parses the first JSON object from a model's text response.
 * Handles markdown code fences (```json, ```) and surrounding prose.
 */
export function extractJsonFromResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { success: false, error: 'INVALID_RESPONSE', detail: 'Empty or invalid response from provider' }
    }

    let text = rawText.trim()

    // 1. Try markdown code block extraction
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
        text = codeBlockMatch[1].trim()
    }

    // 2. Locate first '{' and last '}'
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return { success: false, error: 'INVALID_RESPONSE', detail: 'No JSON object found in response' }
    }

    const candidate = text.substring(firstBrace, lastBrace + 1)
    try {
        const parsed = JSON.parse(candidate)
        return { success: true, data: parsed }
    } catch (err) {
        return { success: false, error: 'INVALID_RESPONSE', detail: `JSON parse error: ${err.message}` }
    }
}

/**
 * Validates a style object against STYLE_SCHEMA.
 */
function validateStyle(style, path = 'style') {
    if (style === null || typeof style !== 'object' || Array.isArray(style)) {
        return { valid: false, detail: `${path} must be an object` }
    }

    const allowed = new Set(['bold', 'italic', 'underline', 'bg', 'color', 'align', 'fontSize', 'numberFormat'])
    for (const key of Object.keys(style)) {
        if (!allowed.has(key)) {
            return { valid: false, detail: `Unexpected property ${key} in ${path}` }
        }
    }

    if (style.bold !== undefined && typeof style.bold !== 'boolean') {
        return { valid: false, detail: `${path}.bold must be boolean` }
    }
    if (style.italic !== undefined && typeof style.italic !== 'boolean') {
        return { valid: false, detail: `${path}.italic must be boolean` }
    }
    if (style.underline !== undefined && typeof style.underline !== 'boolean') {
        return { valid: false, detail: `${path}.underline must be boolean` }
    }

    if (style.bg !== undefined) {
        if (typeof style.bg !== 'string' || (!/^#[0-9a-fA-F]{6}$/.test(style.bg) && style.bg !== 'white')) {
            return { valid: false, detail: `${path}.bg must be #RRGGBB or 'white'` }
        }
    }

    if (style.color !== undefined) {
        if (typeof style.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(style.color)) {
            return { valid: false, detail: `${path}.color must be #RRGGBB` }
        }
    }

    if (style.align !== undefined && !['left', 'center', 'right'].includes(style.align)) {
        return { valid: false, detail: `${path}.align must be left, center, or right` }
    }

    if (style.fontSize !== undefined) {
        if (typeof style.fontSize !== 'number' || !Number.isInteger(style.fontSize) || style.fontSize < 8 || style.fontSize > 24) {
            return { valid: false, detail: `${path}.fontSize must be integer between 8 and 24` }
        }
    }

    if (style.numberFormat !== undefined && !NUMBER_FORMATS.includes(style.numberFormat)) {
        return { valid: false, detail: `${path}.numberFormat must be one of: ${NUMBER_FORMATS.join(', ')}` }
    }

    return { valid: true }
}

/**
 * Validates a parsed JSON action against AI_CONTRACT schemas.
 */
export function validateAction(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
        return { valid: false, error: 'INVALID_RESPONSE', detail: 'Action must be a JSON object' }
    }

    // Explicit rejection for non-query actions in query workflows (e.g. mutation)
    if (action.type === 'mutation') {
        return { valid: false, error: 'READ_ONLY', detail: 'Mutations not permitted in read-only analysis' }
    }

    // ── 1. Query Action ──
    if (action.type === ACTION_TYPES.QUERY) {
        const allowed = new Set(['type', 'excludeTotalsRow', 'filters', 'groupBy', 'aggregates', 'columns', 'sort', 'limit'])
        for (const key of Object.keys(action)) {
            if (!allowed.has(key)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: `Unexpected property in query action: ${key}` }
            }
        }

        if (action.excludeTotalsRow !== undefined && typeof action.excludeTotalsRow !== 'boolean') {
            return { valid: false, error: 'INVALID_RESPONSE', detail: 'excludeTotalsRow must be boolean' }
        }

        if (action.filters !== undefined) {
            if (!Array.isArray(action.filters)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'filters must be an array' }
            }
            for (let i = 0; i < action.filters.length; i++) {
                const f = action.filters[i]
                if (!f || typeof f !== 'object') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `filter[${i}] must be an object` }
                }
                const filterAllowed = new Set(['column', 'op', 'value'])
                for (const k of Object.keys(f)) {
                    if (!filterAllowed.has(k)) {
                        return { valid: false, error: 'INVALID_RESPONSE', detail: `Unexpected property ${k} in filter[${i}]` }
                    }
                }
                if (!f.column || typeof f.column !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `filter[${i}].column must be string` }
                }
                if (!f.op || !FILTER_OPS.includes(f.op)) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `filter[${i}].op must be valid op: ${FILTER_OPS.join(', ')}` }
                }
                if (f.value !== undefined && typeof f.value !== 'string' && typeof f.value !== 'number' && f.value !== null) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `filter[${i}].value must be string, number, or null` }
                }
            }
        }

        if (action.groupBy !== undefined) {
            if (!Array.isArray(action.groupBy)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'groupBy must be an array' }
            }
            for (const col of action.groupBy) {
                if (typeof col !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: 'groupBy items must be strings' }
                }
            }
        }

        if (action.aggregates !== undefined) {
            if (!Array.isArray(action.aggregates)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'aggregates must be an array' }
            }
            for (let i = 0; i < action.aggregates.length; i++) {
                const a = action.aggregates[i]
                if (!a || typeof a !== 'object') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `aggregate[${i}] must be an object` }
                }
                const aggAllowed = new Set(['fn', 'column', 'as'])
                for (const k of Object.keys(a)) {
                    if (!aggAllowed.has(k)) {
                        return { valid: false, error: 'INVALID_RESPONSE', detail: `Unexpected property ${k} in aggregate[${i}]` }
                    }
                }
                if (!a.fn || !AGGREGATE_FNS.includes(a.fn)) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `aggregate[${i}].fn must be valid fn: ${AGGREGATE_FNS.join(', ')}` }
                }
                if (!a.column || typeof a.column !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `aggregate[${i}].column must be string` }
                }
                if (a.as !== undefined && typeof a.as !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `aggregate[${i}].as must be string` }
                }
            }
        }

        if (action.columns !== undefined) {
            if (!Array.isArray(action.columns)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'columns must be an array' }
            }
            for (const col of action.columns) {
                if (typeof col !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: 'columns items must be strings' }
                }
            }
        }

        if (action.sort !== undefined) {
            if (!Array.isArray(action.sort)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'sort must be an array' }
            }
            for (let i = 0; i < action.sort.length; i++) {
                const s = action.sort[i]
                if (!s || typeof s !== 'object') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `sort[${i}] must be an object` }
                }
                if (!s.column || typeof s.column !== 'string') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `sort[${i}].column must be string` }
                }
                if (s.dir !== undefined && !['asc', 'desc'].includes(s.dir)) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `sort[${i}].dir must be asc or desc` }
                }
            }
        }

        if (action.limit !== undefined) {
            if (typeof action.limit !== 'number' || !Number.isInteger(action.limit) || action.limit < 1) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'limit must be a positive integer' }
            }
        }

        return { valid: true, action }
    }

    // ── 2. Format Sheet Action ──
    if (action.type === ACTION_TYPES.FORMAT_SHEET) {
        const allowed = new Set([
            'type', 'clearFormatting', 'headerStyle', 'bodyStyle', 'totalsStyle',
            'columns', 'freezeRows', 'columnWidths', 'autoFitColumns'
        ])
        for (const key of Object.keys(action)) {
            if (!allowed.has(key)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: `Unexpected property in format_sheet: ${key}` }
            }
        }

        if (action.clearFormatting !== undefined && typeof action.clearFormatting !== 'boolean') {
            return { valid: false, error: 'INVALID_RESPONSE', detail: 'clearFormatting must be boolean' }
        }

        for (const styleProp of ['headerStyle', 'bodyStyle', 'totalsStyle']) {
            if (action[styleProp] !== undefined) {
                const res = validateStyle(action[styleProp], styleProp)
                if (!res.valid) return { valid: false, error: 'INVALID_RESPONSE', detail: res.detail }
            }
        }

        if (action.columns !== undefined) {
            if (!Array.isArray(action.columns)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'columns must be an array' }
            }
            for (let i = 0; i < action.columns.length; i++) {
                const colItem = action.columns[i]
                if (!colItem || typeof colItem !== 'object') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `columns[${i}] must be an object` }
                }
                if (typeof colItem.col !== 'number' || !Number.isInteger(colItem.col) || colItem.col < 0) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `columns[${i}].col must be non-negative integer` }
                }
                const res = validateStyle(colItem.style, `columns[${i}].style`)
                if (!res.valid) return { valid: false, error: 'INVALID_RESPONSE', detail: res.detail }
            }
        }

        if (action.freezeRows !== undefined && action.freezeRows !== null) {
            if (typeof action.freezeRows !== 'number' || !Number.isInteger(action.freezeRows) || action.freezeRows < 0) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'freezeRows must be non-negative integer or null' }
            }
        }

        if (action.columnWidths !== undefined) {
            if (!Array.isArray(action.columnWidths)) {
                return { valid: false, error: 'INVALID_RESPONSE', detail: 'columnWidths must be an array' }
            }
            for (let i = 0; i < action.columnWidths.length; i++) {
                const cw = action.columnWidths[i]
                if (!cw || typeof cw !== 'object') {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `columnWidths[${i}] must be an object` }
                }
                if (typeof cw.col !== 'number' || !Number.isInteger(cw.col) || cw.col < 0) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `columnWidths[${i}].col must be non-negative integer` }
                }
                if (typeof cw.width !== 'number' || !Number.isInteger(cw.width) || cw.width < 30 || cw.width > 600) {
                    return { valid: false, error: 'INVALID_RESPONSE', detail: `columnWidths[${i}].width must be integer between 30 and 600` }
                }
            }
        }

        if (action.autoFitColumns !== undefined && typeof action.autoFitColumns !== 'boolean') {
            return { valid: false, error: 'INVALID_RESPONSE', detail: 'autoFitColumns must be boolean' }
        }

        return { valid: true, action }
    }

    // ── 3. Clarify Action ──
    if (action.type === ACTION_TYPES.CLARIFY) {
        if (!action.question || typeof action.question !== 'string') {
            return { valid: false, error: 'INVALID_RESPONSE', detail: 'clarify action must have a string question' }
        }
        return { valid: true, action }
    }

    return { valid: false, error: 'INVALID_RESPONSE', detail: `Unknown action type: ${action.type}` }
}
