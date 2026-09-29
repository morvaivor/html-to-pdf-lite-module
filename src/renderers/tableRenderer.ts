import { parseInlineStyle, EMPTY_INLINE_STYLE } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import { computedFontSize, parseLength, PT_PER_PX } from '../core/cssLength.js';
import { applyMarginBottom, applyMarginTop } from '../core/blockFlow.js';
import { lineGapFor, transformText } from './textRenderer.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';
import { gpuAccelerator } from '../gpu/gpuAccelerator.js';

function getCellText(element: Element): string {
  let result = '';
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (!child) continue;
    if (child.type === 'text') {
      result += (child as any).data ?? '';
    } else if (child.type === 'tag' && (child as Element).name !== 'table') {
      const grandChildren = (child as Element).children;
      for (let grandChildIndex = 0; grandChildIndex < grandChildren.length; grandChildIndex++) {
        const grandChild = grandChildren[grandChildIndex];
        if (grandChild && grandChild.type === 'text') {
          result += (grandChild as any).data ?? '';
        }
      }
    }
  }
  return result.trim();
}

const NO_NESTED_TABLES: readonly Element[] = Object.freeze([]);

function getCellNestedTables(element: Element): readonly Element[] {
  let tables: Element[] | null = null;
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child && child.type === 'tag' && (child as Element).name === 'table') {
      (tables ??= []).push(child as Element);
    }
  }
  return tables ?? NO_NESTED_TABLES;
}

/**
 * Cell styles shared across cells with identical inherited inputs (see computed-style sharing in the
 * element registry): keyed by the identities of the parent, section, row and cell styles and the tag.
 */
const _cellStyleCache = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, WeakMap<object, Map<string, TextStyle>>>>
>();

function resolveCellStyle(
  parentStyle: TextStyle,
  sectionInlineStyle: Partial<TextStyle>,
  rowInlineStyle: Partial<TextStyle>,
  cellInlineStyle: Partial<TextStyle>,
  cellName: string,
): TextStyle {
  let bySection = _cellStyleCache.get(parentStyle);
  if (bySection === undefined) {
    bySection = new WeakMap();
    _cellStyleCache.set(parentStyle, bySection);
  }
  let byRow = bySection.get(sectionInlineStyle);
  if (byRow === undefined) {
    byRow = new WeakMap();
    bySection.set(sectionInlineStyle, byRow);
  }
  let byCell = byRow.get(rowInlineStyle);
  if (byCell === undefined) {
    byCell = new WeakMap();
    byRow.set(rowInlineStyle, byCell);
  }
  let byName = byCell.get(cellInlineStyle);
  if (byName === undefined) {
    byName = new Map();
    byCell.set(cellInlineStyle, byName);
  }
  let cellStyle = byName.get(cellName);
  if (cellStyle === undefined) {
    const inheritedBg =
      cellInlineStyle.backgroundColor || rowInlineStyle.backgroundColor || sectionInlineStyle.backgroundColor;
    const inheritedColor =
      cellInlineStyle.color || rowInlineStyle.color || sectionInlineStyle.color || parentStyle.color;

    cellStyle = {
      ...parentStyle,
      ...sectionInlineStyle,
      ...rowInlineStyle,
      ...cellInlineStyle,
      backgroundColor: inheritedBg,
      color: inheritedColor,
      // Relative sizes cascade: section, then row, then cell.
      fontSize: computedFontSize(
        cellInlineStyle,
        computedFontSize(rowInlineStyle, computedFontSize(sectionInlineStyle, parentStyle.fontSize)),
      ),
      fontSizeScale: undefined,
      bold: cellName === 'th' || cellInlineStyle.bold || rowInlineStyle.bold || parentStyle.bold,
    };
    byName.set(cellName, cellStyle);
  }
  return cellStyle;
}

interface InlineRun {
  text: string;
  style: TextStyle;
}

const INLINE_FORMATTING_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'span',
  'a',
  'small',
  'code',
  'u',
  'sub',
  'sup',
  'mark',
]);

const _tableTextStyleCache = new WeakMap<object, WeakMap<object, TextStyle>>();

/** Parent style extended with the table's own inherited (typographic) properties. */
function tableTextStyle(parentStyle: TextStyle, tableStyle: Partial<TextStyle>): TextStyle {
  let byTable = _tableTextStyleCache.get(parentStyle);
  if (byTable === undefined) {
    byTable = new WeakMap();
    _tableTextStyleCache.set(parentStyle, byTable);
  }
  let style = byTable.get(tableStyle);
  if (style === undefined) {
    style = {
      ...parentStyle,
      fontFamily: tableStyle.fontFamily ?? parentStyle.fontFamily,
      color: tableStyle.color ?? parentStyle.color,
      fontSize: computedFontSize(tableStyle, parentStyle.fontSize),
      bold: tableStyle.bold ?? parentStyle.bold,
      italic: tableStyle.italic ?? parentStyle.italic,
      lineHeight: tableStyle.lineHeight ?? parentStyle.lineHeight,
      letterSpacing: tableStyle.letterSpacing ?? parentStyle.letterSpacing,
      textAlign: tableStyle.textAlign ?? parentStyle.textAlign,
      textTransform: tableStyle.textTransform ?? parentStyle.textTransform,
    };
    byTable.set(tableStyle, style);
  }
  return style;
}

interface CellBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface CellBorder {
  /** Uniform border drawn as a rectangle, or null when sides differ. */
  uniform: { width: number; color: string } | null;
  sides: Array<{ side: 'top' | 'right' | 'bottom' | 'left'; width: number; color: string }>;
}

function cellPadding(cellInline: Partial<TextStyle>, defaultPadding: number): CellBox {
  const all = cellInline.padding ?? defaultPadding;
  return {
    top: cellInline.paddingTop ?? all,
    right: cellInline.paddingRight ?? all,
    bottom: cellInline.paddingBottom ?? all,
    left: cellInline.paddingLeft ?? all,
  };
}

/** Border of a cell: its own CSS borders when it declares any, otherwise the legacy table border. */
function cellBorder(cellInline: Partial<TextStyle>, tableBorder: { width: number; color: string } | null): CellBorder {
  const declared =
    cellInline.borderWidth !== undefined ||
    cellInline.borderTopWidth !== undefined ||
    cellInline.borderRightWidth !== undefined ||
    cellInline.borderBottomWidth !== undefined ||
    cellInline.borderLeftWidth !== undefined;
  if (!declared) return { uniform: tableBorder && tableBorder.width > 0 ? tableBorder : null, sides: [] };

  const fallbackColor = cellInline.borderColor ?? '#000000';
  const sides = (
    [
      ['top', cellInline.borderTopWidth, cellInline.borderTopColor],
      ['right', cellInline.borderRightWidth, cellInline.borderRightColor],
      ['bottom', cellInline.borderBottomWidth, cellInline.borderBottomColor],
      ['left', cellInline.borderLeftWidth, cellInline.borderLeftColor],
    ] as const
  ).map(([side, width, color]) => ({
    side,
    width: width ?? cellInline.borderWidth ?? 0,
    color:
      cellInline.borderColor && cellInline.borderWidth !== undefined
        ? cellInline.borderColor
        : (color ?? fallbackColor),
  }));
  const first = sides[0] as (typeof sides)[number];
  if (sides.every((s) => s.width === first.width && s.color === first.color)) {
    return { uniform: first.width > 0 ? { width: first.width, color: first.color } : null, sides: [] };
  }
  return { uniform: null, sides: sides.filter((s) => s.width > 0) };
}

interface CellData {
  text: string;
  textHeight: number;
  style: TextStyle;
  /** Style used for the cell text (the single inline wrapper's style, e.g. `<b>`, when there is one). */
  textStyle: TextStyle;
  /** Inline runs with differing styles, rendered as continued text (left-aligned cells only). */
  runs?: InlineRun[];
  padding: CellBox;
  border: CellBorder;
  /** 0 = top, 0.5 = middle, 1 = bottom. */
  verticalFactor: number;
  /** Height of the content box (text, children or badge), excluding padding. */
  contentHeight: number;
  fontSize: number;
  fontFamily: string;
  height: number;
  colspan: number;
  rowspan: number;
  nestedTables: readonly Element[];
  rawCell: Element;
  startRow: number;
  startCol: number;
  hasComplexChildren: boolean;
  badgeTag?: Element;
}

export async function renderTable(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
  renderElementFn: (
    doc: PDFKit.PDFDocument,
    element: any,
    parentStyle: TextStyle,
    options: RenderOptions,
    layout: PageLayout,
    textCache: TextMeasureCache,
    fontAliasSet: Set<string>,
    imageCache: Map<string, Buffer>,
  ) => Promise<void>,
  estimateHeightFn?: (
    doc: PDFKit.PDFDocument,
    element: Element,
    parentStyle: TextStyle,
    width: number,
    textCache: TextMeasureCache,
    fontAliasSet: Set<string>,
  ) => number,
  collectRunsFn?: (element: Element, parentStyle: TextStyle) => InlineRun[],
): Promise<void> {
  const tableStyle = parseInlineStyle(element);
  const baseStyle = tableTextStyle(parentStyle, tableStyle);

  const defaultPadding = tableStyle.padding ?? 4;
  const defaultBorder = tableStyle.border || null;
  const defaultBorderColor = tableStyle.borderColor || '#000000';
  const defaultBorderWidth = tableStyle.borderWidth ?? 1;

  const allRows: Element[] = [];
  const rowIsThead: boolean[] = [];
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child && child.type === 'tag') {
      const el = child as Element;
      if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
        for (let grandChildIndex = 0; grandChildIndex < el.children.length; grandChildIndex++) {
          const grandChild = el.children[grandChildIndex];
          if (grandChild && grandChild.type === 'tag' && (grandChild as Element).name === 'tr') {
            allRows.push(grandChild as Element);
            rowIsThead.push(el.name === 'thead');
          }
        }
      } else if (el.name === 'tr') {
        allRows.push(el);
        rowIsThead.push(false);
      }
    }
  }

  if (allRows.length === 0) return;

  let theadCount = 0;
  while (theadCount < rowIsThead.length && rowIsThead[theadCount]) {
    theadCount++;
  }

  // Single-pass extraction of rowCells and calculation of maxCols
  let maxCols = 0;
  const rowCells: Element[][] = [];
  for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
    const cells: Element[] = [];
    let cols = 0;
    const row = allRows[rowIndex];
    if (row) {
      for (let colIndex = 0; colIndex < row.children.length; colIndex++) {
        const cell = row.children[colIndex];
        if (cell && cell.type === 'tag' && ((cell as Element).name === 'td' || (cell as Element).name === 'th')) {
          cells.push(cell as Element);
          cols += parseInt((cell as Element).attribs['colspan'] || '1', 10);
        }
      }
    }
    if (cols > maxCols) maxCols = cols;
    rowCells.push(cells);
  }

  // Calcul précis des largeurs individuelles des colonnes
  const explicitColWidths: (number | null)[] = Array.from({ length: maxCols }, () => null);

  for (const cells of rowCells) {
    let cIdx = 0;
    for (const el of cells) {
      const cs = parseInt(el.attribs['colspan'] || '1', 10);
      if (cs === 1 && cIdx < maxCols && explicitColWidths[cIdx] === null) {
        const cStyle = parseInlineStyle(el);
        const rawW = cStyle.width || el.attribs['width'];
        if (rawW) {
          const strW = String(rawW).trim();
          if (strW.endsWith('%')) {
            explicitColWidths[cIdx] = (parseFloat(strW) / 100) * layout.contentWidth;
          } else {
            const width = parseLength(strW);
            if (width !== undefined && width > 0) explicitColWidths[cIdx] = width;
          }
        }
      }
      cIdx += cs;
    }
  }

  const hasAnyExplicit = explicitColWidths.some((w) => w !== null);
  let colWidths: number[];
  if (hasAnyExplicit) {
    let allocated = 0;
    let unallocatedCount = 0;
    for (let c = 0; c < maxCols; c++) {
      if (explicitColWidths[c] !== null) {
        allocated += explicitColWidths[c]!;
      } else {
        unallocatedCount++;
      }
    }
    const remaining = Math.max(10, layout.contentWidth - allocated);
    const perUnallocated = unallocatedCount > 0 ? remaining / unallocatedCount : 0;
    colWidths = explicitColWidths.map((w) => (w !== null ? w : perUnallocated));
  } else {
    const defaultW = layout.contentWidth / maxCols;
    colWidths = Array(maxCols).fill(defaultW);
  }

  const borderWidth = defaultBorder ? defaultBorderWidth : 0;
  const tableBorder = defaultBorder ? { width: defaultBorderWidth, color: defaultBorderColor } : null;

  // Precompute column prefix sums for O(1) cell X and width calculations (Patch 05)
  const columnX: number[] = [layout.leftMargin];
  for (let c = 0; c < maxCols; c++) {
    columnX.push((columnX[c] ?? layout.leftMargin) + (colWidths[c] ?? 0));
  }
  const colX = (col: number): number => columnX[col] ?? layout.leftMargin;

  {
    // Matrice 2D pour résoudre les positions des cellules en gérant colspan et rowspan
    const gridCells: (CellData | null)[][] = [];

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      const data: (CellData | null)[] = [];
      for (let c = 0; c < maxCols; c++) data.push(null);
      // Étape 1 : Propager les cellules des lignes précédentes qui ont un rowspan actif
      if (rowIdx > 0) {
        for (let col = 0; col < maxCols; col++) {
          const prevCell = gridCells[rowIdx - 1]?.[col];
          if (prevCell && prevCell.startRow < rowIdx && prevCell.startRow + prevCell.rowspan > rowIdx) {
            data[col] = prevCell;
          }
        }
      }
      let col = 0;
      const currentCells = rowCells[rowIdx] ?? [];
      const currentRow = allRows[rowIdx];
      const rowInlineStyle = currentRow ? parseInlineStyle(currentRow) : EMPTY_INLINE_STYLE;
      const parentSection =
        currentRow?.parent && (currentRow.parent as any).type === 'tag' ? (currentRow.parent as Element) : null;
      const sectionInlineStyle = parentSection ? parseInlineStyle(parentSection) : EMPTY_INLINE_STYLE;

      // Étape 2 : Placer chaque cellule dans la première colonne libre
      for (const cell of currentCells) {
        while (col < maxCols && data[col] !== null) col++;
        if (col >= maxCols) break;
        const colspan = Math.min(parseInt(cell.attribs['colspan'] || '1', 10), maxCols - col);
        const rowspan = Math.max(1, Math.min(parseInt(cell.attribs['rowspan'] || '1', 10), allRows.length - rowIdx));

        const cellInline = parseInlineStyle(cell);
        const cellStyle = resolveCellStyle(baseStyle, sectionInlineStyle, rowInlineStyle, cellInline, cell.name);

        const padding = cellPadding(cellInline, defaultPadding);
        const border = cellBorder(cellInline, tableBorder);
        const verticalAlign =
          cellInline.verticalAlign ?? rowInlineStyle.verticalAlign ?? sectionInlineStyle.verticalAlign ?? 'middle';
        const verticalFactor = verticalAlign === 'middle' ? 0.5 : verticalAlign === 'bottom' ? 1 : 0;

        // O(1) cell width using precomputed prefix sums
        const currentCellWidth = colX(col + colspan) - colX(col);
        const textWidth = Math.max(10, currentCellWidth - padding.left - padding.right);

        const childTags = cell.children.filter((c: any) => c.type === 'tag') as Element[];
        const hasComplexChildren = childTags.some(
          (c) => c.name === 'div' || c.name === 'p' || c.name === 'svg' || c.name === 'img',
        );

        const badgeTag = !hasComplexChildren
          ? childTags.find((c) => {
              const s = parseInlineStyle(c);
              return Boolean(s.backgroundColor || s.border || s.borderWidth);
            })
          : undefined;

        // Inline formatting (<b>, <span style="…">) is honored: a single wrapper style becomes the text
        // style, differing styles are kept as runs (left-aligned cells).
        let textStyle = cellStyle;
        let runs: InlineRun[] | undefined;
        if (
          collectRunsFn &&
          childTags.length > 0 &&
          !hasComplexChildren &&
          !badgeTag &&
          childTags.every((c) => INLINE_FORMATTING_TAGS.has(c.name))
        ) {
          const collected = collectRunsFn(cell, cellStyle);
          const styled = collected.filter((r) => r.text.trim() !== '');
          const first = styled[0];
          if (first && styled.every((r) => r.style === first.style)) {
            textStyle = first.style;
          } else if (styled.length > 1 && (!cellStyle.textAlign || cellStyle.textAlign === 'left')) {
            runs = collected;
          }
        }

        const fontFamily = resolveFontFamily(textStyle.fontFamily, textStyle.bold, textStyle.italic, fontAliasSet);
        const fontSize = textStyle.fontSize;
        const lineGap = lineGapFor(textStyle);

        const text = transformText(getCellText(cell), textStyle);
        const textHeight = text
          ? textCache.measure(doc, text, fontFamily, fontSize, textWidth, lineGap, textStyle.letterSpacing)
          : 0;

        let complexChildrenHeight = 0;
        if (hasComplexChildren && estimateHeightFn) {
          // Same estimator as the other block layouts, so the row fits what the children will render.
          for (const child of cell.children) {
            if (child.type === 'tag') {
              if ((child as Element).name !== 'table') {
                complexChildrenHeight += estimateHeightFn(
                  doc,
                  child as Element,
                  cellStyle,
                  textWidth,
                  textCache,
                  fontAliasSet,
                );
              }
            } else if (child.type === 'text' && (child as any).data?.trim()) {
              complexChildrenHeight += textCache.measure(
                doc,
                (child as any).data.trim(),
                fontFamily,
                fontSize,
                textWidth,
                lineGap,
              );
            }
          }
        } else if (hasComplexChildren) {
          for (const el of childTags) {
            if (el.name === 'svg' || el.name === 'img') {
              const h = parseLength(el.attribs['height']) || 90 * PT_PER_PX;
              complexChildrenHeight += h + 8;
            } else if (el.name === 'div' || el.name === 'p') {
              const cTxt = getCellText(el);
              if (cTxt) {
                const cStyle = parseInlineStyle(el);
                const cFont = resolveFontFamily(
                  cStyle.fontFamily || fontFamily,
                  Boolean(cStyle.bold),
                  Boolean(cStyle.italic),
                  fontAliasSet,
                );
                const cSize = cStyle.fontSize || fontSize;
                complexChildrenHeight += textCache.measure(doc, cTxt, cFont, cSize, textWidth) + 6;
              }
            }
          }
        }

        const nestedTables = getCellNestedTables(cell);
        let nestedHeight = 0;
        for (const nestedTable of nestedTables) {
          const nestedRows: Element[] = [];
          for (let childIndex = 0; childIndex < nestedTable.children.length; childIndex++) {
            const child = nestedTable.children[childIndex];
            if (!child || child.type !== 'tag') continue;
            const el = child as Element;
            if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
              for (let grandChildIndex = 0; grandChildIndex < el.children.length; grandChildIndex++) {
                const grandChild = el.children[grandChildIndex];
                if (grandChild && grandChild.type === 'tag' && (grandChild as Element).name === 'tr') {
                  nestedRows.push(grandChild as Element);
                }
              }
            } else if (el.name === 'tr') {
              nestedRows.push(el);
            }
          }
          const nestedStyle = parseInlineStyle(nestedTable);
          const nestedPadding = nestedStyle.padding ?? defaultPadding;
          const nestedBorderWidth = nestedStyle.border ? (nestedStyle.borderWidth ?? 1) : 0;
          let calculatedNestedHeight = 0;
          for (const nestedRow of nestedRows) {
            let rowCellMaxHeight = 0;
            for (let cellIndex = 0; cellIndex < nestedRow.children.length; cellIndex++) {
              const nestedCell = nestedRow.children[cellIndex];
              if (
                nestedCell &&
                nestedCell.type === 'tag' &&
                ((nestedCell as Element).name === 'td' || (nestedCell as Element).name === 'th')
              ) {
                const nestedCellElement = nestedCell as Element;
                const nestedCellStyle = parseInlineStyle(nestedCellElement);
                const nestedCellFontSize = computedFontSize(nestedCellStyle, fontSize);
                const nestedCellText = getCellText(nestedCellElement);
                const cellPaddingHorizontal = nestedCellStyle.padding ?? nestedPadding;
                const cellFontFamily = resolveFontFamily(
                  nestedCellStyle.fontFamily,
                  Boolean(nestedCellStyle.bold || nestedCellElement.name === 'th'),
                  Boolean(nestedCellStyle.italic),
                  fontAliasSet,
                );
                rowCellMaxHeight = Math.max(
                  rowCellMaxHeight,
                  nestedCellText
                    ? textCache.measure(
                        doc,
                        nestedCellText,
                        cellFontFamily,
                        nestedCellFontSize,
                        textWidth - cellPaddingHorizontal * 2,
                      )
                    : 0,
                );
              }
            }
            calculatedNestedHeight += rowCellMaxHeight + nestedPadding * 2 + nestedBorderWidth;
          }
          nestedHeight += calculatedNestedHeight;
        }

        const contentHeight = hasComplexChildren ? complexChildrenHeight : Math.max(textHeight, fontSize);
        const cellHeight = contentHeight + padding.top + padding.bottom + nestedHeight;

        const cellData: CellData = {
          text,
          textHeight,
          style: cellStyle,
          textStyle,
          runs,
          padding,
          border,
          verticalFactor,
          contentHeight,
          fontSize,
          fontFamily,
          height: cellHeight,
          colspan,
          rowspan,
          nestedTables,
          rawCell: cell,
          startRow: rowIdx,
          startCol: col,
          hasComplexChildren,
          badgeTag,
        };
        data[col] = cellData;

        for (let spanIndex = 0; spanIndex < colspan; spanIndex++) {
          data[col + spanIndex] = cellData;
        }
        col += colspan;
      }
      gridCells[rowIdx] = data;
    }

    const totalCells = allRows.length * maxCols;
    const cellHeights = new Float32Array(totalCells);
    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      const base = rowIdx * maxCols;
      for (let col = 0; col < maxCols; col++) {
        const cell = gridCells[rowIdx]?.[col];
        if (cell && cell.startRow === rowIdx) {
          cellHeights[base + col] = cell.height / cell.rowspan;
        } else {
          cellHeights[base + col] = 0;
        }
      }
    }

    const rowHeightsTyped = await gpuAccelerator.tableRowReduce(
      cellHeights,
      allRows.length,
      maxCols,
      borderWidth > 0 ? borderWidth : 0,
      options.gpu,
    );
    const rowHeights: number[] = Array.from(rowHeightsTyped);

    // Precompute cumulative row heights for O(1) block height and cell position calculations (Patch 05)
    const rowPrefix: number[] = [0];
    for (let r = 0; r < allRows.length; r++) {
      rowPrefix.push((rowPrefix[r] ?? 0) + (rowHeights[r] ?? 0));
    }
    const rowPre = (r: number): number => rowPrefix[r] ?? 0;

    // Découpage en blocs insécables : regroupe les lignes liées par des rowspan
    // pour éviter de scinder une cellule multi-lignes au milieu d'un saut de page
    const blocks: Array<{ start: number; end: number }> = [];
    {
      let prevStart = 0;
      let blockEnd = 0;
      for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
        blockEnd = Math.max(blockEnd, rowIndex);
        for (let col = 0; col < maxCols; col++) {
          const cell = gridCells[rowIndex]?.[col];
          if (cell && cell.startRow === rowIndex) {
            blockEnd = Math.max(blockEnd, rowIndex + cell.rowspan - 1);
          }
        }
        if (rowIndex === blockEnd) {
          blocks.push({ start: prevStart, end: rowIndex });
          prevStart = rowIndex + 1;
        }
      }
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && prevStart <= lastBlock.end) {
        blocks.push({ start: prevStart, end: allRows.length - 1 });
      }
    }

    // Table-level box: own background, outer borders declared per side (the legacy `border` shorthand is
    // applied to cells instead) and vertical margins.
    const tableX = colX(0);
    const tableWidth = colX(maxCols) - tableX;
    const outerSides = tableStyle.border
      ? []
      : (
          [
            ['top', tableStyle.borderTopWidth, tableStyle.borderTopColor],
            ['right', tableStyle.borderRightWidth, tableStyle.borderRightColor],
            ['bottom', tableStyle.borderBottomWidth, tableStyle.borderBottomColor],
            ['left', tableStyle.borderLeftWidth, tableStyle.borderLeftColor],
          ] as const
        ).filter(([, width]) => width !== undefined && width > 0);
    applyMarginTop(doc, tableStyle.marginTop ?? 0);

    /**
     * Draws rows `startRow`..`endRow` from doc.y. `first` and `last` tell whether the top and bottom outer
     * borders of the table close this range.
     */
    const renderRowRange = async (startRow: number, endRow: number, first: boolean, last: boolean): Promise<void> => {
      const blockY = doc.y;
      const blockStartOffset = rowPre(startRow);
      // O(1) block height using precomputed prefix sums
      const blockHeight = rowPre(endRow + 1) - blockStartOffset;

      if (tableStyle.backgroundColor) {
        doc.fillColor(tableStyle.backgroundColor).rect(tableX, blockY, tableWidth, blockHeight).fill();
      }

      for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
        const cellY = blockY + (rowPre(rowIndex) - blockStartOffset);
        let col = 0;
        while (col < maxCols) {
          const cell = gridCells[rowIndex]?.[col];
          if (cell && cell.startRow === rowIndex) {
            // O(1) cell coordinates and width using precomputed prefix sums
            const cellX = colX(cell.startCol);
            const cellWidth = colX(cell.startCol + cell.colspan) - cellX;
            const cellEndRow = Math.min(rowIndex + cell.rowspan - 1, allRows.length - 1);
            const cellH = rowPre(cellEndRow + 1) - rowPre(rowIndex);

            if (cell.style.backgroundColor) {
              doc.fillColor(cell.style.backgroundColor).rect(cellX, cellY, cellWidth, cellH).fill();
            }
            strokeCellBorder(doc, cell.border, cellX, cellY, cellWidth, cellH);

            const textStyle = cell.textStyle;
            doc.font(cell.fontFamily).fontSize(cell.fontSize).fillColor(textStyle.color);

            const pad = cell.padding;
            const textX = cellX + pad.left;
            const textWidth = Math.max(10, cellWidth - pad.left - pad.right);
            const innerH = cellH - pad.top - pad.bottom;
            // vertical-align: distribute the free space of the row (taller siblings, rowspan) above the content
            const usedH = cell.height - pad.top - pad.bottom;
            const textY = cellY + pad.top + Math.max(0, innerH - usedH) * cell.verticalFactor;
            const lineGap = lineGapFor(textStyle);

            if (cell.hasComplexChildren) {
              const cellLayout = Object.create(layout);
              cellLayout.leftMargin = textX;
              cellLayout.contentWidth = textWidth;
              const savedX = doc.x;
              const savedY = doc.y;
              doc.x = textX;
              doc.y = textY;

              for (const child of cell.rawCell.children) {
                if (child.type === 'tag') {
                  await renderElementFn(
                    doc,
                    child as Element,
                    cell.style,
                    options,
                    cellLayout,
                    textCache,
                    fontAliasSet,
                    imageCache,
                  );
                } else if (child.type === 'text' && (child as any).data?.trim()) {
                  doc.font(cell.fontFamily).fontSize(cell.fontSize).fillColor(textStyle.color);
                  const align = cell.style.textAlign || 'left';
                  doc.text((child as any).data.trim(), textX, doc.y, { width: textWidth, align, lineGap });
                }
              }
              doc.x = savedX;
              doc.y = savedY;
            } else if (cell.badgeTag) {
              const badgeTag = cell.badgeTag;
              const bStyleRaw = parseInlineStyle(badgeTag);
              const bText = getCellText(badgeTag);
              const bStyle: TextStyle = {
                ...cell.style,
                fontSize: computedFontSize(bStyleRaw, cell.style.fontSize),
                ...bStyleRaw,
              };
              const bFont = resolveFontFamily(bStyle.fontFamily, bStyle.bold, bStyle.italic, fontAliasSet);
              doc.font(bFont).fontSize(bStyle.fontSize);
              const padL = bStyle.paddingLeft ?? bStyle.padding ?? 4;
              const padR = bStyle.paddingRight ?? bStyle.padding ?? 4;
              const padT = bStyle.paddingTop ?? bStyle.padding ?? 2;
              const padB = bStyle.paddingBottom ?? bStyle.padding ?? 2;
              const badgeW = padL + doc.widthOfString(bText) + padR;
              const badgeH = padT + bStyle.fontSize + padB;

              let badgeX = textX;
              if (cell.style.textAlign === 'center') {
                badgeX = cellX + (cellWidth - badgeW) / 2;
              } else if (cell.style.textAlign === 'right') {
                badgeX = cellX + cellWidth - pad.right - badgeW;
              }

              const badgeY = cellY + pad.top + (innerH - badgeH) * cell.verticalFactor;

              if (bStyle.backgroundColor) {
                doc.fillColor(bStyle.backgroundColor);
                if (bStyle.borderRadius && bStyle.borderRadius > 0) {
                  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, bStyle.borderRadius).fill();
                } else {
                  doc.rect(badgeX, badgeY, badgeW, badgeH).fill();
                }
              }
              if (bStyle.borderWidth && bStyle.borderColor) {
                doc
                  .strokeColor(bStyle.borderColor)
                  .lineWidth(bStyle.borderWidth)
                  .rect(badgeX, badgeY, badgeW, badgeH)
                  .stroke();
              }
              const badgeTextOpts: PDFKit.Mixins.TextOptions = { lineBreak: false };
              if (bStyle.textDecoration === 'underline') badgeTextOpts.underline = true;
              else if (bStyle.textDecoration === 'line-through') badgeTextOpts.strike = true;
              doc.fillColor(bStyle.color || cell.style.color).text(bText, badgeX + padL, badgeY + padT, badgeTextOpts);
            } else if (cell.runs) {
              for (let runIndex = 0; runIndex < cell.runs.length; runIndex++) {
                const run = cell.runs[runIndex] as InlineRun;
                const runFont = resolveFontFamily(run.style.fontFamily, run.style.bold, run.style.italic, fontAliasSet);
                doc.font(runFont).fontSize(run.style.fontSize).fillColor(run.style.color);
                const runOpts = textOptionsFor(run.style, textWidth, lineGap);
                runOpts.continued = runIndex < cell.runs.length - 1;
                const runText = transformText(run.text, run.style);
                if (runIndex === 0) doc.text(runText, textX, textY, runOpts);
                else doc.text(runText, runOpts);
              }
            } else if (cell.text) {
              const cellTextOpts = textOptionsFor(textStyle, textWidth, lineGap);
              if (cell.style.textAlign === 'center') cellTextOpts.align = 'center';
              else if (cell.style.textAlign === 'right') cellTextOpts.align = 'right';
              doc.text(cell.text, textX, textY, cellTextOpts);
            }

            if (cell.nestedTables.length > 0) {
              const savedX = doc.x;
              const savedY = doc.y;
              // Nested tables are laid out in the content box of their cell.
              const nestedLayout = Object.create(layout) as PageLayout;
              Object.assign(nestedLayout, { leftMargin: textX, contentWidth: textWidth });
              doc.x = textX;
              doc.y = cellY + pad.top;
              for (const nestedTable of cell.nestedTables) {
                await renderElementFn(
                  doc,
                  nestedTable,
                  cell.style,
                  options,
                  nestedLayout,
                  textCache,
                  fontAliasSet,
                  imageCache,
                );
              }
              doc.x = savedX;
              doc.y = savedY;
            }

            col += cell.colspan;
          } else {
            col++;
          }
        }
      }

      for (const [side, width, color] of outerSides) {
        const bottom = blockY + blockHeight;
        if (side === 'top' && !first) continue;
        if (side === 'bottom' && !last) continue;
        doc.strokeColor(color ?? tableStyle.borderColor ?? '#000000').lineWidth(width as number);
        if (side === 'top')
          doc
            .moveTo(tableX, blockY)
            .lineTo(tableX + tableWidth, blockY)
            .stroke();
        else if (side === 'bottom')
          doc
            .moveTo(tableX, bottom)
            .lineTo(tableX + tableWidth, bottom)
            .stroke();
        else if (side === 'left') doc.moveTo(tableX, blockY).lineTo(tableX, bottom).stroke();
        else
          doc
            .moveTo(tableX + tableWidth, blockY)
            .lineTo(tableX + tableWidth, bottom)
            .stroke();
      }

      doc.y = blockY + blockHeight;
    };

    const newPage = (): void => {
      doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
      doc.y = layout.contentTop;
      doc.x = layout.leftMargin;
    };
    const blockHeightOf = (block: { start: number; end: number }): number =>
      rowPre(block.end + 1) - rowPre(block.start);

    // The <thead> rows repeat at the top of every page the table continues on, as browsers print a
    // table-header-group. They must form whole blocks (no rowspan into the body).
    let headBlockCount = 0;
    while (headBlockCount < blocks.length && (blocks[headBlockCount] as { end: number }).end < theadCount) {
      headBlockCount++;
    }
    const repeatHead =
      theadCount > 0 &&
      theadCount < allRows.length &&
      headBlockCount > 0 &&
      (blocks[headBlockCount - 1] as { end: number }).end === theadCount - 1;
    const bodyBlocks = repeatHead ? blocks.slice(headBlockCount) : blocks;

    if (repeatHead) {
      // Keep the header with the first body rows.
      const headHeight = rowPre(theadCount) - rowPre(0);
      const firstBody = bodyBlocks[0] as { start: number; end: number };
      if (doc.y > layout.contentTop && doc.y + headHeight + blockHeightOf(firstBody) > layout.pageBottom) newPage();
      await renderRowRange(0, theadCount - 1, true, false);
    }
    for (let blockIndex = 0; blockIndex < bodyBlocks.length; blockIndex++) {
      const block = bodyBlocks[blockIndex] as { start: number; end: number };
      if (doc.y + blockHeightOf(block) > layout.pageBottom) {
        newPage();
        if (repeatHead) await renderRowRange(0, theadCount - 1, true, false);
      }
      await renderRowRange(
        block.start,
        block.end,
        !repeatHead && blockIndex === 0,
        blockIndex === bodyBlocks.length - 1,
      );
    }

    applyMarginBottom(doc, tableStyle.marginBottom ?? 0);
  }
}

function textOptionsFor(style: TextStyle, width: number, lineGap: number): PDFKit.Mixins.TextOptions {
  const opts: PDFKit.Mixins.TextOptions = { width, lineGap };
  if (style.letterSpacing !== undefined) opts.characterSpacing = style.letterSpacing;
  if (style.textDecoration === 'underline') opts.underline = true;
  else if (style.textDecoration === 'line-through') opts.strike = true;
  return opts;
}

function strokeCellBorder(doc: PDFKit.PDFDocument, border: CellBorder, x: number, y: number, w: number, h: number) {
  if (border.uniform) {
    doc.strokeColor(border.uniform.color).lineWidth(border.uniform.width).rect(x, y, w, h).stroke();
    return;
  }
  for (const { side, width, color } of border.sides) {
    doc.strokeColor(color).lineWidth(width);
    if (side === 'top')
      doc
        .moveTo(x, y)
        .lineTo(x + w, y)
        .stroke();
    else if (side === 'bottom')
      doc
        .moveTo(x, y + h)
        .lineTo(x + w, y + h)
        .stroke();
    else if (side === 'left')
      doc
        .moveTo(x, y)
        .lineTo(x, y + h)
        .stroke();
    else
      doc
        .moveTo(x + w, y)
        .lineTo(x + w, y + h)
        .stroke();
  }
}
