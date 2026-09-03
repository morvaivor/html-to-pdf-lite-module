import { resolveFontFamily } from '../core/fontManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { ChildNode } from 'domhandler';

export function renderText(
  doc: PDFKit.PDFDocument,
  text: string,
  style: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
): void {
  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  const fontSize = style.fontSize;

  doc.font(fontFamily).fontSize(fontSize).fillColor(style.color);
  doc.x = layout.leftMargin;

  const textHeight = textCache.measure(doc, text, fontFamily, fontSize, layout.contentWidth);

  if (doc.y + textHeight > layout.pageBottom) {
    doc.addPage({
      size: options.format ?? layout.format,
      layout: options.orientation ?? layout.orientation,
      margin: 0,
    });
    doc.y = layout.contentTop;
    doc.x = layout.leftMargin;
  }

  doc.text(text, doc.x, doc.y, { width: layout.contentWidth, lineGap: fontSize * 0.25 });
}

export async function processChildren(
  doc: PDFKit.PDFDocument,
  children: ChildNode[],
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
  for (const child of children) {
    if (child.type === 'tag') {
      await renderElementFn(doc, child, style, options, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && (child as any).data?.trim()) {
      renderText(doc, (child as any).data.trim(), style, options, layout, textCache, fontAliasSet);
    }
  }
}
