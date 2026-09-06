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
  let formattedText = text;
  if (style.textTransform === 'uppercase') {
    formattedText = text.toUpperCase();
  } else if (style.textTransform === 'lowercase') {
    formattedText = text.toLowerCase();
  } else if (style.textTransform === 'capitalize') {
    formattedText = text.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  const fontSize = style.fontSize;

  const marginTop = style.marginTop ?? 0;
  const marginBottom = style.marginBottom ?? 0;
  if (marginTop > 0) {
    doc.y += marginTop;
  }

  const marginLeft = style.marginLeft ?? 0;
  const marginRight = style.marginRight ?? 0;
  const availableWidth = layout.contentWidth - marginLeft - marginRight;
  const targetX = layout.leftMargin + marginLeft;

  doc.font(fontFamily).fontSize(fontSize).fillColor(style.color);
  doc.x = targetX;

  const lineGap = style.lineHeight !== undefined ? Math.max(0, fontSize * (style.lineHeight - 1.15)) : fontSize * 0.15;

  const textOpts: PDFKit.Mixins.TextOptions = {
    width: availableWidth,
    lineGap,
  };

  if (style.textAlign) {
    textOpts.align = style.textAlign;
  }
  if (style.letterSpacing !== undefined) {
    textOpts.characterSpacing = style.letterSpacing;
  }
  if (style.textDecoration === 'underline') {
    textOpts.underline = true;
  } else if (style.textDecoration === 'line-through') {
    textOpts.strike = true;
  }

  const textHeight = textCache.measure(doc, formattedText, fontFamily, fontSize, availableWidth, lineGap);

  if (doc.y + textHeight > layout.pageBottom) {
    doc.addPage({
      size: options.format ?? layout.format,
      layout: options.orientation ?? layout.orientation,
      margin: 0,
    });
    doc.y = layout.contentTop;
    doc.x = targetX;
  }

  doc.text(formattedText, targetX, doc.y, textOpts);

  // Render bottom border (e.g. h2 with border-bottom: 1px solid #cbd5e1)
  if (style.borderBottomWidth && style.borderBottomWidth > 0) {
    const borderY = doc.y + (style.paddingBottom ?? 3);
    doc
      .moveTo(targetX, borderY)
      .lineTo(targetX + availableWidth, borderY)
      .lineWidth(style.borderBottomWidth)
      .strokeColor(style.borderBottomColor || style.borderColor || '#000000')
      .stroke();
    doc.y = borderY + 2;
  }

  if (marginBottom > 0) {
    doc.y += marginBottom;
  }
}

export function renderInlineRuns(
  doc: PDFKit.PDFDocument,
  runs: Array<{ text: string; style: TextStyle }>,
  blockStyle: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  fontAliasSet: Set<string>,
): void {
  if (runs.length === 0) return;

  const marginLeft = blockStyle.marginLeft ?? 0;
  const marginRight = blockStyle.marginRight ?? 0;
  const availableWidth = layout.contentWidth - marginLeft - marginRight;
  const startX = layout.leftMargin + marginLeft;
  const marginTop = blockStyle.marginTop ?? 0;
  const marginBottom = blockStyle.marginBottom ?? 0;

  if (marginTop > 0) doc.y += marginTop;

  const lineGap =
    blockStyle.lineHeight !== undefined
      ? Math.max(0, blockStyle.fontSize * (blockStyle.lineHeight - 1.15))
      : blockStyle.fontSize * 0.15;

  const baseTextOpts: PDFKit.Mixins.TextOptions = {
    width: availableWidth,
    lineGap,
  };
  if (blockStyle.textAlign) {
    baseTextOpts.align = blockStyle.textAlign;
  }

  if (doc.y + blockStyle.fontSize * 2 > layout.pageBottom) {
    doc.addPage({
      size: options.format ?? layout.format,
      layout: options.orientation ?? layout.orientation,
      margin: 0,
    });
    doc.y = layout.contentTop;
  }

  doc.x = startX;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    const isLast = i === runs.length - 1;
    const fontFamily = resolveFontFamily(run.style.fontFamily, run.style.bold, run.style.italic, fontAliasSet);
    doc.font(fontFamily).fontSize(run.style.fontSize).fillColor(run.style.color);

    let txt = run.text;
    if (run.style.textTransform === 'uppercase') txt = txt.toUpperCase();
    else if (run.style.textTransform === 'lowercase') txt = txt.toLowerCase();
    else if (run.style.textTransform === 'capitalize') txt = txt.replace(/\b\w/g, (c) => c.toUpperCase());

    const opts: PDFKit.Mixins.TextOptions = {
      ...baseTextOpts,
      continued: !isLast,
    };
    if (run.style.letterSpacing !== undefined) {
      opts.characterSpacing = run.style.letterSpacing;
    }
    if (run.style.textDecoration === 'underline') {
      opts.underline = true;
    } else if (run.style.textDecoration === 'line-through') {
      opts.strike = true;
    }

    if (i === 0) {
      doc.text(txt, startX, doc.y, opts);
    } else {
      doc.text(txt, opts);
    }
  }

  if (blockStyle.borderBottomWidth && blockStyle.borderBottomWidth > 0) {
    const borderY = doc.y + (blockStyle.paddingBottom ?? 3);
    doc
      .moveTo(startX, borderY)
      .lineTo(startX + availableWidth, borderY)
      .lineWidth(blockStyle.borderBottomWidth)
      .strokeColor(blockStyle.borderBottomColor || blockStyle.borderColor || '#000000')
      .stroke();
    doc.y = borderY + 2;
  }

  if (marginBottom > 0) doc.y += marginBottom;
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
