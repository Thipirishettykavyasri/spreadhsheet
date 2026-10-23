# Design notes

Fill this in as you work. Keep it factual and short; bullet points are fine. Graders read this before your code.

## Challenges

- Challenge 1 — Range selection and fill handle:
  - Implemented pure engine module `src/engine/fill.js` handling series extrapolation across all required data types.
  - Added support for numeric series: single seed copies, 2+ seeds extend arithmetic progression (including decimals, non-unit steps, and backward filling).
  - Added support for text ending in numbers (e.g. `ORD-1001` to `ORD-1002`, `Item 1`, `Item 01`, `Q4`, `2024-W01`), preserving zero padding.
  - Added support for dates in ISO (`YYYY-MM-DD`), US slash (`M/D/YYYY`), and Day-Month-Year (`D MMM YYYY`) formats, preserving seed formats cyclically and stepping by the seed delta in days.
  - Added weekday and month name cycling (`Mon -> Tue`, `Jan -> Feb`), preserving case (UPPERCASE, lowercase, Titlecase).
  - Added formula reference shifting that preserves absolute pinned coordinates (`$A$1`, `$A1`, `A$1`) while adjusting relative coordinates horizontally and vertically.
  - Added style inheritance: filled cells inherit seed cell styles.
  - Added shrink fill support: dragging back clears shrunk cells.
  - Positioned fill handle at the bottom-right corner of the active multi-cell or single-cell selection.
  - Single click selects without entering edit mode; double-click, Enter, F2, or typing printable characters enters edit mode.
  - Mouse dragging selects a rectangular range in any direction (up, down, left, right).
  - Shift+Click and Shift+Arrow keys extend selection from anchor cell.
  - Row and column header clicks select entire rows/columns; corner header selects entire grid.
  - Ctrl+A selects the used range.
  - Formatting actions (bold, italic, underline, font size, align, font color, background color) apply to the entire selected range in one undo step.
  - Delete and Backspace keys clear all selected cells and their formatting in one undo step.
  - Added global `Ctrl+Z` / `Ctrl+Y` shortcuts and one-step undo/redo for fill handle and clear operations.

## Data model changes

- Added `style` object to engine cell representations in `src/engine/core.js`.
- Bulk mutations and snapshots preserve both `raw` value and `style`, enabling one-step undo to restore prior values and styles simultaneously.

## Engine API

- `setCells(changes)`: `(Array<{ row, col, value, style? }>) => boolean` — applies a bulk batch of cell edits with a single recalculation step; one undo reverts the entire batch.
- `fill(sourceRange, targetRange, getCellStyle?)`: `(Range, Coord|Range, Function?) => boolean` — extrapolates values and styles from source to target range based on detected series patterns; one undo reverts all filled or cleared cells.
- `clearRange(range)`: `(Range) => boolean` — clears all values and styles across a rectangular range; one undo reverts the clear.
- `setRangeStyle(range, styleUpdates)`: `(Range, object) => boolean` — applies styling updates across all cells in a rectangular range; one undo reverts the styling changes.
- `getUsedRange()`: `() => Range` — returns bounding box `{ startRow, startCol, endRow, endCol }` covering all non-empty or styled cells for `Ctrl+A`.
- `shiftFormula(formula, rowOffset, colOffset)`: `(string, number, number) => string` — shifts relative cell references by row and column offsets while pinning absolute `$` references; purely functional.

## Undo semantics

- **Fill Handle (`engine.fill`)**: A single `Ctrl+Z` reverts all filled or cleared cells to their previous raw values and cell styles prior to the fill gesture.
- **Clear Selection (`engine.clearRange`)**: A single `Ctrl+Z` restores all cleared cells to their prior values and styles.
- **Range Formatting (`engine.setRangeStyle`)**: A single `Ctrl+Z` reverts styles across all selected cells to their previous state.
- **Bulk Set (`engine.setCells`)**: A single `Ctrl+Z` restores all modified cells to their respective previous values and styles.
- **No-op actions**: If a fill or clear operation produces no actual changes to values or styles, no entry is pushed to the undo history.

## Defects found in the existing code

1. **`tokenize` threw `#PARSE!` on formulas with absolute references (`$`):**
   - *Where*: `src/engine/core.js` in `tokenize()`.
   - *Symptom*: Formulas like `=$G$2*H2` failed to parse with `#PARSE!`.
   - *Root cause*: Character `$` was not accepted in identifier lexing and threw `Unexpected character: $`.
   - *Fix*: Allowed `$` in cell identifiers and verified against `^(\$?)([A-Z]+)(\$?)(\d+)$`.

2. **`shiftCellReferences` corrupted absolute references on structural row/col mutations:**
   - *Where*: `src/engine/core.js` in `shiftCellReferences()`.
   - *Symptom*: Inserting a row above row 10 in a sheet containing `=$G$2*H32` produced invalid references and dropped inner `$`.
   - *Root cause*: Regex `/([A-Z]+)(\d+)/g` did not capture or preserve `$` prefixes for columns or rows.
   - *Fix*: Updated regex to `/(\$?)([A-Z]+)(\$?)(\d+)/g` and preserved pinned row and column markers when reformatting shifted references.

3. **`expandCellRange` and `evaluateAST` failed on absolute references in formulas:**
   - *Where*: `src/engine/core.js` in `expandCellRange()` and `evaluateAST()`.
   - *Symptom*: Ranges like `$A$1:$A$5` or references like `$G$2` threw `#REF!` or failed key lookups.
   - *Root cause*: `expandCellRange` regex required strict `^[A-Z]+\d+$` without `$`, and `evaluateAST` looked up `$G$2` directly in the cells map instead of `G2`.
   - *Fix*: Stripped `$` when querying cell values from the engine cache/map, and allowed optional `$` in range parsing.

4. **Lint errors in `App.jsx`:**
   - *Where*: `src/App.jsx` in `handleFill`.
   - *Symptom*: `npm run lint` failed with 2 errors for unused variables (`getSeriesValue` and `first`).
   - *Root cause*: Dead draft code left in `handleFill`.
   - *Fix*: Replaced draft with clean delegation to `engine.fill()`.

## Measurements

- **Fill Handle performance budget (5,000 cells)**:
  - Budget: < 200 ms.
  - Measured: **16.5 ms** execution time for filling 5,000 cells (`ORD-1001` to `ORD-6002`) in vitest.
  - Method: `performance.now()` delta before and after `engine.fill(..., { row: 5001, col: 0 })`.
  - Machine: Windows 11, Node.js v24.21.0.

## AI (if applicable)

- Not applicable to Challenge 1.

## Trade-offs and what you would do next

- Extracted series calculation into a dedicated pure engine module `src/engine/fill.js` so it can be tested independently of the React DOM and reused cleanly in future challenges.

## Use of AI tools

- Used Antigravity coding assistant to inspect project files, identify incomplete challenges and defects, implement pure engine fill routines, fix absolute reference parsing, add unit tests, and verify lint/build/test suites.
