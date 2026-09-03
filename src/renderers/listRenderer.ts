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
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
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
    for (let i = 0; i < item.children.length; i++) {
      const child = item.children[i];
      if (!child) continue;
      if (child.type === 'tag' && ((child as Element).name === 'ul' || (child as Element).name === 'ol')) {
        nestedLists.push(child as Element);
      } else {
        textChildren.push(child);
      }
    }

    let text = '';
    for (let i = 0; i < textChildren.length; i++) {
      const c = textChildren[i];
      if (!c) continue;
      if (c.type === 'text') {
        text += (c as any).data ?? '';
      } else if (c.type === 'tag') {
        const grandChildren = (c as Element).children;
        for (let j = 0; j < grandChildren.length; j++) {
          const gc = grandChildren[j];
          if (gc && gc.type === 'text') {
            text += (gc as any).data ?? '';
          }
        }
      }
    }
    text = text.trim();

    const textHeight = text ? textCache.measure(doc, text, fontFamily, itemFontSize, listContentWidth) : 0;

    const lineHeight = Math.max(textHeight, itemFontSize) + itemSpacing;

    if (doc.y + lineHeight > layout.pageBottom) {
      doc.addPage({ size: options.format || layout.format, layout: layout.orientation, margin: 0 });
      doc.y = layout.contentTop;
      doc.x = layout.leftMargin;
    }

    doc.font(fontFamily).fontSize(itemFontSize).fillColor(itemStyle.color);
    doc.x = layout.leftMargin + indent;

    const fullText = text ? bullet + ' ' + text : bullet;
    doc.text(fullText, { width: layout.contentWidth - indent, lineGap: itemFontSize * 0.25 });
    doc.y += itemSpacing;

    for (const nestedList of nestedLists) {
      renderList(doc, nestedList, itemStyle, options, depth + 1, layout, textCache, fontAliasSet);
    }

    itemIndex++;
  }
}
