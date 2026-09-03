import { parseInlineStyle } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element, ChildNode } from 'domhandler';

const FONT_SIZES_TABLE: Record<string, number> = { td: 12, th: 12 };

function getCellText(element: Element): string {
  let result = '';
  for (let i = 0; i < element.children.length; i++) {
    const c = element.children[i];
    if (!c) continue;
    if (c.type === 'text') {
      result += (c as any).data ?? '';
    } else if (c.type === 'tag' && (c as Element).name !== 'table') {
      const grandChildren = (c as Element).children;
      for (let j = 0; j < grandChildren.length; j++) {
        const gc = grandChildren[j];
        if (gc && gc.type === 'text') result += (gc as any).data ?? '';
      }
    }
  }
  return result.trim();
}

function getCellNestedTables(element: Element): Element[] {
  const tables: Element[] = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child && child.type === 'tag' && (child as Element).name === 'table') {
      tables.push(child as Element);
    }
  }
  return tables;
}

function getCellNonTableChildren(element: Element): ChildNode[] {
  const children: ChildNode[] = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (!child) continue;
    if (child.type === 'tag' && (child as Element).name === 'table') continue;
    children.push(child);
  }
  return children;
}

interface CellData {
  text: string;
  style: TextStyle;
  padding: number;
  fontSize: number;
  fontFamily: string;
  height: number;
  colspan: number;
  rowspan: number;
  nestedTables: Element[];
  nonTableChildren: ChildNode[];
  rawCell: Element;
  startRow: number;
  startCol: number;
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
): Promise<void> {
  const tableStyle = parseInlineStyle(element);

  const defaultPadding = tableStyle.padding ?? 4;
  const defaultBorder = tableStyle.border || null;
  const defaultBorderColor = tableStyle.borderColor || '#000000';
  const defaultBorderWidth = tableStyle.borderWidth ?? 1;

  const allRows: Element[] = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child && child.type === 'tag') {
      const el = child as Element;
      if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
        for (let j = 0; j < el.children.length; j++) {
          const grandchild = el.children[j];
          if (grandchild && grandchild.type === 'tag' && (grandchild as Element).name === 'tr') {
            allRows.push(grandchild as Element);
          }
        }
      } else if (el.name === 'tr') {
        allRows.push(el);
      }
    }
  }

  if (allRows.length === 0) return;

  let maxCols = 0;
  for (let r = 0; r < allRows.length; r++) {
    let cols = 0;
    const row = allRows[r];
    if (!row) continue;
    for (let c = 0; c < row.children.length; c++) {
      const cell = row.children[c];
      if (cell && cell.type === 'tag' && ((cell as Element).name === 'td' || (cell as Element).name === 'th')) {
        cols += parseInt((cell as Element).attribs['colspan'] || '1', 10);
      }
    }
    if (cols > maxCols) maxCols = cols;
  }

  const colWidth = layout.contentWidth / maxCols;
  const borderWidth = defaultBorder ? defaultBorderWidth : 0;
  const borderColor = defaultBorder ? defaultBorderColor : undefined;

  {
    const rowCells: Element[][] = [];
    for (let r = 0; r < allRows.length; r++) {
      const cells: Element[] = [];
      const row = allRows[r];
      if (!row) continue;
      for (let c = 0; c < row.children.length; c++) {
        const cell = row.children[c];
        if (cell && cell.type === 'tag' && ((cell as Element).name === 'td' || (cell as Element).name === 'th')) {
          cells.push(cell as Element);
        }
      }
      rowCells.push(cells);
    }

    const gridCells: (CellData | null)[][] = [];

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      const data: (CellData | null)[] = Array.from({ length: maxCols }, () => null);
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
      for (const cell of currentCells) {
        while (col < maxCols && data[col] !== null) col++;
        if (col >= maxCols) break;
        const colspan = Math.min(parseInt(cell.attribs['colspan'] || '1', 10), maxCols - col);
        const rowspan = Math.max(1, Math.min(parseInt(cell.attribs['rowspan'] || '1', 10), allRows.length - rowIdx));

        const cellInlineStyle = parseInlineStyle(cell);
        const cellStyle: TextStyle = {
          ...parentStyle,
          ...cellInlineStyle,
          fontSize: cellInlineStyle.fontSize ?? FONT_SIZES_TABLE[cell.name] ?? parentStyle.fontSize,
          bold: cell.name === 'th' || cellInlineStyle.bold || parentStyle.bold,
        };

        const padding = cellStyle.padding ?? defaultPadding;
        const fontFamily = resolveFontFamily(cellStyle.fontFamily, cellStyle.bold, cellStyle.italic, fontAliasSet);
        const fontSize = cellStyle.fontSize;

        const text = getCellText(cell);
        const textHeight = text ? textCache.measure(doc, text, fontFamily, fontSize, colWidth - padding * 2) : 0;

        const nestedTables = getCellNestedTables(cell);
        let nestedHeight = 0;
        for (const nt of nestedTables) {
          const ntRows: Element[] = [];
          for (let ci = 0; ci < nt.children.length; ci++) {
            const child = nt.children[ci];
            if (!child || child.type !== 'tag') continue;
            const el = child as Element;
            if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
              for (let gi = 0; gi < el.children.length; gi++) {
                const gc = el.children[gi];
                if (gc && gc.type === 'tag' && (gc as Element).name === 'tr') ntRows.push(gc as Element);
              }
            } else if (el.name === 'tr') {
              ntRows.push(el);
            }
          }
          const ntStyle = parseInlineStyle(nt);
          const ntPadding = ntStyle.padding ?? defaultPadding;
          const ntBorderWidth = ntStyle.border ? (ntStyle.borderWidth ?? 1) : 0;
          let ntH = 0;
          for (const ntRow of ntRows) {
            let rh = 0;
            for (let nci = 0; nci < ntRow.children.length; nci++) {
              const ntCell = ntRow.children[nci];
              if (
                ntCell &&
                ntCell.type === 'tag' &&
                ((ntCell as Element).name === 'td' || (ntCell as Element).name === 'th')
              ) {
                const ncEl = ntCell as Element;
                const ncStyle = parseInlineStyle(ncEl);
                const ncFontSize = ncStyle.fontSize ?? fontSize;
                const ncText = getCellText(ncEl);
                const ncPh = ncStyle.padding ?? ntPadding;
                const ncFf = resolveFontFamily(
                  ncStyle.fontFamily,
                  Boolean(ncStyle.bold || ncEl.name === 'th'),
                  Boolean(ncStyle.italic),
                  fontAliasSet,
                );
                rh = Math.max(rh, ncText ? textCache.measure(doc, ncText, ncFf, ncFontSize, colWidth - ncPh * 2) : 0);
              }
            }
            ntH += rh + ntPadding * 2 + ntBorderWidth;
          }
          nestedHeight += ntH;
        }

        const cellHeight = Math.max(textHeight, fontSize) + padding * 2 + nestedHeight;

        const cellData: CellData = {
          text,
          style: cellStyle,
          padding,
          fontSize,
          fontFamily,
          height: cellHeight,
          colspan,
          rowspan,
          nestedTables,
          nonTableChildren: getCellNonTableChildren(cell),
          rawCell: cell,
          startRow: rowIdx,
          startCol: col,
        };
        data[col] = cellData;

        for (let r = 0; r < colspan; r++) {
          data[col + r] = cellData;
        }
        col += colspan;
      }
      gridCells[rowIdx] = data;
    }

    const rowHeights: number[] = allRows.map((_, rowIdx) => {
      let h = 0;
      for (let col = 0; col < maxCols; col++) {
        const cell = gridCells[rowIdx]?.[col];
        if (cell && cell.startRow === rowIdx) {
          h = Math.max(h, cell.height / cell.rowspan);
        }
      }
      return h + (borderWidth > 0 ? borderWidth : 0);
    });

    const blocks: Array<{ start: number; end: number }> = [];
    {
      let prevStart = 0;
      let blockEnd = 0;
      for (let r = 0; r < allRows.length; r++) {
        blockEnd = Math.max(blockEnd, r);
        for (let col = 0; col < maxCols; col++) {
          const cell = gridCells[r]?.[col];
          if (cell && cell.startRow === r) {
            blockEnd = Math.max(blockEnd, r + cell.rowspan - 1);
          }
        }
        if (r === blockEnd) {
          blocks.push({ start: prevStart, end: r });
          prevStart = r + 1;
        }
      }
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && prevStart <= lastBlock.end) {
        blocks.push({ start: prevStart, end: allRows.length - 1 });
      }
    }

    for (const block of blocks) {
      const blockHeight = rowHeights.slice(block.start, block.end + 1).reduce((a, b) => a + b, 0);
      if (doc.y + blockHeight > layout.pageBottom) {
        doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
        doc.y = layout.contentTop;
        doc.x = layout.leftMargin;
      }

      const blockY = doc.y;
      const rowTop: number[] = Array.from({ length: allRows.length }, () => 0);
      let offset = 0;
      for (let r = block.start; r <= block.end; r++) {
        rowTop[r] = blockY + offset;
        offset += rowHeights[r] ?? 0;
      }

      for (let r = block.start; r <= block.end; r++) {
        let col = 0;
        while (col < maxCols) {
          const cell = gridCells[r]?.[col];
          if (cell && cell.startRow === r) {
            const cellWidth = colWidth * cell.colspan;
            const cellX = layout.leftMargin + cell.startCol * colWidth;
            const cellY = rowTop[r] ?? 0;
            const endRow = Math.min(r + cell.rowspan - 1, allRows.length - 1);
            const cellH = (rowTop[endRow] ?? 0) + (rowHeights[endRow] ?? 0) - cellY;

            if (cell.style.backgroundColor) {
              doc.fillColor(cell.style.backgroundColor).rect(cellX, cellY, cellWidth, cellH).fill();
            }

            if (borderWidth > 0) {
              doc
                .strokeColor(borderColor ?? '#000000')
                .lineWidth(borderWidth)
                .rect(cellX, cellY, cellWidth, cellH)
                .stroke();
            }

            doc.font(cell.fontFamily).fontSize(cell.fontSize).fillColor(cell.style.color);

            const textX = cellX + cell.padding;
            const textY = cellY + cell.padding + cell.fontSize;
            const textWidth = cellWidth - cell.padding * 2;
            const textH = cell.text ? textCache.measure(doc, cell.text, cell.fontFamily, cell.fontSize, textWidth) : 0;

            if (cell.text && textH + cell.padding <= cellH) {
              if (cell.style.textAlign === 'center') {
                doc.text(cell.text, textX, textY, { width: textWidth, align: 'center' });
              } else if (cell.style.textAlign === 'right') {
                doc.text(cell.text, textX, textY, { width: textWidth, align: 'right' });
              } else {
                doc.text(cell.text, textX, textY, { width: textWidth });
              }
            }

            if (cell.nestedTables.length > 0) {
              const savedX = doc.x;
              const savedY = doc.y;
              doc.x = cellX;
              doc.y = cellY + cell.padding;
              for (const nt of cell.nestedTables) {
                await renderElementFn(doc, nt, cell.style, options, layout, textCache, fontAliasSet, imageCache);
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

      const endRowIdx = block.end;
      doc.y = (rowTop[endRowIdx] ?? 0) + (rowHeights[endRowIdx] ?? 0);
    }
  }
}
