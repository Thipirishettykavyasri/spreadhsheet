import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'
import { loadSampleSmall, loadSampleLarge } from './fixtures/loadSample.js'
import {
  executeSort,
  evaluateSheetFilters,
  getDistinctColumnValues,
} from './engine/sortFilter.js'
import { executeQueryPlan } from './ai/queryExecutor.js'
import { createProvider } from './ai/provider.js'
import { extractJsonFromResponse, validateAction } from './ai/validator.js'
const TOTAL_ROWS = 50
const TOTAL_COLS = 50

export default function App() {
  const [engine] = useState(() => createEngine(TOTAL_ROWS, TOTAL_COLS))
  const [, setVersion] = useState(0)
  const [selectedCell, setSelectedCell] = useState(null)
  const [selectionRange, setSelectionRange] = useState(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [fillStart, setFillStart] = useState(null)
  const [fillTarget, setFillTarget] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [cellStyles, setCellStyles] = useState({})
  const [sortColumn, setSortColumn] = useState(0)
const [sortDirection, setSortDirection] = useState('asc')
const [activeFilters, setActiveFilters] = useState({})
const [filterColumn, setFilterColumn] = useState(0)
const [filterText, setFilterText] = useState('')
const [dataQuestion, setDataQuestion] = useState('')
const [dataAnswer, setDataAnswer] = useState('')
const [isAskingData, setIsAskingData] = useState(false)


  const cellInputRef = useRef(null)
  const isCancellingRef = useRef(false)

  const forceRerender = useCallback(() => setVersion(v => v + 1), [])

  // ────── Cell style helpers ──────

  const getCellStyle = useCallback((row, col) => {
    const key = `${row},${col}`
    const engineCell = engine.getCell(row, col)
    return cellStyles[key] || engineCell?.style || {
      bold: false, italic: false, underline: false,
      bg: 'white', color: '#202124', align: 'left', fontSize: 13
    }
  }, [cellStyles, engine])

  const effectiveRange = useMemo(() => {
    if (selectionRange) return selectionRange
    if (selectedCell) {
      return {
        startRow: selectedCell.r,
        startCol: selectedCell.c,
        endRow: selectedCell.r,
        endCol: selectedCell.c,
      }
    }
    return null
  }, [selectionRange, selectedCell])

  const normalizedRange = useMemo(() => {
    if (!effectiveRange) return null
    return {
      minRow: Math.min(effectiveRange.startRow, effectiveRange.endRow),
      maxRow: Math.max(effectiveRange.startRow, effectiveRange.endRow),
      minCol: Math.min(effectiveRange.startCol, effectiveRange.endCol),
      maxCol: Math.max(effectiveRange.startCol, effectiveRange.endCol),
    }
  }, [effectiveRange])

  const fillPreviewRange = useMemo(() => {
    if (!fillStart || !fillTarget) return null
    const srcR1 = Math.min(fillStart.startRow, fillStart.endRow)
    const srcR2 = Math.max(fillStart.startRow, fillStart.endRow)
    const srcC1 = Math.min(fillStart.startCol, fillStart.endCol)
    const srcC2 = Math.max(fillStart.startCol, fillStart.endCol)

    const tR = fillTarget.row
    const tC = fillTarget.col

    const downDist = tR > srcR2 ? tR - srcR2 : 0
    const upDist = tR < srcR1 ? srcR1 - tR : 0
    const rightDist = tC > srcC2 ? tC - srcC2 : 0
    const leftDist = tC < srcC1 ? srcC1 - tC : 0

    const vDist = Math.max(downDist, upDist)
    const hDist = Math.max(rightDist, leftDist)

    if (vDist === 0 && hDist === 0) {
      return { minRow: srcR1, maxRow: tR, minCol: srcC1, maxCol: tC }
    }

    if (vDist >= hDist) {
      if (downDist > 0) {
        return { minRow: srcR1, maxRow: tR, minCol: srcC1, maxCol: srcC2 }
      } else {
        return { minRow: tR, maxRow: srcR2, minCol: srcC1, maxCol: srcC2 }
      }
    } else {
      if (rightDist > 0) {
        return { minRow: srcR1, maxRow: srcR2, minCol: srcC1, maxCol: tC }
      } else {
        return { minRow: srcR1, maxRow: srcR2, minCol: tC, maxCol: srcC2 }
      }
    }
  }, [fillStart, fillTarget])

  // ────── Cell editing ──────

  const startEditing = useCallback((row, col, initialValue) => {
    setSelectedCell({ r: row, c: col })
    setSelectionRange({ startRow: row, startCol: col, endRow: row, endCol: col })
    setEditingCell({ r: row, c: col })
    const cellData = engine.getCell(row, col)
    setEditValue(initialValue !== undefined ? initialValue : cellData.raw)
    setTimeout(() => {
      if (cellInputRef.current) {
        cellInputRef.current.focus()
        if (initialValue === undefined) {
          const len = cellInputRef.current.value.length
          cellInputRef.current.setSelectionRange(len, len)
        }
      }
    }, 0)
  }, [engine])

  const commitEdit = useCallback((row, col) => {
    if (isCancellingRef.current) {
      isCancellingRef.current = false
      return
    }
    const currentCell = engine.getCell(row, col)
    if (currentCell.raw !== editValue) {
      engine.setCell(row, col, editValue)
      forceRerender()
    }
    setEditingCell(null)
  }, [engine, editValue, forceRerender])

  const cancelEdit = useCallback((row, col) => {
    isCancellingRef.current = true
    setEditValue(engine.getCell(row, col).raw)
    setEditingCell(null)
  }, [engine])

  // ────── Fill Handle ──────

  const handleFill = useCallback((start, end) => {
    if (!start || !end) return
    const success = engine.fill(start, end, (r, c) => getCellStyle(r, c))
    if (success) {
      const srcR1 = Math.min(start.startRow, start.endRow)
      const srcR2 = Math.max(start.startRow, start.endRow)
      const srcC1 = Math.min(start.startCol, start.endCol)
      const srcC2 = Math.max(start.startCol, start.endCol)

      const targetRow = end.endRow !== undefined ? end.endRow : end.row
      const targetCol = end.endCol !== undefined ? end.endCol : end.col

      const downDist = targetRow > srcR2 ? targetRow - srcR2 : 0
      const upDist = targetRow < srcR1 ? srcR1 - targetRow : 0
      const rightDist = targetCol > srcC2 ? targetCol - srcC2 : 0
      const leftDist = targetCol < srcC1 ? srcC1 - targetCol : 0

      const vDist = Math.max(downDist, upDist)
      const hDist = Math.max(rightDist, leftDist)

      let newR1 = srcR1, newR2 = srcR2, newC1 = srcC1, newC2 = srcC2

      if (vDist === 0 && hDist === 0) {
        const shrinkRows = srcR2 - targetRow
        const shrinkCols = srcC2 - targetCol
        if (shrinkRows > 0 && shrinkRows >= shrinkCols) {
          newR2 = targetRow
        } else if (shrinkCols > 0) {
          newC2 = targetCol
        }
      } else if (vDist >= hDist) {
        if (downDist > 0) newR2 = targetRow
        else if (upDist > 0) newR1 = targetRow
      } else {
        if (rightDist > 0) newC2 = targetCol
        else if (leftDist > 0) newC1 = targetCol
      }

      setSelectionRange({
        startRow: newR1,
        startCol: newC1,
        endRow: newR2,
        endCol: newC2,
      })
      setSelectedCell({ r: newR1, c: newC1 })
      setCellStyles({})
      forceRerender()
    }
  }, [engine, getCellStyle, forceRerender])

  // ────── Clear Selection ──────

  const handleClearSelection = useCallback(() => {
    if (!effectiveRange) return
    if (engine.clearRange(effectiveRange)) {
      setCellStyles({})
      setEditValue('')
      forceRerender()
    }
  }, [effectiveRange, engine, forceRerender])

  // ────── Cell Mouse Handlers ──────

  const handleCellMouseDown = useCallback((e, row, col) => {
    if (e.button !== 0) return
    e.preventDefault()

    if (editingCell && (editingCell.r !== row || editingCell.c !== col)) {
      commitEdit(editingCell.r, editingCell.c)
    }

    if (e.shiftKey && selectedCell) {
      // Shift+Click extends selection
      setSelectionRange({
        startRow: selectedCell.r,
        startCol: selectedCell.c,
        endRow: row,
        endCol: col,
      })
      setEditingCell(null)
      setIsDraggingSelection(false)
      return
    }

    // Single click selects cell without entering edit mode
    setSelectedCell({ r: row, c: col })
    setSelectionRange({
      startRow: row,
      startCol: col,
      endRow: row,
      endCol: col,
    })
    setEditingCell(null)
    setIsDraggingSelection(true)
  }, [editingCell, commitEdit, selectedCell])

  const handleCellDoubleClick = useCallback((row, col) => {
    startEditing(row, col)
  }, [startEditing])

  // ────── Header Click Handlers ──────

  const handleColumnHeaderClick = useCallback((e, colIndex) => {
    if (editingCell) commitEdit(editingCell.r, editingCell.c)
    if (e.shiftKey && selectedCell) {
      setSelectionRange({
        startRow: 0,
        startCol: selectedCell.c,
        endRow: engine.rows - 1,
        endCol: colIndex,
      })
    } else {
      setSelectedCell({ r: 0, c: colIndex })
      setSelectionRange({
        startRow: 0,
        startCol: colIndex,
        endRow: engine.rows - 1,
        endCol: colIndex,
      })
    }
    setEditingCell(null)
  }, [editingCell, commitEdit, selectedCell, engine])

  const handleRowHeaderClick = useCallback((e, rowIndex) => {
    if (editingCell) commitEdit(editingCell.r, editingCell.c)
    if (e.shiftKey && selectedCell) {
      setSelectionRange({
        startRow: selectedCell.r,
        startCol: 0,
        endRow: rowIndex,
        endCol: engine.cols - 1,
      })
    } else {
      setSelectedCell({ r: rowIndex, c: 0 })
      setSelectionRange({
        startRow: rowIndex,
        startCol: 0,
        endRow: rowIndex,
        endCol: engine.cols - 1,
      })
    }
    setEditingCell(null)
  }, [editingCell, commitEdit, selectedCell, engine])

  const handleCornerHeaderClick = useCallback(() => {
    if (editingCell) commitEdit(editingCell.r, editingCell.c)
    setSelectedCell({ r: 0, c: 0 })
    setSelectionRange({
      startRow: 0,
      startCol: 0,
      endRow: engine.rows - 1,
      endCol: engine.cols - 1,
    })
    setEditingCell(null)
  }, [editingCell, commitEdit, engine])

  // ────── Editing Input KeyDown ──────

  const handleEditingKeyDown = useCallback((event, row, col) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit(row, col)
      const nextRow = Math.min(row + 1, engine.rows - 1)
      setSelectedCell({ r: nextRow, c: col })
      setSelectionRange({ startRow: nextRow, startCol: col, endRow: nextRow, endCol: col })
    } else if (event.key === 'Tab') {
      event.preventDefault()
      commitEdit(row, col)
      const nextCol = event.shiftKey ? Math.max(col - 1, 0) : Math.min(col + 1, engine.cols - 1)
      setSelectedCell({ r: row, c: nextCol })
      setSelectionRange({ startRow: row, startCol: nextCol, endRow: row, endCol: nextCol })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit(row, col)
    }
  }, [engine, commitEdit, cancelEdit])

  // ────── Formula Bar Handlers ──────

  const handleFormulaBarKeyDown = useCallback((event) => {
    if (!selectedCell) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit(selectedCell.r, selectedCell.c)
      const nextRow = Math.min(selectedCell.r + 1, engine.rows - 1)
      setSelectedCell({ r: nextRow, c: selectedCell.c })
      setSelectionRange({ startRow: nextRow, startCol: selectedCell.c, endRow: nextRow, endCol: selectedCell.c })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit(selectedCell.r, selectedCell.c)
    }
  }, [selectedCell, engine, commitEdit, cancelEdit])

  const handleFormulaBarFocus = useCallback(() => {
    if (selectedCell && !editingCell) {
      setEditingCell(selectedCell)
      setEditValue(engine.getCell(selectedCell.r, selectedCell.c).raw)
    }
  }, [selectedCell, editingCell, engine])

  const handleFormulaBarChange = useCallback((value) => {
    if (!editingCell && selectedCell) setEditingCell(selectedCell)
    setEditValue(value)
  }, [editingCell, selectedCell])

  // ────── Undo / Redo ──────

  const handleUndo = useCallback(() => {
    if (engine.undo()) {
      setCellStyles({})
      forceRerender()
    }
  }, [engine, forceRerender])

  const handleRedo = useCallback(() => {
    if (engine.redo()) {
      setCellStyles({})
      forceRerender()
    }
  }, [engine, forceRerender])

  // ────── Window-level MouseUp (End Dragging) ──────

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (fillStart && fillTarget) {
        handleFill(fillStart, fillTarget)
      }
      setFillStart(null)
      setFillTarget(null)
      setIsDraggingSelection(false)
    }
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => window.removeEventListener('mouseup', handleWindowMouseUp)
  }, [fillStart, fillTarget, handleFill])

  // ────── Global KeyDown Handler ──────

  useEffect(() => {
    const onGlobalKeyDown = (e) => {
      if (
  e.target instanceof HTMLInputElement ||
  e.target instanceof HTMLTextAreaElement ||
  e.target instanceof HTMLSelectElement
) {
  return
}
      if (e.target && e.target.classList && e.target.classList.contains('formula-bar-input')) {
        return
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
        return
      }

      // Ctrl+A: Select Used Range
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (!editingCell) {
          e.preventDefault()
          const usedRange = engine.getUsedRange()
          setSelectionRange(usedRange)
          setSelectedCell({ r: usedRange.startRow, c: usedRange.startCol })
          return
        }
      }

      // If in edit mode, let cell-input handle typing
      if (editingCell) return

      if (!selectedCell) return

      // Enter key: start editing
      if (e.key === 'Enter') {
        e.preventDefault()
        startEditing(selectedCell.r, selectedCell.c)
        return
      }

      // F2 key: start editing
      if (e.key === 'F2') {
        e.preventDefault()
        startEditing(selectedCell.r, selectedCell.c)
        return
      }

      // Delete / Backspace: clear selection as one undo step
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleClearSelection()
        return
      }

      // Tab key
      if (e.key === 'Tab') {
        e.preventDefault()
        const nextCol = e.shiftKey
          ? Math.max(selectedCell.c - 1, 0)
          : Math.min(selectedCell.c + 1, engine.cols - 1)
        setSelectedCell({ r: selectedCell.r, c: nextCol })
        setSelectionRange({ startRow: selectedCell.r, startCol: nextCol, endRow: selectedCell.r, endCol: nextCol })
        return
      }

      // Arrow keys (with or without Shift)
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (e.shiftKey) {
          const curEndRow = selectionRange ? selectionRange.endRow : selectedCell.r
          const curEndCol = selectionRange ? selectionRange.endCol : selectedCell.c
          let newEndRow = curEndRow
          let newEndCol = curEndCol

          if (e.key === 'ArrowDown') newEndRow = Math.min(curEndRow + 1, engine.rows - 1)
          if (e.key === 'ArrowUp') newEndRow = Math.max(curEndRow - 1, 0)
          if (e.key === 'ArrowRight') newEndCol = Math.min(curEndCol + 1, engine.cols - 1)
          if (e.key === 'ArrowLeft') newEndCol = Math.max(curEndCol - 1, 0)

          setSelectionRange({
            startRow: selectedCell.r,
            startCol: selectedCell.c,
            endRow: newEndRow,
            endCol: newEndCol,
          })
        } else {
          let newRow = selectedCell.r
          let newCol = selectedCell.c

          if (e.key === 'ArrowDown') newRow = Math.min(selectedCell.r + 1, engine.rows - 1)
          if (e.key === 'ArrowUp') newRow = Math.max(selectedCell.r - 1, 0)
          if (e.key === 'ArrowRight') newCol = Math.min(selectedCell.c + 1, engine.cols - 1)
          if (e.key === 'ArrowLeft') newCol = Math.max(selectedCell.c - 1, 0)

          setSelectedCell({ r: newRow, c: newCol })
          setSelectionRange({
            startRow: newRow,
            startCol: newCol,
            endRow: newRow,
            endCol: newCol,
          })
        }
        return
      }

      // Typing printable character starts editing immediately with that character
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key !== 'Escape'
      ) {
        e.preventDefault()
        startEditing(selectedCell.r, selectedCell.c, e.key)
      }
    }

    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [
    editingCell,
    selectedCell,
    selectionRange,
    engine,
    handleUndo,
    handleRedo,
    startEditing,
    handleClearSelection,
  ])

  // ────── Formatting Toggles (Apply to Entire Selection) ──────

  const applyStyleToSelection = useCallback((updates) => {
    if (!effectiveRange) return
    if (engine.setRangeStyle(effectiveRange, updates)) {
      setCellStyles({})
      forceRerender()
    }
  }, [effectiveRange, engine, forceRerender])

  const toggleBold = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    applyStyleToSelection({ bold: !style.bold })
  }, [selectedCell, getCellStyle, applyStyleToSelection])

  const toggleItalic = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    applyStyleToSelection({ italic: !style.italic })
  }, [selectedCell, getCellStyle, applyStyleToSelection])

  const toggleUnderline = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    applyStyleToSelection({ underline: !style.underline })
  }, [selectedCell, getCellStyle, applyStyleToSelection])

  const changeFontSize = useCallback((size) => {
    applyStyleToSelection({ fontSize: size })
  }, [applyStyleToSelection])

  const changeAlignment = useCallback((align) => {
    applyStyleToSelection({ align })
  }, [applyStyleToSelection])

  const changeFontColor = useCallback((color) => {
    applyStyleToSelection({ color })
  }, [applyStyleToSelection])

  const changeBackgroundColor = useCallback((color) => {
    applyStyleToSelection({ bg: color })
  }, [applyStyleToSelection])

  // ────── Clear All ──────

  const clearAllCells = useCallback(() => {
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) {
        engine.setCell(r, c, '')
      }
    }
    forceRerender()
    setCellStyles({})
    setSelectedCell(null)
    setSelectionRange(null)
    setEditingCell(null)
    setEditValue('')
  }, [engine, forceRerender])

  // ────── Sample data (fixtures/sales.tsv) ──────

  const loadSample = useCallback((loader) => {
    loader(engine)
    forceRerender()
    setSelectedCell({ r: 0, c: 0 })
    setSelectionRange({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 })
    setEditingCell(null)
    setEditValue('')
  }, [engine, forceRerender])

  // ────── Row / Column operations ──────

  const insertRow = useCallback(() => {
    if (!selectedCell) return
    engine.insertRow(selectedCell.r)
    forceRerender()
    setSelectedCell({ r: selectedCell.r + 1, c: selectedCell.c })
    setSelectionRange({ startRow: selectedCell.r + 1, startCol: selectedCell.c, endRow: selectedCell.r + 1, endCol: selectedCell.c })
  }, [selectedCell, engine, forceRerender])

  const deleteRow = useCallback(() => {
    if (!selectedCell) return
    engine.deleteRow(selectedCell.r)
    forceRerender()
    const newR = Math.min(selectedCell.r, engine.rows - 1)
    setSelectedCell({ r: newR, c: selectedCell.c })
    setSelectionRange({ startRow: newR, startCol: selectedCell.c, endRow: newR, endCol: selectedCell.c })
  }, [selectedCell, engine, forceRerender])

  const insertColumn = useCallback(() => {
    if (!selectedCell) return
    engine.insertColumn(selectedCell.c)
    forceRerender()
    setSelectedCell({ r: selectedCell.r, c: selectedCell.c + 1 })
    setSelectionRange({ startRow: selectedCell.r, startCol: selectedCell.c + 1, endRow: selectedCell.r, endCol: selectedCell.c + 1 })
  }, [selectedCell, engine, forceRerender])

  const deleteColumn = useCallback(() => {
    if (!selectedCell) return
    engine.deleteColumn(selectedCell.c)
    forceRerender()
    const newC = Math.min(selectedCell.c, engine.cols - 1)
    setSelectedCell({ r: selectedCell.r, c: newC })
    setSelectionRange({ startRow: selectedCell.r, startCol: newC, endRow: selectedCell.r, endCol: newC })
  }, [selectedCell, engine, forceRerender])

  // ────── Derived State ──────

  const selectedCellStyle = useMemo(() => {
    return selectedCell ? getCellStyle(selectedCell.r, selectedCell.c) : null
  }, [selectedCell, getCellStyle])

  const getColumnLabel = useCallback((col) => {
    let label = ''
    let num = col + 1
    while (num > 0) {
      num--
      label = String.fromCharCode(65 + (num % 26)) + label
      num = Math.floor(num / 26)
    }
    return label
  }, [])

  const selectedCellLabel = selectedCell
    ? `${getColumnLabel(selectedCell.c)}${selectedCell.r + 1}`
    : 'No cell'

  const formulaBarValue = editingCell
    ? editValue
    : (selectedCell ? engine.getCell(selectedCell.r, selectedCell.c).raw : '')

  return (
    <div className="app-wrapper">
      <div className="app-header">
        <h2 className="app-title">📊 Spreadsheet App</h2>
      </div>

      <div className="main-content">

        {/* ── Toolbar ── */}
        <div className="toolbar-group">
  <select
    value={sortColumn}
    onChange={(e) => setSortColumn(Number(e.target.value))}
    className="toolbar-select"
  >
    {Array.from({ length: engine.cols }, (_, i) => (
      <option key={i} value={i}>
        Column {getColumnLabel(i)}
      </option>
    ))}
  </select>

  <button
    className="toolbar-btn"
    onClick={() => {
      const result = executeSort(engine, {
        col: sortColumn,
        direction: sortDirection,
        selectionRange: null,
      })
      if (result.success) {
        setSortDirection(
          sortDirection === 'asc' ? 'desc' : 'asc'
        )
        forceRerender()
      }
    }}
  >
    Sort {sortDirection === 'asc' ? '↑' : '↓'}
  </button>
</div>
        <div className="toolbar">
          <div className="toolbar-group">
            <button className={`toolbar-btn bold-btn ${selectedCellStyle?.bold ? 'active' : ''}`} onClick={toggleBold} title="Bold">B</button>
            <button className={`toolbar-btn italic-btn ${selectedCellStyle?.italic ? 'active' : ''}`} onClick={toggleItalic} title="Italic">I</button>
            <button className={`toolbar-btn underline-btn ${selectedCellStyle?.underline ? 'active' : ''}`} onClick={toggleUnderline} title="Underline">U</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Size:</span>
            <select className="toolbar-select" value={selectedCellStyle?.fontSize || 13} onChange={(e) => changeFontSize(parseInt(e.target.value))}>
              {[8, 10, 11, 12, 13, 14, 16, 18, 20, 24].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="toolbar-group">
            <button className={`align-btn ${selectedCellStyle?.align === 'left' ? 'active' : ''}`} onClick={() => changeAlignment('left')} title="Align Left">⬤←</button>
            <button className={`align-btn ${selectedCellStyle?.align === 'center' ? 'active' : ''}`} onClick={() => changeAlignment('center')} title="Align Center">⬤</button>
            <button className={`align-btn ${selectedCellStyle?.align === 'right' ? 'active' : ''}`} onClick={() => changeAlignment('right')} title="Align Right">⬤→</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Text:</span>
            <input
              type="color"
              value={selectedCellStyle?.color || '#000000'}
              onChange={(e) => changeFontColor(e.target.value)}
              title="Font color"
              style={{ width: '32px', height: '32px', border: '1px solid #dadce0', cursor: 'pointer', borderRadius: '4px' }}
            />
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Fill:</span>
            <select className="toolbar-select" value={selectedCellStyle?.bg || 'white'} onChange={(e) => changeBackgroundColor(e.target.value)}>
              <option value="white">White</option>
              <option value="#ffff99">Yellow</option>
              <option value="#99ffcc">Green</option>
              <option value="#ffcccc">Red</option>
              <option value="#cce5ff">Blue</option>
              <option value="#e0ccff">Purple</option>
              <option value="#ffd9b3">Orange</option>
              <option value="#f0f0f0">Gray</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={handleUndo} disabled={!engine.canUndo()} title="Undo">↶ Undo</button>
            <button className="toolbar-btn" onClick={handleRedo} disabled={!engine.canRedo()} title="Redo">↷ Redo</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={insertRow} title="Insert Row">+ Row</button>
            <button className="toolbar-btn" onClick={deleteRow} title="Delete Row">- Row</button>
            <button className="toolbar-btn" onClick={insertColumn} title="Insert Column">+ Col</button>
            <button className="toolbar-btn" onClick={deleteColumn} title="Delete Column">- Col</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn danger" onClick={handleClearSelection} title="Clear Selection">✕ Cell</button>
            <button className="toolbar-btn danger" onClick={clearAllCells} title="Clear All Cells">✕ All</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={() => loadSample(loadSampleSmall)} title="Load fixtures/sales.tsv (33 rows) at A1">⬇ Sample 33</button>
            <button className="toolbar-btn" onClick={() => loadSample(loadSampleLarge)} title="Load fixtures/sales-large.tsv (~3,000 rows) at A1">⬇ Sample 3k</button>
          </div>
        </div>
        
        <div className="toolbar-group">
  <label>Filter Column:</label>
  <select
    className="toolbar-select"
    value={filterColumn}
    onChange={(e) => setFilterColumn(Number(e.target.value))}
  >
    {Array.from({ length: engine.cols }, (_, i) => (
      <option key={i} value={i}>
        Column {getColumnLabel(i)}
      </option>
    ))}
  </select>

  <input
    className="toolbar-select"
    placeholder="Filter text..."
    value={filterText}
    onChange={(e) => setFilterText(e.target.value)}
  />

  <button
    className="toolbar-btn"
    onClick={() => {
      const filters = filterText.trim()
        ? {
            [filterColumn]: {
              search: filterText.trim(),
              condition: {
                type: 'contains',
                value: filterText.trim(),
              },
            },
          }
        : {}

      setActiveFilters(filters)
      const result = evaluateSheetFilters(engine, filters)
      window.alert(
        `Filter checked: ${result.visibleCount} rows visible`
      )
    }}
  >
    Apply Filter
  </button>

  <button
    className="toolbar-btn"
    onClick={() => {
      setFilterText('')
      setActiveFilters({})
      window.alert('Filter cleared')
    }}
  >
    Clear Filter
  </button>
</div>
<div className="toolbar-group">
  <input
    className="toolbar-select"
    placeholder="Ask your data..."
    value={dataQuestion}
    onChange={(e) => setDataQuestion(e.target.value)}
  />
  <button
    className="toolbar-btn"
    onClick={async () => {
  if (!dataQuestion.trim()) {
    setDataAnswer('Please enter a question.')
    return
  }

  setIsAskingData(true)
  setDataAnswer('Processing...')

  try {
    const provider = createProvider()
    const response = await provider.complete({
 
system: `You are a spreadsheet query planner.
Convert the user's question into exactly ONE valid JSON object.
Return ONLY JSON. Do not use markdown, code fences, or explanations.

The JSON must always contain a "type" field.

VALID ACTIONS:

1. For total sales by region:
{"type":"query","groupBy":["Region"],"aggregates":[{"fn":"sum","column":"Total","as":"Total Sales"}]}

2. For total sales by category:
{"type":"query","groupBy":["Category"],"aggregates":[{"fn":"sum","column":"Total","as":"Total Sales"}]}

3. For top 5 products by total sales:
{"type":"query","groupBy":["Product"],"aggregates":[{"fn":"sum","column":"Total","as":"Total Sales"}],"sort":[{"column":"Total Sales","dir":"desc"}],"limit":5}

4. For all orders from West:
{"type":"query","filters":[{"column":"Region","op":"eq","value":"West"}]}

5. For total units sold by category:
{"type":"query","groupBy":["Category"],"aggregates":[{"fn":"sum","column":"Units","as":"Total Units"}]}

6. For counting orders:
{"type":"query","aggregates":[{"fn":"count","column":"Order ID","as":"Order Count"}]}

STRICT RULES:
- Valid columns only: Order ID, Date, Region, Sales Rep, Product, Category, Units, Unit Price, Discount, Total.
- Query action keys only: type, excludeTotalsRow, filters, groupBy, aggregates, columns, sort, limit.
- Filters must use keys column, op, value. NEVER use operator.
- Filter operators: eq, neq, gt, gte, lt, lte, contains.
- Aggregates must use keys fn, column, as.
- Aggregate functions: sum, avg, count, min, max.
- Sorting must use "sort", NEVER "orderBy".
- Each sort item uses column and dir. dir must be asc or desc.
- Use groupBy when the question asks for totals grouped by a category or product.
- Use limit for top N requests.
- Never invent column names.
- If the request is unclear, return {"type":"clarify","question":"Please clarify your request."}.
- For other valid requests, construct a query using only the allowed keys.`,


  user: `Columns: Order ID, Date, Region, Sales Rep, Product, Category, Units, Unit Price, Discount, Total\nQuestion: ${dataQuestion}`
})
    const parsed = extractJsonFromResponse(response.text)

    if (!parsed.success) {
      setDataAnswer(parsed.detail || 'Could not understand the response.')
    } else {
      const checked = validateAction(parsed.data)

      if (!checked.valid) {
        setDataAnswer(checked.detail || 'Invalid response.')
      } else if (checked.action.type === 'clarify') {
        setDataAnswer(checked.action.question)
      } else if (checked.action.type === 'query') {
        const result = executeQueryPlan(engine, checked.action)
        setDataAnswer(
          result.error
            ? result.detail || result.error
            : JSON.stringify(result, null, 2)
        )
      } else {
        setDataAnswer('Formatting action is not connected yet.')
      }
    }
  } catch (error) {
    setDataAnswer(error.message || 'Something went wrong.')
  } finally {
    setIsAskingData(false)
  }
}}
  >
    Ask Your Data
  </button>
</div>

{dataAnswer && (
  <div style={{ overflowX: 'auto', marginTop: '10px' }}>
    {(() => {
      try {
        const result = JSON.parse(dataAnswer)
        if (Array.isArray(result.columns) && Array.isArray(result.rows)) {
          return (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {result.columns.map((col, i) => (
                    <th key={i} style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ border: '1px solid #ccc', padding: '8px' }}>
                        {cell ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      } catch {}
      return <pre style={{ whiteSpace: 'pre-wrap' }}>{dataAnswer}</pre>
    })()}
  </div>
)}

        {/* ── Formula Bar ── */}
        <div className="formula-bar">
          <span className="formula-bar-label">{selectedCellLabel}</span>
          <input
            className="formula-bar-input"
            value={formulaBarValue}
            onChange={(e) => handleFormulaBarChange(e.target.value)}
            onKeyDown={handleFormulaBarKeyDown}
            onFocus={handleFormulaBarFocus}
            placeholder="Select a cell then type, or enter a formula like =SUM(A1:A5)"
          />
        </div>

        {/* ── Grid ── */}
        <div
          className="grid-scroll"
          onMouseLeave={() => {
            setIsDraggingSelection(false)
          }}
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="col-header-blank" onClick={handleCornerHeaderClick} title="Select all cells"></th>
                {Array.from({ length: engine.cols }, (_, colIndex) => (
                  <th
                    key={colIndex}
                    className="col-header"
                    onClick={(e) => handleColumnHeaderClick(e, colIndex)}
                    title={`Select column ${getColumnLabel(colIndex)}`}
                  >
                    {getColumnLabel(colIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: engine.rows }, (_, rowIndex) => (
                <tr
  key={rowIndex}
  style={{
    display:
      filterText.trim() &&
      rowIndex > 0 &&
      !String(engine.getCell(rowIndex, filterColumn)?.raw ?? '')
        .toLowerCase()
        .includes(filterText.trim().toLowerCase())
        ? 'none'
        : undefined,
  }}
>
                  <td
                    className="row-header"
                    onClick={(e) => handleRowHeaderClick(e, rowIndex)}
                    title={`Select row ${rowIndex + 1}`}
                  >
                    {rowIndex + 1}
                  </td>
                  {Array.from({ length: engine.cols }, (_, colIndex) => {
                    const isSelected =
                      selectedCell?.r === rowIndex &&
                      selectedCell?.c === colIndex

                    const isInRange =
                      normalizedRange !== null &&
                      rowIndex >= normalizedRange.minRow &&
                      rowIndex <= normalizedRange.maxRow &&
                      colIndex >= normalizedRange.minCol &&
                      colIndex <= normalizedRange.maxCol

                    const isEditing =
                      editingCell?.r === rowIndex &&
                      editingCell?.c === colIndex

                    const isHandleCell =
                      normalizedRange !== null &&
                      rowIndex === normalizedRange.maxRow &&
                      colIndex === normalizedRange.maxCol

                    const isInFillPreview =
                      fillPreviewRange !== null &&
                      rowIndex >= fillPreviewRange.minRow &&
                      rowIndex <= fillPreviewRange.maxRow &&
                      colIndex >= fillPreviewRange.minCol &&
                      colIndex <= fillPreviewRange.maxCol

                    const cellData = engine.getCell(rowIndex, colIndex)
                    const style = cellStyles[`${rowIndex},${colIndex}`] || cellData.style || {}

                    const displayValue = cellData.error
                      ? cellData.error
                      : cellData.computed !== null && cellData.computed !== undefined
                        ? String(cellData.computed)
                        : cellData.raw

                    return (
                      <td
                        key={colIndex}
                        className={`cell ${isSelected ? 'selected' : ''} ${
                          isInRange ? 'range-selected' : ''
                        } ${isInFillPreview ? 'fill-target-preview' : ''}`}
                        style={{ background: style.bg || 'white' }}
                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, colIndex)}
                        onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
                        onMouseEnter={() => {
                          if (fillStart) {
                            setFillTarget({ row: rowIndex, col: colIndex })
                          } else if (isDraggingSelection) {
                            setSelectionRange((prev) =>
                              prev
                                ? { ...prev, endRow: rowIndex, endCol: colIndex }
                                : {
                                    startRow: rowIndex,
                                    startCol: colIndex,
                                    endRow: rowIndex,
                                    endCol: colIndex,
                                  }
                            )
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="cell-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(rowIndex, colIndex)}
                            onKeyDown={(e) => handleEditingKeyDown(e, rowIndex, colIndex)}
                            ref={isSelected ? cellInputRef : undefined}
                            style={{
                              fontWeight: style.bold ? 'bold' : 'normal',
                              fontStyle: style.italic ? 'italic' : 'normal',
                              textDecoration: style.underline ? 'underline' : 'none',
                              color: style.color || '#202124',
                              fontSize: (style.fontSize || 13) + 'px',
                              textAlign: style.align || 'left',
                              background: style.bg || 'white',
                            }}
                          />
                        ) : (
                          <div
                            className={`cell-display align-${style.align || 'left'} ${
                              cellData.error ? 'error' : ''
                            }`}
                            style={{
                              fontWeight: style.bold ? 'bold' : 'normal',
                              fontStyle: style.italic ? 'italic' : 'normal',
                              textDecoration: style.underline ? 'underline' : 'none',
                              color: cellData.error
                                ? '#d93025'
                                : style.color || '#202124',
                              fontSize: (style.fontSize || 13) + 'px',
                            }}
                          >
                            {displayValue}
                            {isHandleCell && !isEditing && (
                              <div
                                className="fill-handle"
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()

                                  if (!effectiveRange) return

                                  setFillStart({
                                    startRow: Math.min(effectiveRange.startRow, effectiveRange.endRow),
                                    startCol: Math.min(effectiveRange.startCol, effectiveRange.endCol),
                                    endRow: Math.max(effectiveRange.startRow, effectiveRange.endRow),
                                    endCol: Math.max(effectiveRange.startCol, effectiveRange.endCol),
                                  })

                                  setIsDraggingSelection(false)
                                }}
                              />
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="footer-hint">
          Click a cell to select · Double-click, Enter, F2, or type to edit · Drag or Shift+Arrows to select range · Formulas: =A1+B1 · =SUM(A1:A5)
        </p>
      </div>
    </div>
  )
}
