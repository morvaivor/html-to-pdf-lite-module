import { parseInlineStyle } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element, ChildNode } from 'domhandler';

const FONT_SIZES_LI: number = 12;

export function renderList(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  options: RenderOptions,
  depth: number,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
): void {
  const isOrdered = element.name === 'ol';
  const indent = depth * 20;
  const itemSpacing = 4;
  const fontSize = FONT_SIZES_LI;

  let itemIndex = 0;

  const items: Element[] = [];
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child && child.type === 'tag' && (child as Element).name === 'li') {
      items.push(child as Element);
    }
  }

  for (const item of items) {
    const inlineStyle = parseInlineStyle(item);
    const itemStyle: TextStyle = {
      ...parentStyle,
      ...inlineStyle,
      fontSize: inlineStyle.fontSize ?? fontSize,
    };

    const fontFamily = resolveFontFamily(itemStyle.fontFamily, itemStyle.bold, itemStyle.italic, fontAliasSet);
    const itemFontSize = itemStyle.fontSize;

    const bullet = isOrdered ? `${itemIndex + 1}.` : '•';
    doc.font(fontFamily).fontSize(itemFontSize).widthOfString(bullet);

    const listContentWidth = layout.contentWidth - indent - (isOrdered ? 20 : 10);

    const nestedLists: Element[] = [];
    const textChildren: ChildNode[] = [];
    for (let childIndex = 0; childIndex < item.children.length; childIndex++) {
      const child = item.children[childIndex];
      if (!child) continue;
      if (child.type === 'tag' && ((child as Element).name === 'ul' || (child as Element).name === 'ol')) {
        nestedLists.push(child as Element);
      } else {
        textChildren.push(child);
      }
    }

    const runs: Array<{
      text: string;
      bold: boolean;
      italic: boolean;
      color: string;
      decoration?: TextStyle['textDecoration'];
    }> = [];
    runs.push({
      text: bullet + ' ',
      bold: false,
      italic: false,
      color: itemStyle.color,
      decoration: itemStyle.textDecoration,
    });

    let fullText = bullet + ' ';
    for (let childIndex = 0; childIndex < textChildren.length; childIndex++) {
      const currentChild = textChildren[childIndex];
      if (!currentChild) continue;
      if (currentChild.type === 'text') {
        const d = (currentChild as any).data ?? '';
        if (d) {
          runs.push({
            text: d,
            bold: itemStyle.bold,
            italic: itemStyle.italic,
            color: itemStyle.color,
            decoration: itemStyle.textDecoration,
          });
          fullText += d;
        }
      } else if (currentChild.type === 'tag') {
        const el = currentChild as Element;
        const isBold = el.name === 'b' || el.name === 'strong';
        const isItalic = el.name === 'i' || el.name === 'em';
        const cStyle = parseInlineStyle(el);
        const grandChildren = el.children;
        let childText = '';
        for (let grandChildIndex = 0; grandChildIndex < grandChildren.length; grandChildIndex++) {
          const grandChild = grandChildren[grandChildIndex];
          if (grandChild && grandChild.type === 'text') {
            childText += (grandChild as any).data ?? '';
          }
        }
        if (childText) {
          runs.push({
            text: childText,
            bold: Boolean(isBold || cStyle.bold || itemStyle.bold),
            italic: Boolean(isItalic || cStyle.italic || itemStyle.italic),
            color: cStyle.color || itemStyle.color,
            decoration: cStyle.textDecoration || itemStyle.textDecoration,
          });
          fullText += childText;
        }
      }
    }

    const textHeight = fullText
      ? textCache.measure(doc, fullText.trim(), fontFamily, itemFontSize, listContentWidth)
      : 0;
    const lineHeight = Math.max(textHeight, itemFontSize) + itemSpacing;

    if (doc.y + lineHeight > layout.pageBottom) {
      doc.addPage({ size: options.format || layout.format, layout: layout.orientation, margin: 0 });
      doc.y = layout.contentTop;
      doc.x = layout.leftMargin;
    }

    doc.x = layout.leftMargin + indent;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      const isLast = i === runs.length - 1;
      const f = resolveFontFamily(itemStyle.fontFamily, r.bold, r.italic, fontAliasSet);
      doc.font(f).fontSize(itemFontSize).fillColor(r.color);
      const runTextOpts: PDFKit.Mixins.TextOptions = {
        width: layout.contentWidth - indent,
        lineGap: itemFontSize * 0.25,
        continued: !isLast,
      };
      if (r.decoration === 'underline') runTextOpts.underline = true;
      else if (r.decoration === 'line-through') runTextOpts.strike = true;
      if (i === 0) {
        doc.text(r.text, layout.leftMargin + indent, doc.y, runTextOpts);
      } else {
        doc.text(r.text, runTextOpts);
      }
    }
    doc.y += itemSpacing;

    for (const nestedList of nestedLists) {
      renderList(doc, nestedList, itemStyle, options, depth + 1, layout, textCache, fontAliasSet);
    }

    itemIndex++;
  }
}
