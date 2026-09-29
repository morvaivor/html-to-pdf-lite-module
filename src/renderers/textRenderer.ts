import { resolveFontFamily } from '../core/fontManager.js';
import { applyMarginBottom, applyMarginTop } from '../core/blockFlow.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { ChildNode } from 'domhandler';

/**
 * Extra spacing added by PDFKit between lines so that a line box matches the CSS `line-height`.
 * Measurement and rendering must use the same value, otherwise estimated boxes disagree with the text.
 */
export function lineGapFor(style: TextStyle): number {
  return style.lineHeight !== undefined
    ? Math.max(0, style.fontSize * (style.lineHeight - 1.15))
    : style.fontSize * 0.15;
}

/** Applies CSS `text-transform` the way the renderers draw the text. */
export function transformText(text: string, style: TextStyle): string {
  if (style.textTransform === 'uppercase') return text.toUpperCase();
  if (style.textTransform === 'lowercase') return text.toLowerCase();
  if (style.textTransform === 'capitalize') return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

export function renderText(
  doc: PDFKit.PDFDocument,
  text: string,
  style: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
): void {
  const formattedText = transformText(text, style);

  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  const fontSize = style.fontSize;

  const marginBottom = style.marginBottom ?? 0;
  applyMarginTop(doc, style.marginTop ?? 0);

  const marginLeft = style.marginLeft ?? 0;
  const marginRight = style.marginRight ?? 0;
  const availableWidth = layout.contentWidth - marginLeft - marginRight;
  const targetX = layout.leftMargin + marginLeft;

  doc.font(fontFamily).fontSize(fontSize).fillColor(style.color);
  doc.x = targetX;

  const lineGap = lineGapFor(style);

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

  const textHeight = textCache.measure(
    doc,
    formattedText,
    fontFamily,
    fontSize,
    availableWidth,
    lineGap,
    style.letterSpacing,
  );

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

  applyMarginBottom(doc, marginBottom);
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
  const marginBottom = blockStyle.marginBottom ?? 0;

  applyMarginTop(doc, blockStyle.marginTop ?? 0);

  const lineGap = lineGapFor(blockStyle);

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

    const txt = transformText(run.text, run.style);

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

  applyMarginBottom(doc, marginBottom);
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
