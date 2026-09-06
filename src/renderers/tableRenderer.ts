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
  textHeight: number;
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
            const px = parseFloat(strW);
            if (!isNaN(px) && px > 0) explicitColWidths[cIdx] = px;
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
  const borderColor = defaultBorder ? defaultBorderColor : undefined;

  {
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
      const currentRow = allRows[rowIdx];
      const rowInlineStyle = currentRow ? parseInlineStyle(currentRow) : {};
      const parentSection =
        currentRow?.parent && (currentRow.parent as any).type === 'tag' ? (currentRow.parent as Element) : null;
      const sectionInlineStyle = parentSection ? parseInlineStyle(parentSection) : {};

      // Étape 2 : Placer chaque cellule dans la première colonne libre
      for (const cell of currentCells) {
        while (col < maxCols && data[col] !== null) col++;
        if (col >= maxCols) break;
        const colspan = Math.min(parseInt(cell.attribs['colspan'] || '1', 10), maxCols - col);
        const rowspan = Math.max(1, Math.min(parseInt(cell.attribs['rowspan'] || '1', 10), allRows.length - rowIdx));

        const cellInlineStyle = parseInlineStyle(cell);
        const inheritedBg =
          cellInlineStyle.backgroundColor || rowInlineStyle.backgroundColor || sectionInlineStyle.backgroundColor;
        const inheritedColor =
          cellInlineStyle.color || rowInlineStyle.color || sectionInlineStyle.color || parentStyle.color;

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

        const currentCellWidth = colWidths.slice(col, col + colspan).reduce((sum, w) => sum + w, 0);
        const textWidth = Math.max(10, currentCellWidth - padding * 2);

        const text = getCellText(cell);
        const textHeight = text ? textCache.measure(doc, text, fontFamily, fontSize, textWidth) : 0;

        const childTags = cell.children.filter((c: any) => c.type === 'tag') as Element[];
        const hasComplexChildren = childTags.some(
          (c) => c.name === 'div' || c.name === 'p' || c.name === 'svg' || c.name === 'img',
        );

        let complexChildrenHeight = 0;
        if (hasComplexChildren) {
          for (const el of childTags) {
            if (el.name === 'svg' || el.name === 'img') {
              const h = parseInt(el.attribs['height'] || '', 10) || 90;
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

        const badgeTag = !hasComplexChildren
          ? childTags.find((c) => {
              const s = parseInlineStyle(c);
              return Boolean(s.backgroundColor || s.border || s.borderWidth);
            })
          : undefined;

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

        const cellHeight = Math.max(textHeight, fontSize, complexChildrenHeight) + padding * 2 + nestedHeight;

        const cellData: CellData = {
          text,
          textHeight,
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
            const cellWidth = colWidths
              .slice(cell.startCol, cell.startCol + cell.colspan)
              .reduce((sum, w) => sum + w, 0);
            const cellX = layout.leftMargin + colWidths.slice(0, cell.startCol).reduce((sum, w) => sum + w, 0);
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
            const textWidth = Math.max(10, cellWidth - cell.padding * 2);
            const textH = cell.textHeight;

            if (cell.hasComplexChildren) {
              const cellLayout = Object.create(layout);
              cellLayout.leftMargin = textX;
              cellLayout.contentWidth = textWidth;
              const savedX = doc.x;
              const savedY = doc.y;
              doc.x = textX;
              doc.y = cellY + cell.padding;

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
                  doc.font(cell.fontFamily).fontSize(cell.fontSize).fillColor(cell.style.color);
                  const align = cell.style.textAlign || 'left';
                  doc.text((child as any).data.trim(), textX, doc.y, { width: textWidth, align });
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
            } else if (cell.text && textH + cell.padding <= cellH) {
              const cellTextOpts: PDFKit.Mixins.TextOptions = { width: textWidth };
              if (cell.style.textAlign === 'center') cellTextOpts.align = 'center';
              else if (cell.style.textAlign === 'right') cellTextOpts.align = 'right';
              if (cell.style.textDecoration === 'underline') cellTextOpts.underline = true;
              else if (cell.style.textDecoration === 'line-through') cellTextOpts.strike = true;
              doc.text(cell.text, textX, textY, cellTextOpts);
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
