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

  let curX = containerX + paddingLeft;
  let maxY = startY + paddingTop;

  // Render chaque enfant dans sa colonne avec layout restreint
  for (let i = 0; i < tagChildren.length; i++) {
    const child = tagChildren[i]!;
    const colW = colWidths[i] ?? innerWidth / tagChildren.length;

    // Créer un layout virtuel borné à la colonne courante
    const childLayout = Object.create(layout);
    childLayout.leftMargin = curX;
    childLayout.contentWidth = colW;

    doc.x = curX;
    doc.y = startY + paddingTop;

    await renderElementFn(doc, child, style, options, childLayout, textCache, fontAliasSet, imageCache);

    if (doc.y > maxY) {
      maxY = doc.y;
    }

    curX += colW + gap;
  }

  const finalBoxHeight = maxY - startY + paddingBottom;

  // Dessin du fond et bordures du conteneur si présent
  if (style.backgroundColor) {
    doc.save();
    doc.fillColor(style.backgroundColor);
    if (style.borderRadius && style.borderRadius > 0) {
      doc.roundedRect(containerX, startY, containerWidth, finalBoxHeight, style.borderRadius).fill();
    } else {
      doc.rect(containerX, startY, containerWidth, finalBoxHeight).fill();
    }
    doc.restore();

    // Re-rendre les enfants pour qu'ils soient au-dessus du fond
    let reRenderX = containerX + paddingLeft;
    for (let i = 0; i < tagChildren.length; i++) {
      const child = tagChildren[i]!;
      const colW = colWidths[i] ?? innerWidth / tagChildren.length;
      const childLayout = Object.create(layout);
      childLayout.leftMargin = reRenderX;
      childLayout.contentWidth = colW;
      doc.x = reRenderX;
      doc.y = startY + paddingTop;
      await renderElementFn(doc, child, style, options, childLayout, textCache, fontAliasSet, imageCache);
      reRenderX += colW + gap;
    }
  }

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
  doc.y = maxY + paddingBottom + marginBottom;
  doc.x = layout.leftMargin;
}
