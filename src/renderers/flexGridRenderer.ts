import { parseInlineStyle } from '../core/cacheManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';

/**
 * Parses grid-template-columns or flex items into numeric column widths.
 */
function calculateColumnWidths(
  children: Element[],
  containerWidth: number,
  gap: number,
  gridTemplateColumns?: string,
): number[] {
  const count = children.length;
  if (count === 0) return [];

  const totalGap = Math.max(0, (count - 1) * gap);
  const availableWidth = Math.max(10, containerWidth - totalGap);

  // Cas 1 : grid-template-columns explicite
  if (gridTemplateColumns) {
    let clean = gridTemplateColumns.trim();
    // Ex: repeat(4, 1fr) -> 1fr 1fr 1fr 1fr
    const repeatMatch = clean.match(/repeat\((\d+),\s*([^)]+)\)/i);
    if (repeatMatch && repeatMatch[1] && repeatMatch[2]) {
      const repCount = parseInt(repeatMatch[1], 10);
      const repVal = repeatMatch[2].trim();
      clean = Array(repCount).fill(repVal).join(' ');
    }

    const tokens = clean.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      let totalFr = 0;
      let fixedPx = 0;
      const parsedTokens: Array<{ type: 'fr' | 'px' | 'pct'; value: number }> = [];

      for (const t of tokens) {
        if (t.endsWith('fr')) {
          const v = parseFloat(t) || 1;
          totalFr += v;
          parsedTokens.push({ type: 'fr', value: v });
        } else if (t.endsWith('%')) {
          const v = (parseFloat(t) / 100) * availableWidth;
          fixedPx += v;
          parsedTokens.push({ type: 'pct', value: v });
        } else {
          const v = parseFloat(t.replace(/(px|pt)/i, '')) || 50;
          fixedPx += v;
          parsedTokens.push({ type: 'px', value: v });
        }
      }

      const remainingForFr = Math.max(0, availableWidth - fixedPx);
      return parsedTokens.map((p) => {
        if (p.type === 'fr') {
          return totalFr > 0 ? (p.value / totalFr) * remainingForFr : availableWidth / tokens.length;
        }
        return p.value;
      });
    }
  }

  // Cas 2 : Enfants avec style inline 'width' (ex: width: 50%)
  let hasExplicitWidths = false;
  const childWidths: number[] = [];
  let allocatedWidth = 0;
  let unallocatedCount = 0;

  for (const child of children) {
    const cStyle = parseInlineStyle(child);
    if (cStyle.width) {
      const wStr = String(cStyle.width).trim();
      if (wStr.endsWith('%')) {
        const pct = (parseFloat(wStr) / 100) * availableWidth;
        childWidths.push(pct);
        allocatedWidth += pct;
        hasExplicitWidths = true;
        continue;
      } else {
        const px = parseFloat(wStr.replace(/(px|pt)/i, ''));
        if (!isNaN(px)) {
          childWidths.push(px);
          allocatedWidth += px;
          hasExplicitWidths = true;
          continue;
        }
      }
    }
    childWidths.push(-1);
    unallocatedCount++;
  }

  if (hasExplicitWidths && unallocatedCount > 0) {
    const remaining = Math.max(10, availableWidth - allocatedWidth);
    const each = remaining / unallocatedCount;
    return childWidths.map((w) => (w === -1 ? each : w));
  } else if (hasExplicitWidths) {
    return childWidths;
  }

  // Cas 3 : Distribution équitable par défaut
  const equalWidth = availableWidth / count;
  return Array(count).fill(equalWidth);
}

function countGridColumns(template: string): number {
  let clean = template.trim();
  const repeatMatch = clean.match(/repeat\((\d+),\s*([^)]+)\)/i);
  if (repeatMatch && repeatMatch[1] && repeatMatch[2]) {
    const repCount = parseInt(repeatMatch[1], 10);
    clean = Array(repCount).fill(repeatMatch[2].trim()).join(' ');
  }
  return clean.split(/\s+/).filter(Boolean).length;
}

/**
 * Renders container elements marked with display: flex or display: grid.
 */
export async function renderFlexContainer(
  doc: PDFKit.PDFDocument,
  element: Element,
  style: TextStyle,
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
  estimateElementHeightFn?: (
    doc: PDFKit.PDFDocument,
    element: Element,
    parentStyle: TextStyle,
    width: number,
    textCache: TextMeasureCache,
    fontAliasSet: Set<string>,
  ) => number,
): Promise<void> {
  const isRow = style.flexDirection !== 'column';
  const gap = style.gap ?? 8;
  const marginTop = style.marginTop ?? 0;
  const marginBottom = style.marginBottom ?? 0;
  const marginLeft = style.marginLeft ?? 0;
  const marginRight = style.marginRight ?? 0;
  const paddingTop = style.paddingTop ?? style.padding ?? 0;
  const paddingBottom = style.paddingBottom ?? style.padding ?? 0;
  const paddingLeft = style.paddingLeft ?? style.padding ?? 0;
  const paddingRight = style.paddingRight ?? style.padding ?? 0;

  if (marginTop > 0) {
    doc.y += marginTop;
  }

  // Tag children uniquement
  const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
  if (tagChildren.length === 0) return;

  const containerX = layout.leftMargin + marginLeft;
  const containerWidth = layout.contentWidth - marginLeft - marginRight;
  const innerWidth = Math.max(10, containerWidth - paddingLeft - paddingRight);
  const startY = doc.y;

  // Si flex-direction: column, on applique simplement le padding et on rend verticalement
  if (!isRow && !style.gridTemplateColumns) {
    const colLayout = Object.create(layout);
    colLayout.leftMargin = containerX + paddingLeft;
    colLayout.contentWidth = innerWidth;

    for (const child of tagChildren) {
      await renderElementFn(doc, child, style, options, colLayout, textCache, fontAliasSet, imageCache);
      if (gap > 0) doc.y += gap;
    }
    if (marginBottom > 0) doc.y += marginBottom;
    return;
  }

  // Calcul des colonnes horizontales
  const colWidths = calculateColumnWidths(tagChildren, innerWidth, gap, style.gridTemplateColumns);

  // Le grid retourne à la ligne quand le nombre d'enfants dépasse le nombre de colonnes
  const gridCols = style.gridTemplateColumns ? countGridColumns(style.gridTemplateColumns) : 0;
  const needWrap = gridCols > 0 && tagChildren.length > gridCols;

  // Pre-calculate estimated box height so background is drawn BEFORE children, eliminating double-rendering
  let estimatedContentHeight = 0;
  let estRowMax = 0;
  for (let i = 0; i < tagChildren.length; i++) {
    const colIndex = needWrap ? i % gridCols : i;
    const colW = colWidths[colIndex] ?? innerWidth / tagChildren.length;
    const estH = estimateElementHeightFn
      ? estimateElementHeightFn(doc, tagChildren[i]!, style, colW, textCache, fontAliasSet)
      : 0;
    if (estH > estRowMax) {
      estRowMax = estH;
    }
    const rowEnds = !needWrap || (i + 1) % gridCols === 0 || i === tagChildren.length - 1;
    if (rowEnds) {
      estimatedContentHeight += estRowMax + (estimatedContentHeight > 0 ? gap : 0);
      estRowMax = 0;
    }
  }

  const estimatedBoxHeight = paddingTop + estimatedContentHeight + paddingBottom;

  // Draw background FIRST if present
  if (style.backgroundColor) {
    doc.save();
    doc.fillColor(style.backgroundColor);
    if (style.borderRadius && style.borderRadius > 0) {
      doc.roundedRect(containerX, startY, containerWidth, estimatedBoxHeight, style.borderRadius).fill();
    } else {
      doc.rect(containerX, startY, containerWidth, estimatedBoxHeight).fill();
    }
    doc.restore();
  }

  let curX = containerX + paddingLeft;
  let rowY = startY + paddingTop;
  let rowBottom = rowY;
  let rowMaxHeight = 0;

  // Render each child exactly ONCE on top of the background
  for (let i = 0; i < tagChildren.length; i++) {
    const child = tagChildren[i]!;
    const colIndex = needWrap ? i % gridCols : i;
    const colW = colWidths[colIndex] ?? innerWidth / tagChildren.length;

    // Créer un layout virtuel borné à la colonne courante
    const childLayout = Object.create(layout);
    childLayout.leftMargin = curX;
    childLayout.contentWidth = colW;

    doc.x = curX;
    doc.y = rowY;

    await renderElementFn(doc, child, style, options, childLayout, textCache, fontAliasSet, imageCache);

    if (doc.y > rowBottom) {
      rowBottom = doc.y;
    }

    const rowEnds = i === tagChildren.length - 1 || (needWrap && (i + 1) % gridCols === 0);
    if (rowEnds) {
      const renderedRowHeight = rowBottom - rowY;
      if (renderedRowHeight > rowMaxHeight) rowMaxHeight = renderedRowHeight;
      if (i !== tagChildren.length - 1) {
        rowY = rowBottom + gap;
        curX = containerX + paddingLeft;
        rowBottom = rowY;
      }
    } else {
      curX += colW + gap;
    }
  }

  const finalBoxHeight = Math.max(estimatedBoxHeight, rowBottom - startY + paddingBottom);

  // Bordures du conteneur
  if (style.borderWidth && style.borderColor) {
    doc.strokeColor(style.borderColor).lineWidth(style.borderWidth);
    if (style.borderRadius && style.borderRadius > 0) {
      doc.roundedRect(containerX, startY, containerWidth, finalBoxHeight, style.borderRadius).stroke();
    } else {
      doc.rect(containerX, startY, containerWidth, finalBoxHeight).stroke();
    }
  }

  // Positionner le curseur en bas de la plus grande colonne
  doc.y = startY + finalBoxHeight + marginBottom;
  doc.x = layout.leftMargin;
}
