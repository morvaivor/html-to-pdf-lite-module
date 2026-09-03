import { resolveFontFamily } from '../core/fontManager.js';

export function renderText(doc, text, style, options, layout, textCache, fontAliasSet) {
  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  const fontSize = style.fontSize;

  doc.font(fontFamily).fontSize(fontSize).fillColor(style.color);
  doc.x = layout.leftMargin;

  const textHeight = textCache.measure(doc, text, fontFamily, fontSize, layout.contentWidth);

  if (doc.y + textHeight > layout.pageBottom) {
    doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
    doc.y = layout.contentTop;
    doc.x = layout.leftMargin;
  }

  doc.text(text, doc.x, doc.y, { width: layout.contentWidth, lineGap: fontSize * 0.25 });
}

export async function processChildren(doc, children, style, options, layout, textCache, fontAliasSet, imageCache, renderElementFn) {
  for (const child of children) {
    if (child.type === 'tag') {
      await renderElementFn(doc, child, style, options, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), style, options, layout, textCache, fontAliasSet);
    }
  }
}
