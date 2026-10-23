// ─────────────────────────────────────────────────────────────
//  Fill Handle Logic (Pure engine module)
//  Handles series extrapolation:
//   - Numeric series (1 seed -> copy, 2+ seeds -> arithmetic progression)
//   - Text ending in numbers (Item 1, Q4, ORD-1001, preserving zero padding)
//   - Dates (ISO, US, D MMM YYYY, stepping in days, keeping seed formats)
//   - Weekday and Month names cycling with case preservation
//   - Formula reference adjustment with $ pinned reference support
//   - Style inheritance and shrink support
// ─────────────────────────────────────────────────────────────

export function columnLetterToIndex(columnLetter) {
    let index = 0
    for (let i = 0; i < columnLetter.length; i++) {
        index = index * 26 + (columnLetter.charCodeAt(i) - 64)
    }
    return index - 1
}

export function indexToColumnLetter(col) {
    let columnLabel = ''
    let colNumber = col + 1
    while (colNumber > 0) {
        colNumber--
        columnLabel = String.fromCharCode(65 + (colNumber % 26)) + columnLabel
        colNumber = Math.floor(colNumber / 26)
    }
    return columnLabel
}

// ── Formula Reference Shifting ──

export function shiftFormula(formula, rowOffset, colOffset) {
    if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
        return formula
    }

    return formula.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (match, colPin, colLetter, rowPin, rowStr) => {
        let colIdx = columnLetterToIndex(colLetter.toUpperCase())
        let rowIdx = parseInt(rowStr, 10) - 1

        if (!colPin) {
            colIdx += colOffset
        }
        if (!rowPin) {
            rowIdx += rowOffset
        }

        if (colIdx < 0 || rowIdx < 0) return match
        return `${colPin}${indexToColumnLetter(colIdx)}${rowPin}${rowIdx + 1}`
    })
}

// ── Date parsing & formatting ──

const MONTH_NAMES_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAMES_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseDateString(str) {
    if (typeof str !== 'string') return null
    const s = str.trim()
    if (!s) return null

    // 1. ISO: YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (isoMatch) {
        const y = parseInt(isoMatch[1], 10)
        const m = parseInt(isoMatch[2], 10)
        const d = parseInt(isoMatch[3], 10)
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            return {
                type: 'iso',
                year: y, month: m, day: d,
                padMonth: isoMatch[2].length === 2,
                padDay: isoMatch[3].length === 2,
                utc: Date.UTC(y, m - 1, d)
            }
        }
    }

    // 2. US: M/D/YYYY or MM/DD/YYYY
    const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (usMatch) {
        const m = parseInt(usMatch[1], 10)
        const d = parseInt(usMatch[2], 10)
        const y = parseInt(usMatch[3], 10)
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            return {
                type: 'us',
                year: y, month: m, day: d,
                padMonth: usMatch[1].length === 2,
                padDay: usMatch[2].length === 2,
                utc: Date.UTC(y, m - 1, d)
            }
        }
    }

    // 3. D MMM YYYY or DD MMM YYYY (e.g. "15 Jan 2024")
    const dmyMatch = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/)
    if (dmyMatch) {
        const d = parseInt(dmyMatch[1], 10)
        const monStr = dmyMatch[2]
        const y = parseInt(dmyMatch[3], 10)
        const monIdx = MONTH_NAMES_SHORT.indexOf(monStr.slice(0, 3).toLowerCase())
        if (monIdx !== -1 && d >= 1 && d <= 31) {
            let caseType = 'title'
            if (monStr === monStr.toUpperCase()) caseType = 'upper'
            else if (monStr === monStr.toLowerCase()) caseType = 'lower'

            return {
                type: 'dmy',
                year: y, month: monIdx + 1, day: d,
                padDay: dmyMatch[1].length === 2,
                caseType,
                utc: Date.UTC(y, monIdx, d)
            }
        }
    }

    return null
}

export function formatDateString(utcMs, formatDesc) {
    const d = new Date(utcMs)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()

    if (formatDesc.type === 'iso') {
        const mStr = formatDesc.padMonth ? String(m).padStart(2, '0') : String(m)
        const dStr = formatDesc.padDay ? String(day).padStart(2, '0') : String(day)
        return `${y}-${mStr}-${dStr}`
    }

    if (formatDesc.type === 'us') {
        const mStr = formatDesc.padMonth ? String(m).padStart(2, '0') : String(m)
        const dStr = formatDesc.padDay ? String(day).padStart(2, '0') : String(day)
        return `${mStr}/${dStr}/${y}`
    }

    if (formatDesc.type === 'dmy') {
        const dStr = formatDesc.padDay ? String(day).padStart(2, '0') : String(day)
        let mStr = MONTH_NAMES_TITLE[m - 1]
        if (formatDesc.caseType === 'upper') mStr = mStr.toUpperCase()
        else if (formatDesc.caseType === 'lower') mStr = mStr.toLowerCase()
        return `${dStr} ${mStr} ${y}`
    }

    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ── Weekday and Month names ──

const WEEKDAYS_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const WEEKDAYS_LONG = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const WEEKDAYS_TITLE = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAYS_SHORT_TITLE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTHS_LONG_TITLE = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function matchCycleWord(str, listShort, listLong, listTitleShort, listTitleLong) {
    const s = str.trim().toLowerCase()
    let idx = listShort.indexOf(s)
    let isShort = true
    if (idx === -1) {
        idx = listLong.indexOf(s)
        isShort = false
    }
    if (idx === -1) return null

    let caseType = 'title'
    const trimmed = str.trim()
    if (trimmed === trimmed.toUpperCase()) caseType = 'upper'
    else if (trimmed === trimmed.toLowerCase()) caseType = 'lower'

    return {
        index: idx,
        length: listShort.length,
        isShort,
        caseType,
        format(targetIdx) {
            const modIdx = ((targetIdx % listShort.length) + listShort.length) % listShort.length
            let name = isShort ? listTitleShort[modIdx] : listTitleLong[modIdx]
            if (caseType === 'upper') name = name.toUpperCase()
            else if (caseType === 'lower') name = name.toLowerCase()
            return name
        }
    }
}

// ── 1D Series Extrapolation ──

/**
 * Creates a generator function (stepOffset) => { value, style }
 * for a sequence of seed cells.
 * stepOffset is positive when moving forward beyond seeds,
 * negative when moving backward before seeds.
 */
export function createSeriesGenerator(seeds) {
    const N = seeds.length
    if (N === 0) return () => ({ value: '', style: undefined })

    const rawValues = seeds.map(s => (s.raw != null ? String(s.raw) : ''))

    // 1. All formulas
    const allFormulas = rawValues.every(v => v.startsWith('='))
    if (allFormulas) {
        return (stepOffset) => {
            // Forward: stepOffset >= 1 means past last seed
            // Backward: stepOffset <= -1 means before first seed
            let seedIdx
            let rowDiff
            let colDiff

            if (stepOffset >= 1) {
                const k = stepOffset - 1
                seedIdx = k % N
                const baseSeed = seeds[seedIdx]
                const targetRow = seeds[N - 1].row + stepOffset * seeds[0].stepRowDelta
                const targetCol = seeds[N - 1].col + stepOffset * seeds[0].stepColDelta
                rowDiff = targetRow - baseSeed.row
                colDiff = targetCol - baseSeed.col
                return {
                    value: shiftFormula(baseSeed.raw, rowDiff, colDiff),
                    style: baseSeed.style
                }
            } else {
                const k = -stepOffset - 1
                seedIdx = ((0 - (k + 1)) % N + N) % N
                const baseSeed = seeds[seedIdx]
                const targetRow = seeds[0].row + stepOffset * seeds[0].stepRowDelta
                const targetCol = seeds[0].col + stepOffset * seeds[0].stepColDelta
                rowDiff = targetRow - baseSeed.row
                colDiff = targetCol - baseSeed.col
                return {
                    value: shiftFormula(baseSeed.raw, rowDiff, colDiff),
                    style: baseSeed.style
                }
            }
        }
    }

    // 2. All dates
    const parsedDates = rawValues.map(v => parseDateString(v))
    const allDates = parsedDates.every(d => d !== null)
    if (allDates) {
        let deltaDays = 1
        if (N > 1) {
            deltaDays = (parsedDates[N - 1].utc - parsedDates[0].utc) / ((N - 1) * 86400000)
            if (deltaDays === 0) deltaDays = 1
        }

        return (stepOffset) => {
            if (stepOffset >= 1) {
                const k = stepOffset
                const daysToAdd = Math.round(k * deltaDays)
                const newUtc = parsedDates[N - 1].utc + daysToAdd * 86400000
                const seedIdx = (N - 1 + k) % N
                return {
                    value: formatDateString(newUtc, parsedDates[seedIdx]),
                    style: seeds[seedIdx].style
                }
            } else {
                const k = -stepOffset
                const daysToSub = Math.round(k * deltaDays)
                const newUtc = parsedDates[0].utc - daysToSub * 86400000
                const seedIdx = ((0 - k) % N + N) % N
                return {
                    value: formatDateString(newUtc, parsedDates[seedIdx]),
                    style: seeds[seedIdx].style
                }
            }
        }
    }

    // 3. Text ending in numbers: e.g. ORD-1001, Item 1, Q4, 2024-W01
    // Must have a non-empty text prefix so pure numbers fall through to numeric series
    const textNumMatches = rawValues.map(v => v.match(/^(.*?)(\d+)$/))
    const allTextNum = textNumMatches.every((m, idx) => m !== null && m[1].length > 0 && isNaN(Number(rawValues[idx])))
    if (allTextNum) {
        const prefix = textNumMatches[0][1]
        const samePrefix = textNumMatches.every(m => m[1] === prefix)
        if (samePrefix) {
            const nums = textNumMatches.map(m => parseInt(m[2], 10))
            const padLengths = textNumMatches.map(m => m[2].length)
            const padLen = Math.max(...padLengths)

            let delta = 1
            if (N > 1) {
                delta = (nums[N - 1] - nums[0]) / (N - 1)
            }

            return (stepOffset) => {
                if (stepOffset >= 1) {
                    const k = stepOffset
                    const nextNum = Math.round(nums[N - 1] + k * delta)
                    const seedIdx = (N - 1 + k) % N
                    const valStr = prefix + String(Math.max(0, nextNum)).padStart(padLen, '0')
                    return {
                        value: valStr,
                        style: seeds[seedIdx].style
                    }
                } else {
                    const k = -stepOffset
                    const prevNum = Math.round(nums[0] - k * delta)
                    const seedIdx = ((0 - k) % N + N) % N
                    const valStr = prefix + String(Math.max(0, prevNum)).padStart(padLen, '0')
                    return {
                        value: valStr,
                        style: seeds[seedIdx].style
                    }
                }
            }
        }
    }

    // 4. Weekdays or Month names
    const weekdayMatches = rawValues.map(v =>
        matchCycleWord(v, WEEKDAYS_SHORT, WEEKDAYS_LONG, WEEKDAYS_SHORT_TITLE, WEEKDAYS_TITLE)
    )
    if (weekdayMatches.every(w => w !== null)) {
        let step = 1
        if (N > 1) {
            step = (weekdayMatches[N - 1].index - weekdayMatches[0].index) / (N - 1)
        }
        return (stepOffset) => {
            if (stepOffset >= 1) {
                const k = stepOffset
                const targetIdx = Math.round(weekdayMatches[N - 1].index + k * step)
                const seedIdx = (N - 1 + k) % N
                return {
                    value: weekdayMatches[seedIdx].format(targetIdx),
                    style: seeds[seedIdx].style
                }
            } else {
                const k = -stepOffset
                const targetIdx = Math.round(weekdayMatches[0].index - k * step)
                const seedIdx = ((0 - k) % N + N) % N
                return {
                    value: weekdayMatches[seedIdx].format(targetIdx),
                    style: seeds[seedIdx].style
                }
            }
        }
    }

    const monthMatches = rawValues.map(v =>
        matchCycleWord(v, MONTH_NAMES_SHORT, MONTHS_LONG, MONTH_NAMES_TITLE, MONTHS_LONG_TITLE)
    )
    if (monthMatches.every(m => m !== null)) {
        let step = 1
        if (N > 1) {
            step = (monthMatches[N - 1].index - monthMatches[0].index) / (N - 1)
        }
        return (stepOffset) => {
            if (stepOffset >= 1) {
                const k = stepOffset
                const targetIdx = Math.round(monthMatches[N - 1].index + k * step)
                const seedIdx = (N - 1 + k) % N
                return {
                    value: monthMatches[seedIdx].format(targetIdx),
                    style: seeds[seedIdx].style
                }
            } else {
                const k = -stepOffset
                const targetIdx = Math.round(monthMatches[0].index - k * step)
                const seedIdx = ((0 - k) % N + N) % N
                return {
                    value: monthMatches[seedIdx].format(targetIdx),
                    style: seeds[seedIdx].style
                }
            }
        }
    }

    // 5. Numeric series: 1 seed -> copy, 2+ seeds -> arithmetic progression
    const allNumeric = rawValues.every(v => v.trim() !== '' && !isNaN(Number(v)))
    if (allNumeric) {
        const nums = rawValues.map(v => Number(v))
        if (N === 1) {
            // "one seed -> copy"
            return () => ({
                value: rawValues[0],
                style: seeds[0].style
            })
        }

        const delta = (nums[N - 1] - nums[0]) / (N - 1)
        const isInteger = nums.every(n => Number.isInteger(n)) && Number.isInteger(delta)

        return (stepOffset) => {
            if (stepOffset >= 1) {
                const k = stepOffset
                const val = nums[N - 1] + k * delta
                const seedIdx = (N - 1 + k) % N
                const formatted = isInteger ? String(Math.round(val)) : String(Number(val.toFixed(8)))
                return {
                    value: formatted,
                    style: seeds[seedIdx].style
                }
            } else {
                const k = -stepOffset
                const val = nums[0] - k * delta
                const seedIdx = ((0 - k) % N + N) % N
                const formatted = isInteger ? String(Math.round(val)) : String(Number(val.toFixed(8)))
                return {
                    value: formatted,
                    style: seeds[seedIdx].style
                }
            }
        }
    }

    // 6. Fallback: cycle seed values and styles
    return (stepOffset) => {
        let seedIdx
        if (stepOffset >= 1) {
            seedIdx = (N - 1 + stepOffset) % N
        } else {
            const k = -stepOffset
            seedIdx = ((0 - k) % N + N) % N
        }
        return {
            value: rawValues[seedIdx],
            style: seeds[seedIdx].style
        }
    }
}

// ── Fill Changes Computation ──

/**
 * Computes the cells to change based on source range and target drop point/range.
 */
export function computeFillChanges(getCell, sourceRange, targetCoordOrRange, getCellStyle) {
    if (!sourceRange || !targetCoordOrRange) return []

    const srcR1 = Math.min(sourceRange.startRow, sourceRange.endRow)
    const srcR2 = Math.max(sourceRange.startRow, sourceRange.endRow)
    const srcC1 = Math.min(sourceRange.startCol, sourceRange.endCol)
    const srcC2 = Math.max(sourceRange.startCol, sourceRange.endCol)

    const targetRow = targetCoordOrRange.endRow !== undefined ? targetCoordOrRange.endRow : targetCoordOrRange.row
    const targetCol = targetCoordOrRange.endCol !== undefined ? targetCoordOrRange.endCol : targetCoordOrRange.col

    if (targetRow == null || targetCol == null) return []

    const downDist = targetRow > srcR2 ? targetRow - srcR2 : 0
    const upDist = targetRow < srcR1 ? srcR1 - targetRow : 0
    const rightDist = targetCol > srcC2 ? targetCol - srcC2 : 0
    const leftDist = targetCol < srcC1 ? srcC1 - targetCol : 0

    const verticalDist = Math.max(downDist, upDist)
    const horizontalDist = Math.max(rightDist, leftDist)

    const changes = []

    // Case 1: Dragging Back (Shrink) within seed
    if (verticalDist === 0 && horizontalDist === 0) {
        // Target is inside the seed bounding box
        const shrinkRows = srcR2 - targetRow
        const shrinkCols = srcC2 - targetCol

        if (shrinkRows > 0 && shrinkRows >= shrinkCols) {
            // Shrink rows from targetRow + 1 to srcR2
            for (let r = targetRow + 1; r <= srcR2; r++) {
                for (let c = srcC1; c <= srcC2; c++) {
                    changes.push({ row: r, col: c, value: '', style: undefined })
                }
            }
            return changes
        } else if (shrinkCols > 0) {
            // Shrink columns from targetCol + 1 to srcC2
            for (let r = srcR1; r <= srcR2; r++) {
                for (let c = targetCol + 1; c <= srcC2; c++) {
                    changes.push({ row: r, col: c, value: '', style: undefined })
                }
            }
            return changes
        }
        return []
    }

    // Case 2: Vertical fill takes precedence
    if (verticalDist >= horizontalDist) {
        if (downDist > 0) {
            // Filling downwards
            for (let c = srcC1; c <= srcC2; c++) {
                const seedItems = []
                for (let r = srcR1; r <= srcR2; r++) {
                    const cellData = getCell(r, c)
                    const style = getCellStyle ? getCellStyle(r, c) : (cellData.style || undefined)
                    seedItems.push({
                        row: r,
                        col: c,
                        raw: cellData.raw,
                        style,
                        stepRowDelta: 1,
                        stepColDelta: 0
                    })
                }

                const generator = createSeriesGenerator(seedItems)
                for (let r = srcR2 + 1; r <= targetRow; r++) {
                    const stepOffset = r - srcR2
                    const next = generator(stepOffset)
                    changes.push({ row: r, col: c, value: next.value, style: next.style })
                }
            }
        } else if (upDist > 0) {
            // Filling upwards
            for (let c = srcC1; c <= srcC2; c++) {
                const seedItems = []
                for (let r = srcR1; r <= srcR2; r++) {
                    const cellData = getCell(r, c)
                    const style = getCellStyle ? getCellStyle(r, c) : (cellData.style || undefined)
                    seedItems.push({
                        row: r,
                        col: c,
                        raw: cellData.raw,
                        style,
                        stepRowDelta: 1,
                        stepColDelta: 0
                    })
                }

                const generator = createSeriesGenerator(seedItems)
                for (let r = srcR1 - 1; r >= targetRow; r--) {
                    const stepOffset = r - srcR1 // negative
                    const next = generator(stepOffset)
                    changes.push({ row: r, col: c, value: next.value, style: next.style })
                }
            }
        }
        return changes
    }

    // Case 3: Horizontal fill
    if (rightDist > 0) {
        // Filling rightwards
        for (let r = srcR1; r <= srcR2; r++) {
            const seedItems = []
            for (let c = srcC1; c <= srcC2; c++) {
                const cellData = getCell(r, c)
                const style = getCellStyle ? getCellStyle(r, c) : (cellData.style || undefined)
                seedItems.push({
                    row: r,
                    col: c,
                    raw: cellData.raw,
                    style,
                    stepRowDelta: 0,
                    stepColDelta: 1
                })
            }

            const generator = createSeriesGenerator(seedItems)
            for (let c = srcC2 + 1; c <= targetCol; c++) {
                const stepOffset = c - srcC2
                const next = generator(stepOffset)
                changes.push({ row: r, col: c, value: next.value, style: next.style })
            }
        }
    } else if (leftDist > 0) {
        // Filling leftwards
        for (let r = srcR1; r <= srcR2; r++) {
            const seedItems = []
            for (let c = srcC1; c <= srcC2; c++) {
                const cellData = getCell(r, c)
                const style = getCellStyle ? getCellStyle(r, c) : (cellData.style || undefined)
                seedItems.push({
                    row: r,
                    col: c,
                    raw: cellData.raw,
                    style,
                    stepRowDelta: 0,
                    stepColDelta: 1
                })
            }

            const generator = createSeriesGenerator(seedItems)
            for (let c = srcC1 - 1; c >= targetCol; c--) {
                const stepOffset = c - srcC1 // negative
                const next = generator(stepOffset)
                changes.push({ row: r, col: c, value: next.value, style: next.style })
            }
        }
    }

    return changes
}
