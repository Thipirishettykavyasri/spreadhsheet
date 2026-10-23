# Design Notes — Spreadsheet Engineering Challenge

## Challenges

### Challenge 1 — Range Selection and Fill Handle

- Implemented range selection and fill logic in `src/engine/fill.js`.
- Supports single-cell copying and numeric series, including decimal and non-unit increments.
- Supports text-number series such as `ORD-1001`, `Item 01`, `Q4`, and `2024-W01`, preserving zero padding.
- Supports ISO, US slash, and Day-Month-Year date formats, stepping dates by the seed delta.
- Supports weekday and month cycling with case preservation.
- Supports formula translation with relative, absolute (`$A$1`), and mixed (`$A1`, `A$1`) references.
- Filled cells inherit the relevant seed styles.
- Supports fill-handle dragging in different directions and shrinking the fill by dragging back.
- Single-click selection, double-click editing, Enter, F2, typing, drag selection, Shift+Click, and Shift+Arrow are supported.
- Row and column headers select their respective ranges. Ctrl+A selects the used range.
- Formatting applies to the selected range.
- Delete and Backspace clear the selected range in one operation.
- Added Ctrl+Z and Ctrl+Y keyboard shortcuts for undo and redo.
- Verified fill-engine tests and the 5,000-cell performance test as recorded below.

### Challenge 2 — Sort and Filter

- Existing sort/filter UI and implementation require verification against the complete challenge acceptance criteria.
- Verify sorting by column in ascending and descending order.
- Verify filter dropdowns, filter conditions, and results on the deliberately messy `fixtures/sales.tsv` dataset.
- Verify that sorting and filtering preserve correct cell values, row relationships, and undo behavior.
- Record only the behaviors that pass manual or automated tests.

**Status:** Not fully verified.

### Challenge 3 — Virtualized Grid

- The existing grid and sample-data loading functionality require verification against the large-scale grid requirements.
- Required acceptance checks include 100,000 rows × 200 columns, virtualized rendering, row-height and column-width resizing, frozen rows and columns, keyboard navigation, name box, and formula bar.
- Measure scrolling and rendering performance using a production build and document the test environment and results.

**Status:** Full virtualization and performance requirements are not yet confirmed.

### Challenge 4 — Ask Your Data

- AI provider and query-execution functionality require verification against `AI_CONTRACT.md` and `fixtures/ai-eval/queries.json`.
- Verify the mock provider works without a backend.
- Verify HTTP-provider configuration, response parsing, action validation, and safe rejection of unsupported mutations.
- Test filtering, grouping, aggregation, sorting, row limits, totals-row handling, and unknown-column errors.
- Run all 20 golden prompts and record the expected answers, refusals, and actual results.
- Verify the performance budgets on the required large datasets.

**Status:** Not fully verified; resolve any failing query tests before submission.

### Challenge 5 — Format with AI

- Added AI-formatting functionality using `src/ai/formatApplier.js` and the format-action contract.
- Added or connected the prompt, preview, Apply, and Discard flow.
- Verify header, body, and totals styling; number formats; frozen rows; column widths; and auto-fit.
- Verify that formatting does not change stored cell values.
- Verify `clearFormatting`, header-style precedence, totals-row detection, column bounds, and no-op behavior against `AI_CONTRACT.md`.
- Verify formatting is undone in one Ctrl+Z operation and that styles follow row/column insertions and deletions.
- Run all 10 prompts in `fixtures/ai-eval/format-prompts.json` on `fixtures/sales.tsv` and `fixtures/sales-large.tsv`.

**Status:** Basic Apply flow has been exercised; full contract and golden-set compliance remain to be verified.

## Data Model Changes

- Added style information to engine cell representations in `src/engine/core.js`.
- Bulk mutations and snapshots are intended to preserve raw values and styles for undo/redo.
- Verify that number formatting remains separate from stored cell values and that styles follow structural row/column changes.

## Engine API

- `setCells(changes)`: Applies a batch of cell changes. Verify that the entire batch is reverted by one undo.
- `fill(sourceRange, targetRange, getCellStyle?)`: Fills a destination range using detected series patterns and seed styles.
- `clearRange(range)`: Clears values and styles in a rectangular range.
- `setRangeStyle(range, styleUpdates)`: Applies style updates to a rectangular range.
- `getUsedRange()`: Returns the bounding range of non-empty or styled cells.
- `shiftFormula(formula, rowOffset, colOffset)`: Translates relative formula references while preserving absolute row and column markers.

Document any additional engine methods introduced for sorting, filtering, query execution, formatting, virtualization, or structural changes after confirming their actual signatures in the source code.

## Undo Semantics

- **Fill:** One Ctrl+Z should restore all affected values and styles.
- **Clear selection:** One Ctrl+Z should restore cleared values and styles.
- **Range formatting:** One Ctrl+Z should restore the previous styles for the selected range.
- **Bulk set:** One Ctrl+Z should restore all affected cells.
- **Sort:** Verify that one Ctrl+Z restores the original row order and data.
- **AI Format Apply:** Verify that one Ctrl+Z restores all changes from the formatting action.
- **Insert into sheet:** Verify that one Ctrl+Z reverses the entire insertion action.
- **No-op actions:** Verify that operations making no changes do not add unnecessary undo entries.

## Defects Found in Existing Code

1. **Formula tokenizer and absolute references**
   - Location: `src/engine/core.js`, `tokenize()`.
   - Problem: Formulas containing `$` references previously produced parse errors.
   - Fix recorded: Updated cell-reference parsing to allow optional absolute column and row markers.

2. **Formula references during structural changes**
   - Location: `src/engine/core.js`, `shiftCellReferences()`.
   - Problem: Structural row/column changes could mishandle absolute references.
   - Fix recorded: Updated reference handling to preserve `$` markers while shifting relative coordinates.

3. **Absolute references in ranges and evaluation**
   - Location: `src/engine/core.js`, `expandCellRange()` and `evaluateAST()`.
   - Problem: Absolute references and ranges were not consistently normalized for lookup.
   - Fix recorded: Updated parsing and lookup handling for optional `$` markers.

4. **Unused variables in the fill handler**
   - Location: `src/App.jsx`.
   - Problem: Unused draft variables caused lint errors.
   - Fix recorded: Removed the unused code and delegated filling to `engine.fill()`.

## Measurements

### Fill Handle — 5,000 Cells

- Required budget: under 200 ms.
- Recorded result: 16.5 ms in the Vitest performance test.
- Measurement method: `performance.now()` before and after the fill operation.
- Test scenario: Fill a 5,000-cell range using a text-number series.
- Recorded environment: Windows 11, Node.js v24.21.0.
- Verification: Confirm the benchmark test and destination-cell assertion pass in the current checkout before treating this result as final.

### Remaining Performance Budgets

- Ask Your Data: golden plans on `sales-large.tsv` under 50 ms; two-level group-by over 100,000 generated rows under 500 ms.
- AI Format Sheet: applying formatting to `sales-large.tsv` under 300 ms.
- Virtualized Grid: measure production-build performance with 100,000 rows × 200 columns.

**Results for these remaining budgets have not been confirmed here. Do not report them as measured until the tests are run.**

## AI

- Provider implementation: `src/ai/provider.js`; verify mock mode works without a backend and HTTP mode uses the intended configuration.
- Response handling: verify JSON extraction, schema validation, unsupported-action rejection, and error reporting.
- Query evaluation: compare actual results with `fixtures/ai-eval/queries.json`.
- Formatting evaluation: compare actions and applied sheet state with `fixtures/ai-eval/format-prompts.json`.
- Record any golden-set mismatches and explain the implemented behavior.

## Trade-offs and What I Would Do Next

- Kept fill-series logic in a dedicated engine module to separate spreadsheet logic from React rendering.
- Preserve the engine's independence from React and the DOM.
- Complete and verify all five challenge acceptance criteria.
- Fix failing tests and confirm sorting, filtering, formatting, structural changes, and undo/redo.
- Measure the required performance budgets on a production build.
- Add verified results and remaining limitations to this document.

## Use of AI Tools

- Used an AI coding assistant to inspect project files, help implement fill-series behavior, investigate formula-reference issues, add tests, and troubleshoot lint/build/test errors.
- All submitted functionality and performance claims must be verified against the current code and test results.
