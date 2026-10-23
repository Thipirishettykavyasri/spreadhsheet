import { computeFillChanges, indexToColumnLetter, shiftFormula } from './fill.js'
import { executeSort, parseNumberValue } from './sortFilter.js'

// ─────────────────────────────────────────────────────────────
//  Operator precedence for expression parsing
// ─────────────────────────────────────────────────────────────

const OPERATOR_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 }
const MAX_UNDO_HISTORY = 100

// ─────────────────────────────────────────────────────────────
//  Column / Cell coordinate utilities
// ─────────────────────────────────────────────────────────────

function columnLetterToIndex(columnLetter) {
    let index = 0
    for (let i = 0; i < columnLetter.length; i++) {
        index = index * 26 + (columnLetter.charCodeAt(i) - 64)
    }
    return index - 1
}

function indexToCellKey(row, col) {
    return indexToColumnLetter(col) + (row + 1)
}

function parseCellKey(cellKey) {
    if (!cellKey || typeof cellKey !== 'string') return null
    const match = cellKey.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/)
    if (!match) return null
    return { row: parseInt(match[4], 10) - 1, col: columnLetterToIndex(match[2].toUpperCase()) }
}

// ─────────────────────────────────────────────────────────────
//  Dependency graph (tracks which cells depend on which)
// ─────────────────────────────────────────────────────────────

function createDependencyGraph() {
    const forwardEdges = new Map()
    const reverseEdges = new Map()

    function addDependency(cell, dependsOn) {
        if (!forwardEdges.has(cell)) forwardEdges.set(cell, new Set())
        if (!reverseEdges.has(dependsOn)) reverseEdges.set(dependsOn, new Set())
        forwardEdges.get(cell).add(dependsOn)
        reverseEdges.get(dependsOn).add(cell)
    }

    // Remove only outgoing edges (what `cell` depends on). Incoming edges
    // (who depends on `cell`) must stay so dependents still recalculate.
    function removeAllDependencies(cell) {
        const deps = forwardEdges.get(cell)
        if (deps) {
            for (const dep of deps) {
                if (reverseEdges.has(dep)) {
                    reverseEdges.get(dep).delete(cell)
                    if (reverseEdges.get(dep).size === 0) reverseEdges.delete(dep)
                }
            }
            forwardEdges.delete(cell)
        }
    }

    function getDependencies(cell) {
        return forwardEdges.get(cell) || new Set()
    }

    function getDependents(cell) {
        return reverseEdges.get(cell) || new Set()
    }

    function hasDependents(cell) {
        const deps = reverseEdges.get(cell)
        return deps !== undefined && deps.size > 0
    }

    function hasDependencies(cell) {
        const deps = forwardEdges.get(cell)
        return deps !== undefined && deps.size > 0
    }

    function isEmpty() {
        return forwardEdges.size === 0 && reverseEdges.size === 0
    }

    function getAllDependentsRecursive(cell, visited = new Set()) {
        if (visited.has(cell)) return new Set()
        visited.add(cell)
        const result = new Set()
        const dependents = reverseEdges.get(cell)
        if (dependents && dependents.size > 0) {
            for (const dependent of dependents) {
                result.add(dependent)
                for (const indirect of getAllDependentsRecursive(dependent, visited)) {
                    result.add(indirect)
                }
            }
        }
        return result
    }

    function hasCycle(startCell) {
        const visited = new Set()
        const recursionStack = new Set()
        const dfs = (node) => {
            if (recursionStack.has(node)) return true
            if (visited.has(node)) return false
            visited.add(node)
            recursionStack.add(node)
            for (const dep of getDependencies(node)) {
                if (dfs(dep)) return true
            }
            recursionStack.delete(node)
            return false
        }
        return dfs(startCell)
    }

    function topologicalSort(affectedCells) {
        const inDegree = new Map()
        const queue = []
        const sorted = []

        for (const cell of affectedCells) inDegree.set(cell, 0)
        for (const cell of affectedCells) {
            for (const dep of getDependencies(cell)) {
                if (affectedCells.has(dep)) {
                    inDegree.set(cell, (inDegree.get(cell) || 0) + 1)
                }
            }
        }
        for (const cell of affectedCells) {
            if (inDegree.get(cell) === 0) queue.push(cell)
        }
        let head = 0
        while (head < queue.length) {
            const cell = queue[head++]
            sorted.push(cell)
            const dependents = reverseEdges.get(cell)
            if (dependents) {
                for (const dependent of dependents) {
                    if (affectedCells.has(dependent)) {
                        inDegree.set(dependent, inDegree.get(dependent) - 1)
                        if (inDegree.get(dependent) === 0) queue.push(dependent)
                    }
                }
            }
        }
        return sorted
    }

    function clear() {
        forwardEdges.clear()
        reverseEdges.clear()
    }

    return {
        addDependency,
        removeOutgoingDependencies: removeAllDependencies,
        removeAllDependencies,
        getDependencies,
        getDependents,
        hasDependents,
        hasDependencies,
        isEmpty,
        getAllDependentsRecursive,
        hasCycle,
        topologicalSort,
        clear
    }
}

// ─────────────────────────────────────────────────────────────
//  Tokenizer — converts formula string into tokens
// ─────────────────────────────────────────────────────────────

function tokenize(expression) {
    const tokens = []
    let position = 0

    while (position < expression.length) {
        const char = expression[position]

        if (char === ' ') {
            position++
            continue
        }

        if (char === '(' || char === ')') {
            tokens.push({ type: 'paren', value: char })
            position++
            continue
        }

        if ('+-*/,'.includes(char)) {
            tokens.push({ type: 'operator', value: char })
            position++
            continue
        }

        if (char === ':') {
            tokens.push({ type: 'range', value: ':' })
            position++
            continue
        }

        if ((char >= '0' && char <= '9') || char === '.') {
            let numberStr = ''
            while (position < expression.length && ((expression[position] >= '0' && expression[position] <= '9') || expression[position] === '.')) {
                numberStr += expression[position]
                position++
            }
            tokens.push({ type: 'number', value: parseFloat(numberStr) })
            continue
        }

        if (char === '$' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) {
            let identifier = ''
            while (position < expression.length && (
                expression[position] === '$' ||
                (expression[position] >= 'A' && expression[position] <= 'Z') ||
                (expression[position] >= 'a' && expression[position] <= 'z') ||
                (expression[position] >= '0' && expression[position] <= '9')
            )) {
                identifier += expression[position].toUpperCase()
                position++
            }
            if (position < expression.length && expression[position] === ':') {
                tokens.push({ type: 'cell', value: identifier })
            } else {
                const cellMatch = identifier.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/)
                if (cellMatch) {
                    tokens.push({ type: 'cell', value: identifier })
                } else if (!identifier.includes('$')) {
                    tokens.push({ type: 'function', value: identifier })
                } else {
                    throw new Error(`Unexpected character: $`)
                }
            }
            continue
        }

        throw new Error(`Unexpected character: ${char}`)
    }

    return tokens
}

// ─────────────────────────────────────────────────────────────
//  Parser — converts tokens into an AST using shunting-yard
// ─────────────────────────────────────────────────────────────

function parseTokensToAST(tokens) {
    const outputQueue = []
    const operatorStack = []
    let position = 0

    while (position < tokens.length) {
        const token = tokens[position]

        if (token.type === 'number' || token.type === 'cell') {
            outputQueue.push(token)
            position++
        } else if (token.type === 'function') {
            operatorStack.push(token)
            position++
        } else if (token.type === 'operator') {
            while (
                operatorStack.length > 0 &&
                operatorStack[operatorStack.length - 1].type === 'operator' &&
                OPERATOR_PRECEDENCE[operatorStack[operatorStack.length - 1].value] >= OPERATOR_PRECEDENCE[token.value]
            ) {
                outputQueue.push(operatorStack.pop())
            }
            operatorStack.push(token)
            position++
        } else if (token.type === 'paren' && token.value === '(') {
            operatorStack.push(token)
            position++
        } else if (token.type === 'paren' && token.value === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].value !== '(') {
                outputQueue.push(operatorStack.pop())
            }
            if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].value === '(') {
                operatorStack.pop()
            }
            if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].type === 'function') {
                const funcToken = operatorStack.pop()
                if (outputQueue.length > 0 && outputQueue[outputQueue.length - 1].type === 'range') {
                    const rangeToken = outputQueue.pop()
                    outputQueue.push({ type: 'function', name: funcToken.value, range: rangeToken })
                } else {
                    outputQueue.push(funcToken)
                }
            }
            position++
        } else if (token.type === 'range') {
            const endCell = tokens[position + 1]

            if (outputQueue.length < 1 || !endCell || endCell.type !== 'cell') {
                throw new Error('Invalid range syntax')
            }

            const startCell = outputQueue.pop()

            if (startCell.type !== 'cell') {
                throw new Error('Range must be between two cell references')
            }

            outputQueue.push({
                type: 'range',
                start: startCell.value,
                end: endCell.value
            })

            position += 2
        } else {
            position++
        }
    }

    while (operatorStack.length > 0) {
        if (operatorStack[operatorStack.length - 1].value === '(') {
            throw new Error('Mismatched parentheses')
        }
        outputQueue.push(operatorStack.pop())
    }

    return buildASTFromRPN(outputQueue)
}

function buildASTFromRPN(rpnTokens) {
    const stack = []

    for (const token of rpnTokens) {
        if (token.type === 'number' || token.type === 'cell' || token.type === 'range') {
            stack.push(token)
        } else if (token.type === 'operator') {
            if (stack.length < 2) throw new Error('Invalid expression')
            const right = stack.pop()
            const left = stack.pop()
            stack.push({ type: 'binary', operator: token.value, left, right })
        } else if (token.type === 'function') {
            if (token.range) {
                stack.push(token)
            } else {
                if (stack.length === 0) throw new Error(`Function ${token.value} requires arguments`)
                const argument = stack.pop()
                if (argument.type === 'range') {
                    stack.push({ type: 'function', name: token.value, range: argument })
                } else {
                    throw new Error(`Function ${token.value} requires a range`)
                }
            }
        }
    }

    if (stack.length !== 1) throw new Error('Invalid expression')
    return stack[0]
}

// ─────────────────────────────────────────────────────────────
//  Evaluator — walks the AST and computes values
// ─────────────────────────────────────────────────────────────

function expandCellRange(startKey, endKey) {
    const startMatch = startKey.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/)
    const endMatch = endKey.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/)
    if (!startMatch || !endMatch) throw new Error('REF')

    const startCol = columnLetterToIndex(startMatch[2])
    const startRow = parseInt(startMatch[4], 10) - 1
    const endCol = columnLetterToIndex(endMatch[2])
    const endRow = parseInt(endMatch[4], 10) - 1

    const cells = []
    for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
        for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
            cells.push(indexToCellKey(r, c))
        }
    }
    return cells
}

function coerceNumber(v) {
    if (typeof v === 'number') return v
    if (v === '' || v == null) return 0
    if (typeof v === 'string') {
        const s = v.trim()
        if (s.toLowerCase() === 'n/a') return NaN
        const hasPercent = s.endsWith('%')
        const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '')
        if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
            const num = parseFloat(cleaned)
            return hasPercent ? num / 100 : num
        }
    }
    return Number(v)
}

function evaluateAST(ast, getCellValue, visited = new Set()) {
    if (!ast) return 0

    if (ast.type === 'number') return ast.value

    if (ast.type === 'cell') {
        const key = ast.value.toUpperCase().replace(/\$/g, '')
        if (visited.has(key)) throw new Error('CIRCULAR')
        visited.add(key)
        const value = getCellValue(key, visited)
        visited.delete(key)
        return value
    }

    if (ast.type === 'range') throw new Error('VALUE')

    if (ast.type === 'binary') {
        const leftVal = evaluateAST(ast.left, getCellValue, visited)
        const rightVal = evaluateAST(ast.right, getCellValue, visited)
        const numLeft = coerceNumber(leftVal)
        const numRight = coerceNumber(rightVal)
        if (isNaN(numLeft) || isNaN(numRight)) throw new Error('VALUE')
        switch (ast.operator) {
            case '+': return numLeft + numRight
            case '-': return numLeft - numRight
            case '*': return numLeft * numRight
            case '/':
                if (numRight === 0) throw new Error('VALUE')
                return numLeft / numRight
            default: throw new Error('VALUE')
        }
    }

    if (ast.type === 'function') {
        const rangeCells = expandCellRange(ast.range.start, ast.range.end)
        const values = rangeCells.map(cellKey => {
            if (visited.has(cellKey)) throw new Error('CIRCULAR')
            visited.add(cellKey)
            const value = getCellValue(cellKey, visited)
            visited.delete(cellKey)
            const num = coerceNumber(value)
            return isNaN(num) ? 0 : num
        })

        switch (ast.name) {
            case 'SUM': return values.reduce((sum, val) => sum + val, 0)
            case 'AVG': return values.length === 0 ? 0 : values.reduce((sum, val) => sum + val, 0) / values.length
            case 'MIN': return values.length === 0 ? 0 : Math.min(...values)
            case 'MAX': return values.length === 0 ? 0 : Math.max(...values)
            default: throw new Error('VALUE')
        }
    }

    throw new Error('VALUE')
}

function evaluateFormula(expression, getCellValue) {
    try {
        if (!expression || expression.trim() === '') return { value: '', error: null }
        if (!expression.startsWith('=')) return { value: expression, error: null }

        const formulaBody = expression.slice(1).trim()
        if (formulaBody === '') return { value: '', error: null }

        const tokens = tokenize(formulaBody)
        const ast = parseTokensToAST(tokens)
        const result = evaluateAST(ast, getCellValue)

        return { value: result, error: null }
    } catch (error) {
        if (error.message === 'CIRCULAR') return { value: null, error: '#CYCLE!' }
        if (error.message === 'REF') return { value: null, error: '#REF!' }
        if (error.message === 'VALUE') return { value: null, error: '#VALUE!' }

        return { value: null, error: '#PARSE!' }
    }
}

// ─────────────────────────────────────────────────────────────
//  Reference shifting (for insert/delete row/col)
// ─────────────────────────────────────────────────────────────

function shiftCellReferences(formula, rowShift, colShift, atIndex, isColumnOperation = false) {
    if (!formula || !formula.startsWith('=')) return formula

    return formula.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (match, colPin, colLetter, rowPin, rowStr) => {
        const colIdx = columnLetterToIndex(colLetter.toUpperCase())
        const rowIdx = parseInt(rowStr, 10) - 1
        let newRow = rowIdx
        let newCol = colIdx

        if (isColumnOperation) {
            if (colIdx >= atIndex) newCol = colIdx + colShift
        } else {
            if (rowIdx >= atIndex) newRow = rowIdx + rowShift
        }

        if (newRow < 0 || newCol < 0) return match
        return `${colPin}${indexToColumnLetter(newCol)}${rowPin}${newRow + 1}`
    })
}

function extractCellReferences(formula) {
    const references = new Set()
    const regex = /(\$?)([A-Za-z]+)(\$?)(\d+)/g
    let match
    while ((match = regex.exec(formula)) !== null) {
        references.add(match[2].toUpperCase() + match[4])
    }
    return references
}

// ─────────────────────────────────────────────────────────────
//  Main engine factory
// ─────────────────────────────────────────────────────────────

const COORD_STRIDE = 4096

function stylesEqual(a, b) {
    if (a === b) return true
    if (!a || !b) return !a && !b
    if (a.bold !== b.bold) return false
    if (a.italic !== b.italic) return false
    if (a.underline !== b.underline) return false
    if (a.bg !== b.bg) return false
    if (a.color !== b.color) return false
    if (a.align !== b.align) return false
    if (a.fontSize !== b.fontSize) return false
    if (a.numberFormat !== b.numberFormat) return false
    return true
}

export function createEngine(initialRows = 50, initialCols = 50) {
    let rows = initialRows
    let cols = initialCols
    const cells = new Map()
    const cellsByIndex = new Map()
    const graph = createDependencyGraph()
    const dirtyCells = new Set()
    const computedCache = new Map()
    const undoStack = []
    const redoStack = []

    let _generation = 0
    let _batchMode = false
    let _batchCallbacks = []
    let usedMaxRow = -1
    let usedMaxCol = -1
    let usedRangeDirty = false

    // ── Internal helpers ──

    function cellKey(row, col) {
        return indexToCellKey(row, col)
    }

    function coordIndex(row, col) {
        return row * COORD_STRIDE + col
    }

    function cellCoords(key) {
        return parseCellKey(key)
    }

    function noteOccupied(row, col) {
        if (row > usedMaxRow) usedMaxRow = row
        if (col > usedMaxCol) usedMaxCol = col
    }

    function rebuildUsedRange() {
        usedMaxRow = -1
        usedMaxCol = -1
        for (const [idx, cell] of cellsByIndex.entries()) {
            if (cell && (cell.raw !== '' || cell.style)) {
                const row = (idx / COORD_STRIDE) | 0
                const col = idx - row * COORD_STRIDE
                if (row > usedMaxRow) usedMaxRow = row
                if (col > usedMaxCol) usedMaxCol = col
            }
        }
        usedRangeDirty = false
    }

    function rebuildIndexFromCells() {
        cellsByIndex.clear()
        for (const [key, value] of cells.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            cellsByIndex.set(coordIndex(coords.row, coords.col), value)
        }
        rebuildUsedRange()
    }

    function isValidCellKey(key) {
        const coords = cellCoords(key)
        return coords && coords.row >= 0 && coords.row < rows && coords.col >= 0 && coords.col < cols
    }

    function updateDependencies(cell, rawFormula) {
        for (const ref of extractCellReferences(rawFormula)) {
            if (isValidCellKey(ref)) graph.addDependency(cell, ref)
        }
    }

    function markCellDirty(cell) {
        dirtyCells.add(cell)
        if (graph.hasDependents(cell)) {
            for (const dependent of graph.getAllDependentsRecursive(cell)) {
                dirtyCells.add(dependent)
            }
        }
    }

    function markAllCellsDirty() {
        for (const key of cells.keys()) dirtyCells.add(key)
    }

    // ── Value resolution ──

    function resolveCellValue(cellKey, visited = new Set()) {
        if (visited.has(cellKey)) return '#CYCLE!'
        visited.add(cellKey)

        if (computedCache.has(cellKey)) {
            const cached = computedCache.get(cellKey)
            if (cached._gen === _generation && !dirtyCells.has(cellKey)) {
                visited.delete(cellKey)
                return cached.error || cached.computed
            }
            computedCache.delete(cellKey)
        }

        const cell = cells.get(cellKey)
        if (!cell || !cell.raw) {
            visited.delete(cellKey)
            return ''
        }

        if (!cell.raw.startsWith('=')) {
            const numericValue = parseNumberValue(cell.raw)
            visited.delete(cellKey)
            return numericValue !== null ? numericValue : cell.raw
        }

        const result = evaluateFormula(cell.raw, (key) => resolveCellValue(key, visited))
        visited.delete(cellKey)

        if (result.error) {
            computedCache.set(cellKey, { computed: null, error: result.error, _gen: _generation })
            return result.error
        }

        computedCache.set(cellKey, { computed: result.value, error: null, _gen: _generation })
        return result.value
    }

    // ── Recalculation ──

    function recalculate() {
        if (dirtyCells.size === 0) return

        if (graph.isEmpty()) {
            let hasFormula = false
            for (const cell of dirtyCells) {
                const c = cells.get(cell)
                if (c && c.raw && c.raw.startsWith('=')) {
                    hasFormula = true
                    break
                }
            }
            if (!hasFormula) {
                dirtyCells.clear()
                if (_batchMode) {
                    _batchCallbacks.forEach(cb => cb())
                }
                return
            }
        }

        const affected = new Set()
        for (const cell of dirtyCells) {
            const c = cells.get(cell)
            if ((c && c.raw && c.raw.startsWith('=')) || graph.hasDependents(cell)) {
                affected.add(cell)
            }
        }

        if (affected.size === 0) {
            dirtyCells.clear()
            if (_batchMode) {
                _batchCallbacks.forEach(cb => cb())
            }
            return
        }

        const sorted = graph.topologicalSort(affected)

        for (const cell of sorted) {
            computedCache.delete(cell)
            resolveCellValue(cell)
        }

        if (sorted.length < affected.size) {
            const sortedSet = new Set(sorted)
            for (const cell of affected) {
                if (!sortedSet.has(cell)) {
                    computedCache.delete(cell)
                    resolveCellValue(cell)
                }
            }
        }

        dirtyCells.clear()

        if (_batchMode) {
            _batchCallbacks.forEach(cb => cb())
        }
    }

    // ── Core cell operations ──

    function setCellRaw(row, col, raw, style) {
        const key = cellKey(row, col)
        if (graph.hasDependencies(key) || graph.hasDependents(key)) {
            graph.removeAllDependencies(key)
        }
        if (computedCache.size > 0) {
            computedCache.delete(key)
        }

        const styleObj = style ? { ...style } : undefined
        const idx = coordIndex(row, col)

        if ((!raw || raw.trim() === '') && !styleObj) {
            if (cells.has(key)) {
                cells.delete(key)
                cellsByIndex.delete(idx)
                usedRangeDirty = true
            }
            markCellDirty(key)
            return
        }

        let record
        if (raw && raw.startsWith('=')) {
            record = { raw, computed: null, error: null, style: styleObj }
            cells.set(key, record)
            cellsByIndex.set(idx, record)
            noteOccupied(row, col)
            updateDependencies(key, raw)
            if (graph.hasCycle(key)) {
                graph.removeAllDependencies(key)
                record = { raw, computed: null, error: '#CYCLE!', style: styleObj }
                cells.set(key, record)
                cellsByIndex.set(idx, record)
                markCellDirty(key)
                return
            }
        } else {
            record = { raw: raw || '', computed: null, error: null, style: styleObj }
            cells.set(key, record)
            cellsByIndex.set(idx, record)
            noteOccupied(row, col)
        }

        markCellDirty(key)
    }

    function getCellRaw(row, col) {
        const key = cellKey(row, col)
        const cell = cells.get(key)
        if (!cell) return { raw: '', computed: null, error: null, style: undefined }
        return { ...cell }
    }

    // ── Snapshot / Restore ──

    function takeSnapshot() {
        const snapshot = new Map()
        for (const [key, value] of cells.entries()) {
            snapshot.set(key, {
                ...value,
                style: value.style ? { ...value.style } : undefined
            })
        }
        return snapshot
    }

    function restoreSnapshot(snapshot) {
        cells.clear()
        for (const [key, value] of snapshot.entries()) {
            cells.set(key, {
                ...value,
                style: value.style ? { ...value.style } : undefined
            })
        }
        rebuildIndexFromCells()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Row / Column structural operations ──

    function performInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row >= atIndex) {
                const newKey = cellKey(coords.row + 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            }
        }
        rows++
        rebuildIndexFromCells()
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row === atIndex) continue
            if (coords.row > atIndex) {
                const newKey = cellKey(coords.row - 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            }
        }
        rows--
        rebuildIndexFromCells()
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col >= atIndex) {
                const newKey = cellKey(coords.row, coords.col + 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            }
        }
        cols++
        rebuildIndexFromCells()
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col === atIndex) continue
            if (coords.col > atIndex) {
                const newKey = cellKey(coords.row, coords.col - 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            }
        }
        cols--
        rebuildIndexFromCells()
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Undo / Redo ──

    function pushToUndoStack(entry) {
        undoStack.push({ ...entry, _gen: _generation })
        if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift()
        redoStack.length = 0
    }

    function executeSetCell(row, col, value, style) {
        const key = cellKey(row, col)
        const current = cells.get(key)
        const previousValue = current ? current.raw : ''
        const previousStyle = current ? current.style : undefined
        const nextStyle = style !== undefined ? (style ? { ...style } : undefined) : previousStyle

        const valChanged = previousValue !== value
        const styleChanged = !stylesEqual(previousStyle, nextStyle)

        if (valChanged || styleChanged) {
            pushToUndoStack({
                type: 'set',
                r: row,
                c: col,
                oldVal: previousValue,
                newVal: value,
                oldStyle: previousStyle ? { ...previousStyle } : undefined,
                newStyle: nextStyle ? { ...nextStyle } : undefined
            })
        }

        setCellRaw(row, col, value, nextStyle)
        _generation++
        recalculate()
    }

    function executeSetCells(changes) {
        const previous = []

        for (const change of changes) {
            const key = cellKey(change.row, change.col)
            const currentCell = cells.get(key)
            const oldVal = currentCell ? currentCell.raw : ''
            const oldStyle = currentCell ? currentCell.style : undefined
            const newVal = change.value !== undefined ? change.value : oldVal
            const newStyle = change.style !== undefined ? change.style : oldStyle

            const valChanged = oldVal !== newVal
            const styleChanged = !stylesEqual(oldStyle, newStyle)

            if (valChanged || styleChanged) {
                previous.push({
                    r: change.row,
                    c: change.col,
                    oldVal,
                    newVal,
                    oldStyle: oldStyle ? { ...oldStyle } : undefined,
                    newStyle: newStyle ? { ...newStyle } : undefined
                })
            }
        }

        if (previous.length === 0) return false

        pushToUndoStack({
            type: 'bulkSet',
            changes: previous
        })

        for (const change of previous) {
            setCellRaw(change.r, change.c, change.newVal, change.newStyle)
        }

        _generation++
        recalculate()
        return true
    }

    function executeFill(sourceRange, targetRange, getCellStyle) {
        if (!sourceRange || !targetRange) return false
        const targetRow = targetRange.endRow !== undefined ? targetRange.endRow : targetRange.row
        const targetCol = targetRange.endCol !== undefined ? targetRange.endCol : targetRange.col
        const maxRow = Math.max(sourceRange.startRow, sourceRange.endRow, targetRow ?? 0)
        const maxCol = Math.max(sourceRange.startCol, sourceRange.endCol, targetCol ?? 0)
        if (maxRow >= rows || maxCol >= cols) {
            ensureCapacity(maxRow + 1, maxCol + 1)
        }
        const changes = computeFillChanges(getCellForDisplay, sourceRange, targetRange, getCellStyle)
        if (changes.length === 0) return false

        // For fill, we must always record old values for ALL target cells in the undo
        // entry, even when the new value matches the old. This ensures undo can
        // correctly restore cells that happened to already contain the same value
        // as the generated fill series.
        const previous = []
        for (const change of changes) {
            const key = cellKey(change.row, change.col)
            const currentCell = cells.get(key)
            const oldVal = currentCell ? currentCell.raw : ''
            const oldStyle = currentCell ? currentCell.style : undefined
            const newVal = change.value !== undefined ? change.value : oldVal
            const newStyle = change.style !== undefined ? change.style : oldStyle
            previous.push({
                r: change.row,
                c: change.col,
                oldVal,
                newVal,
                oldStyle: oldStyle ? { ...oldStyle } : undefined,
                newStyle: newStyle ? { ...newStyle } : undefined
            })
        }

        pushToUndoStack({ type: 'bulkSet', changes: previous })

        for (const change of previous) {
            setCellRaw(change.r, change.c, change.newVal, change.newStyle)
        }

        _generation++
        recalculate()
        return true
    }

    function executeInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowins', snap: snapshot, oldRows: previousRows })
        performInsertRow(atIndex)
        recalculate()
    }

    function executeDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowdel', snap: snapshot, oldRows: previousRows })
        performDeleteRow(atIndex)
        recalculate()
    }

    function executeInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'colins', snap: snapshot, oldCols: previousCols })
        performInsertColumn(atIndex)
        recalculate()
    }

    function executeDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'coldel', snap: snapshot, oldCols: previousCols })
        performDeleteColumn(atIndex)
        recalculate()
    }

    function undo() {
        if (undoStack.length === 0) return false
        const entry = undoStack.pop()

        if (entry.type === 'meta' || entry.type === 'layout') {
            redoStack.push(entry)
            return entry
        }

        if (entry.type === 'bulkSet') {
            redoStack.push(entry)

            for (const change of entry.changes) {
                setCellRaw(change.r, change.c, change.oldVal, change.oldStyle)
            }

            _generation++
            recalculate()
            return entry
        }

        if (entry.type === 'set') {
            const currentCell = getCellRaw(entry.r, entry.c)
            redoStack.push({ ...entry, newVal: currentCell.raw, newStyle: currentCell.style })
            setCellRaw(entry.r, entry.c, entry.oldVal, entry.oldStyle)
            _generation++
            recalculate()
        } else {
            redoStack.push({
                ...entry,
                restoreSnap: takeSnapshot(),
                restoreRows: rows,
                restoreCols: cols
            })
            restoreSnapshot(entry.snap)
            if (entry.type === 'rowins' || entry.type === 'rowdel') rows = entry.oldRows
            else if (entry.type === 'colins' || entry.type === 'coldel') cols = entry.oldCols
            recalculate()
        }
        return entry
    }

    function redo() {
        if (redoStack.length === 0) return false
        const entry = redoStack.pop()

        if (entry.type === 'meta' || entry.type === 'layout') {
            undoStack.push(entry)
            return entry
        }

        if (entry.type === 'bulkSet') {
            undoStack.push(entry)

            for (const change of entry.changes) {
                setCellRaw(change.r, change.c, change.newVal, change.newStyle)
            }

            _generation++
            recalculate()
            return entry
        }

        if (entry.type === 'set') {
            const currentCell = getCellRaw(entry.r, entry.c)
            undoStack.push({ ...entry, oldVal: currentCell.raw, oldStyle: currentCell.style })
            setCellRaw(entry.r, entry.c, entry.newVal, entry.newStyle)
            _generation++
            recalculate()
        } else {
            undoStack.push({
                ...entry,
                snap: takeSnapshot(),
                oldRows: rows,
                oldCols: cols
            })
            restoreSnapshot(entry.restoreSnap)
            rows = entry.restoreRows
            cols = entry.restoreCols
            recalculate()
        }
        return entry
    }

    function getUsedRange() {
        if (usedRangeDirty) rebuildUsedRange()

        if (usedMaxRow === -1) {
            return { startRow: 0, startCol: 0, endRow: rows - 1, endCol: cols - 1 }
        }

        return {
            startRow: 0,
            startCol: 0,
            endRow: usedMaxRow,
            endCol: usedMaxCol
        }
    }

    function clearRange(range) {
        if (!range) return false
        const r1 = Math.min(range.startRow, range.endRow)
        const r2 = Math.max(range.startRow, range.endRow)
        const c1 = Math.min(range.startCol, range.endCol)
        const c2 = Math.max(range.startCol, range.endCol)

        const changes = []
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                const cur = getCellRaw(r, c)
                if (cur.raw !== '' || cur.style) {
                    changes.push({ row: r, col: c, value: '', style: undefined })
                }
            }
        }
        if (changes.length === 0) return false
        return executeSetCells(changes)
    }

    function setRangeStyle(range, styleUpdates) {
        if (!range || !styleUpdates) return false
        const r1 = Math.min(range.startRow, range.endRow)
        const r2 = Math.max(range.startRow, range.endRow)
        const c1 = Math.min(range.startCol, range.endCol)
        const c2 = Math.max(range.startCol, range.endCol)

        const changes = []
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                const cur = getCellRaw(r, c)
                const existingStyle = cur.style || {}
                const newStyle = { ...existingStyle, ...styleUpdates }
                changes.push({ row: r, col: c, value: cur.raw, style: newStyle })
            }
        }
        if (changes.length === 0) return false
        return executeSetCells(changes)
    }

    // ── Public cell display (returns raw + computed + error + style) ──

    function getCellForDisplay(row, col) {
        const cell = getCellRaw(row, col)
        const key = cellKey(row, col)
        const value = resolveCellValue(key)

        if (typeof value === 'string' && value.startsWith('#')) {
            return { raw: cell.raw, computed: null, error: value, style: cell.style }
        }
        return { raw: cell.raw, computed: value, error: null, style: cell.style }
    }

    function getCellFast(row, col) {
        const cell = cellsByIndex.get(coordIndex(row, col))
        if (!cell || !cell.raw) return ''
        if (cell.raw.charCodeAt(0) !== 61) return cell.raw
        if (cell.computed !== null && cell.computed !== undefined && cell.computed !== '') return cell.computed
        return resolveCellValue(cellKey(row, col))
    }

    // ── Public API ──

    let _rowIdentities = new Map()

    function sort(col, direction = 'asc', options = {}) {
        const result = executeSort(
            {
                get cols() { return cols },
                getCell: getCellForDisplay,
                getCellRaw,
                getUsedRange,
                setCells: executeSetCells
            },
            {
                col,
                direction,
                rowIdentities: _rowIdentities,
                ...options
            }
        )
        if (result.rowIdentities) {
            _rowIdentities = result.rowIdentities
        }
        return result.success
    }

    function ensureCapacity(minRows, minCols) {
        if (minRows > rows) rows = minRows
        if (minCols > cols) cols = minCols
    }

    return {
        get rows() { return rows },
        get cols() { return cols },
        getCell: getCellForDisplay,
        getCellFast,
        getCellRaw,
        setCell: executeSetCell,
        setCells: executeSetCells,
        fill: executeFill,
        sort,
        clearRange,
        setRangeStyle,
        getUsedRange,
        shiftFormula,
        insertRow: executeInsertRow,
        deleteRow: executeDeleteRow,
        insertColumn: executeInsertColumn,
        deleteColumn: executeDeleteColumn,
        undo,
        redo,
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        getUndoSize: () => undoStack.length,
        ensureCapacity,
        recordUndo: (entry) => {
            pushToUndoStack(entry || { type: 'meta' })
        },
        annotateLastUndo: (fields) => {
            if (undoStack.length === 0 || !fields) return
            Object.assign(undoStack[undoStack.length - 1], fields)
        },
        peekUndo: () => undoStack.length ? undoStack[undoStack.length - 1] : null,
        peekRedo: () => redoStack.length ? redoStack[redoStack.length - 1] : null,
    }
}
