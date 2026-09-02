import { parseInlineStyle } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';

const FONT_SIZES_LI = 12;

export function renderList(doc, element, parentStyle, options, depth, layout, textCache, fontAliasSet) {
  const isOrdered = element.name === 'ol';
  const indent = depth * 20;
  const itemSpacing = 4;
  const fontSize = FONT_SIZES_LI;

  let itemIndex = 0;

  const items = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.type === 'tag' && child.name === 'li') items.push(child);
  }

  for (const item of items) {
    const inlineStyle = parseInlineStyle(item);
    const itemStyle = {
      ...parentStyle,
      ...inlineStyle,
      fontSize: inlineStyle.fontSize ?? fontSize,
    };

    const fontFamily = resolveFontFamily(itemStyle.fontFamily, itemStyle.bold, itemStyle.italic, fontAliasSet);
    const itemFontSize = itemStyle.fontSize;

    const bullet = isOrdered ? `${itemIndex + 1}.` : '•';
    doc.font(fontFamily).fontSize(itemFontSize).widthOfString(bullet);

    const listContentWidth = layout.contentWidth - indent - (isOrdered ? 20 : 10);

    const nestedLists = [];
    const textChildren = [];
    for (let i = 0; i < item.children.length; i++) {
      const child = item.children[i];
      if (child.type === 'tag' && (child.name === 'ul' || child.name === 'ol')) {
        nestedLists.push(child);
      } else {
        textChildren.push(child);
      }
    }

    let text = '';
    for (let i = 0; i < textChildren.length; i++) {
      const c = textChildren[i];
      if (c.type === 'text') text += c.data;
      else if (c.type === 'tag') {
        for (let j = 0; j < c.children.length; j++) {
          if (c.children[j].type === 'text') text += c.children[j].data;
        }
      }
    }
    text = text.trim();

    const textHeight = text
      ? textCache.measure(doc, text, fontFamily, itemFontSize, listContentWidth)
      : 0;

    const lineHeight = Math.max(textHeight, itemFontSize) + itemSpacing;

    if (doc.y + lineHeight > layout.pageBottom) {
      doc.addPage({ size: options?.format || layout.format, layout: layout.orientation, margin: 0 });
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
