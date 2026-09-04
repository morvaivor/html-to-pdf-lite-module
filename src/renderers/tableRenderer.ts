import { parseInlineStyle } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element, ChildNode } from 'domhandler';

const FONT_SIZES_TABLE: Record<string, number> = { td: 12, th: 12 };

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

function getCellNestedTables(element: Element): Element[] {
  const tables: Element[] = [];
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child && child.type === 'tag' && (child as Element).name === 'table') {
      tables.push(child as Element);
    }
  }
  return tables;
}

function getCellNonTableChildren(element: Element): ChildNode[] {
  const children: ChildNode[] = [];
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
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
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child && child.type === 'tag') {
      const el = child as Element;
      if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
        for (let grandChildIndex = 0; grandChildIndex < el.children.length; grandChildIndex++) {
          const grandChild = el.children[grandChildIndex];
          if (grandChild && grandChild.type === 'tag' && (grandChild as Element).name === 'tr') {
            allRows.push(grandChild as Element);
          }
        }
      } else if (el.name === 'tr') {
        allRows.push(el);
      }
    }
  }

  if (allRows.length === 0) return;

  let maxCols = 0;
  for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
    let cols = 0;
    const row = allRows[rowIndex];
    if (!row) continue;
    for (let colIndex = 0; colIndex < row.children.length; colIndex++) {
      const cell = row.children[colIndex];
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
    for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
      const cells: Element[] = [];
      const row = allRows[rowIndex];
      if (!row) continue;
      for (let colIndex = 0; colIndex < row.children.length; colIndex++) {
        const cell = row.children[colIndex];
        if (cell && cell.type === 'tag' && ((cell as Element).name === 'td' || (cell as Element).name === 'th')) {
          cells.push(cell as Element);
        }
      }
      rowCells.push(cells);
    }

    // Matrice 2D pour résoudre les positions des cellules en gérant colspan et rowspan
    const gridCells: (CellData | null)[][] = [];

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      const data: (CellData | null)[] = Array.from({ length: maxCols }, () => null);
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
      // Étape 2 : Placer chaque cellule dans la première colonne libre
      for (const cell of currentCells) {
        while (col < maxCols && data[col] !== null) col++;
        if (col >= maxCols) break;
        const colspan = Math.min(parseInt(cell.attribs['colspan'] || '1', 10), maxCols - col);
        const rowspan = Math.max(1, Math.min(parseInt(cell.attribs['rowspan'] || '1', 10), allRows.length - rowIdx));

        const currentRow = allRows[rowIdx];
        const rowInlineStyle = currentRow ? parseInlineStyle(currentRow) : {};
        const parentSection = currentRow?.parent && (currentRow.parent as any).type === 'tag' ? (currentRow.parent as Element) : null;
        const sectionInlineStyle = parentSection ? parseInlineStyle(parentSection) : {};

        const cellInlineStyle = parseInlineStyle(cell);
        const inheritedBg = cellInlineStyle.backgroundColor || rowInlineStyle.backgroundColor || sectionInlineStyle.backgroundColor;
        const inheritedColor = cellInlineStyle.color || rowInlineStyle.color || sectionInlineStyle.color || parentStyle.color;

        const cellStyle: TextStyle = {
          ...parentStyle,
          ...sectionInlineStyle,
          ...rowInlineStyle,
          ...cellInlineStyle,
          backgroundColor: inheritedBg,
          color: inheritedColor,
          fontSize: cellInlineStyle.fontSize ?? FONT_SIZES_TABLE[cell.name] ?? parentStyle.fontSize,
          bold: cell.name === 'th' || cellInlineStyle.bold || rowInlineStyle.bold || parentStyle.bold,
        };

        const padding = cellStyle.padding ?? defaultPadding;
        const fontFamily = resolveFontFamily(cellStyle.fontFamily, cellStyle.bold, cellStyle.italic, fontAliasSet);
        const fontSize = cellStyle.fontSize;

        const text = getCellText(cell);
        const textHeight = text ? textCache.measure(doc, text, fontFamily, fontSize, colWidth - padding * 2) : 0;

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
                const nestedCellFontSize = nestedCellStyle.fontSize ?? fontSize;
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
                        colWidth - cellPaddingHorizontal * 2,
                      )
                    : 0,
                );
              }
            }
            calculatedNestedHeight += rowCellMaxHeight + nestedPadding * 2 + nestedBorderWidth;
          }
          nestedHeight += calculatedNestedHeight;
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

        for (let spanIndex = 0; spanIndex < colspan; spanIndex++) {
          data[col + spanIndex] = cellData;
        }
        col += colspan;
      }
      gridCells[rowIdx] = data;
    }

    const rowHeights: number[] = allRows.map((_, rowIdx) => {
      let maxHeight = 0;
      for (let col = 0; col < maxCols; col++) {
        const cell = gridCells[rowIdx]?.[col];
        if (cell && cell.startRow === rowIdx) {
          maxHeight = Math.max(maxHeight, cell.height / cell.rowspan);
        }
      }
      return maxHeight + (borderWidth > 0 ? borderWidth : 0);
    });

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

    for (const block of blocks) {
      const blockHeight = rowHeights
        .slice(block.start, block.end + 1)
        .reduce((sumHeight, currentHeight) => sumHeight + currentHeight, 0);
      if (doc.y + blockHeight > layout.pageBottom) {
        doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
        doc.y = layout.contentTop;
        doc.x = layout.leftMargin;
      }

      const blockY = doc.y;
      const rowTop: number[] = Array.from({ length: allRows.length }, () => 0);
      let offset = 0;
      for (let rowIndex = block.start; rowIndex <= block.end; rowIndex++) {
        rowTop[rowIndex] = blockY + offset;
        offset += rowHeights[rowIndex] ?? 0;
      }

      for (let rowIndex = block.start; rowIndex <= block.end; rowIndex++) {
        let col = 0;
        while (col < maxCols) {
          const cell = gridCells[rowIndex]?.[col];
          if (cell && cell.startRow === rowIndex) {
            const cellWidth = colWidth * cell.colspan;
            const cellX = layout.leftMargin + cell.startCol * colWidth;
            const cellY = rowTop[rowIndex] ?? 0;
            const endRow = Math.min(rowIndex + cell.rowspan - 1, allRows.length - 1);
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

            const childTags = cell.rawCell.children.filter((c: any) => c.type === 'tag') as Element[];
            const badgeTag = childTags.find((c) => {
              const s = parseInlineStyle(c);
              return Boolean(s.backgroundColor || s.border || s.borderWidth);
            });

            if (badgeTag) {
              const bStyleRaw = parseInlineStyle(badgeTag);
              const bText = getCellText(badgeTag);
              const bStyle: TextStyle = {
                ...cell.style,
                fontSize: bStyleRaw.fontSize ?? cell.style.fontSize,
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
                badgeX = cellX + cellWidth - cell.padding - badgeW;
              }

              const badgeY = cellY + (cellH - badgeH) / 2;

              if (bStyle.backgroundColor) {
                doc.fillColor(bStyle.backgroundColor);
                if (bStyle.borderRadius && bStyle.borderRadius > 0) {
                  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, bStyle.borderRadius).fill();
                } else {
                  doc.rect(badgeX, badgeY, badgeW, badgeH).fill();
                }
              }
              if (bStyle.borderWidth && bStyle.borderColor) {
                doc.strokeColor(bStyle.borderColor).lineWidth(bStyle.borderWidth).rect(badgeX, badgeY, badgeW, badgeH).stroke();
              }
              doc.fillColor(bStyle.color || cell.style.color).text(bText, badgeX + padL, badgeY + padT, { lineBreak: false });
            } else if (cell.text && textH + cell.padding <= cellH) {
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
              for (const nestedTable of cell.nestedTables) {
                await renderElementFn(
                  doc,
                  nestedTable,
                  cell.style,
                  options,
                  layout,
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

      const endRowIdx = block.end;
      doc.y = (rowTop[endRowIdx] ?? 0) + (rowHeights[endRowIdx] ?? 0);
    }
  }
}
