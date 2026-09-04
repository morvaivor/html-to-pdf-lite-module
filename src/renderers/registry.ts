import { renderText, renderInlineRuns, processChildren } from './textRenderer.js';
import { renderImage } from './imageRenderer.js';
import { renderTable } from './tableRenderer.js';
import { renderList } from './listRenderer.js';
import { renderSvg } from './svgRenderer.js';
import { renderFlexContainer } from './flexGridRenderer.js';
import { parseInlineStyle } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';

const FONT_SIZES: Record<string, number> = {
  h1: 32,
  h2: 28,
  h3: 24,
  h4: 20,
  h5: 16,
  h6: 14,
  p: 12,
  span: 12,
  div: 12,
  a: 12,
  li: 12,
  td: 12,
  th: 12,
};

const BLOCK_ELEMENTS = new Set<string>([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'br',
  'section',
  'article',
  'header',
  'footer',
  'blockquote',
]);

/**
 * Common signature for all element renderers in the registry
 */
export type ElementRenderer = (
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
  renderElementFn: typeof renderElement,
) => void | Promise<void>;

/**
 * Registry associating HTML tags with specialized renderers.
 */
const elementRegistry: Map<string, ElementRenderer> = new Map<string, ElementRenderer>();

elementRegistry.set('br', (doc) => {
  doc.text('', doc.x, doc.y);
});

elementRegistry.set('img', (doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) => {
  return renderImage(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache);
});

elementRegistry.set(
  'table',
  (doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache, renderElementFn) => {
    return renderTable(
      doc,
      element,
      parentStyle,
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElementFn,
    );
  },
);

elementRegistry.set('ul', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  renderList(doc, element, parentStyle, options, 0, layout, textCache, fontAliasSet);
});

elementRegistry.set('ol', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  renderList(doc, element, parentStyle, options, 0, layout, textCache, fontAliasSet);
});

elementRegistry.set('svg', (doc, element, parentStyle, options, layout) => {
  renderSvg(doc, element, parentStyle, options, layout);
});

function isInlineContainer(element: Element): boolean {
  const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
  if (tagChildren.length === 0) return false;

  const allInline = tagChildren.every((c) => {
    const cStyle = parseInlineStyle(c);
    return (
      ['span', 'b', 'i', 'em', 'strong', 'a', 'small'].includes(c.name) ||
      cStyle.display === 'inline' ||
      cStyle.display === 'inline-block'
    );
  });

  if (!allInline) return false;

  return tagChildren.some((c) => {
    const cStyle = parseInlineStyle(c);
    return (
      Boolean(cStyle.backgroundColor) ||
      Boolean(cStyle.border) ||
      Boolean(cStyle.borderWidth) ||
      Boolean(cStyle.borderLeftWidth) ||
      (cStyle.marginLeft !== undefined && cStyle.marginLeft > 0) ||
      cStyle.display === 'inline-block'
    );
  });
}

function hasOnlyInlineChildren(element: Element): boolean {
  const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
  if (tagChildren.length === 0) return true;
  return tagChildren.every((c) =>
    ['b', 'strong', 'i', 'em', 'span', 'a', 'small', 'code'].includes(c.name),
  );
}

function collectInlineRuns(
  element: Element,
  parentStyle: TextStyle,
): Array<{ text: string; style: TextStyle }> {
  const runs: Array<{ text: string; style: TextStyle }> = [];

  for (const child of element.children) {
    if (child.type === 'text') {
      const txt = (child as any).data;
      if (txt) {
        runs.push({ text: txt, style: parentStyle });
      }
    } else if (child.type === 'tag') {
      const el = child as Element;
      const childInline = parseInlineStyle(el);
      const isBold = el.name === 'b' || el.name === 'strong' || childInline.bold;
      const isItalic = el.name === 'i' || el.name === 'em' || childInline.italic;
      const childStyle: TextStyle = {
        ...parentStyle,
        ...childInline,
        bold: Boolean(isBold || parentStyle.bold),
        italic: Boolean(isItalic || parentStyle.italic),
        fontSize: childInline.fontSize ?? parentStyle.fontSize,
        color: childInline.color ?? parentStyle.color,
      };

      const innerRuns = collectInlineRuns(el, childStyle);
      runs.push(...innerRuns);
    }
  }

  return runs;
}

function inheritStyle(parentStyle: TextStyle, inlineStyle: Partial<TextStyle>, tagName: string): TextStyle {
  return {
    // Propriétés CSS héritables (typographie & texte)
    fontFamily: inlineStyle.fontFamily ?? parentStyle.fontFamily,
    color: inlineStyle.color ?? parentStyle.color,
    fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? parentStyle.fontSize,
    bold: inlineStyle.bold ?? (tagName === 'b' || tagName === 'strong' ? true : parentStyle.bold),
    italic: inlineStyle.italic ?? (tagName === 'i' || tagName === 'em' ? true : parentStyle.italic),
    lineHeight: inlineStyle.lineHeight ?? parentStyle.lineHeight,
    letterSpacing: inlineStyle.letterSpacing ?? parentStyle.letterSpacing,
    textAlign: inlineStyle.textAlign ?? parentStyle.textAlign,
    textTransform: inlineStyle.textTransform ?? parentStyle.textTransform,

    // Propriétés CSS NON héritables (Box Model : bordures, marges, padding, fonds propres à l'élément)
    backgroundColor: inlineStyle.backgroundColor,
    border: inlineStyle.border,
    borderColor: inlineStyle.borderColor,
    borderWidth: inlineStyle.borderWidth,
    borderStyle: inlineStyle.borderStyle,
    borderTopWidth: inlineStyle.borderTopWidth,
    borderTopColor: inlineStyle.borderTopColor,
    borderBottomWidth: inlineStyle.borderBottomWidth,
    borderBottomColor: inlineStyle.borderBottomColor,
    borderLeftWidth: inlineStyle.borderLeftWidth,
    borderLeftColor: inlineStyle.borderLeftColor,
    borderRightWidth: inlineStyle.borderRightWidth,
    borderRightColor: inlineStyle.borderRightColor,
    padding: inlineStyle.padding,
    paddingTop: inlineStyle.paddingTop,
    paddingRight: inlineStyle.paddingRight,
    paddingBottom: inlineStyle.paddingBottom,
    paddingLeft: inlineStyle.paddingLeft,
    margin: inlineStyle.margin,
    marginTop: inlineStyle.marginTop,
    marginRight: inlineStyle.marginRight,
    marginBottom: inlineStyle.marginBottom,
    marginLeft: inlineStyle.marginLeft,
    display: inlineStyle.display,
    flexDirection: inlineStyle.flexDirection,
    justifyContent: inlineStyle.justifyContent,
    alignItems: inlineStyle.alignItems,
    gap: inlineStyle.gap,
    gridTemplateColumns: inlineStyle.gridTemplateColumns,
    width: inlineStyle.width,
    height: inlineStyle.height,
    minWidth: inlineStyle.minWidth,
    maxWidth: inlineStyle.maxWidth,
    borderRadius: inlineStyle.borderRadius,
  };
}

function estimateElementHeight(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  width: number,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
): number {
  const tagName = element.name || 'div';
  const inlineStyle = parseInlineStyle(element);
  const style = inheritStyle(parentStyle, inlineStyle, tagName);

  const padTop = style.paddingTop ?? style.padding ?? 0;
  const padBottom = style.paddingBottom ?? style.padding ?? 0;
  const padLeft = style.paddingLeft ?? style.padding ?? 0;
  const padRight = style.paddingRight ?? style.padding ?? 0;
  const innerWidth = Math.max(10, width - padLeft - padRight);

  if (tagName === 'img' || tagName === 'svg') {
    const h = parseInt(element.attribs?.['height'] ?? '', 10);
    return (h || 100) + 8;
  }

  let totalChildHeight = 0;
  const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
  const textChildren = element.children.filter((c: any) => c.type === 'text' && c.data?.trim());

  if (tagChildren.length === 0) {
    if (textChildren.length > 0) {
      const text = textChildren.map((c: any) => (c as any).data).join('').trim();
      const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
      totalChildHeight = textCache.measure(doc, text, fontFamily, style.fontSize, innerWidth);
    }
  } else {
    for (const child of element.children) {
      if (child.type === 'tag') {
        totalChildHeight += estimateElementHeight(doc, child as Element, style, innerWidth, textCache, fontAliasSet);
      } else if (child.type === 'text' && (child as any).data?.trim()) {
        const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
        totalChildHeight += textCache.measure(doc, (child as any).data.trim(), fontFamily, style.fontSize, innerWidth);
      }
    }
  }

  const marginTop = style.marginTop ?? 0;
  const marginBottom = style.marginBottom ?? 0;
  return marginTop + padTop + totalChildHeight + padBottom + marginBottom;
}

/**
 * Main dispatcher delegating element rendering to specialized handlers from elementRegistry.
 */
export async function renderElement(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
): Promise<void> {
  const tagName = element.name || 'span';
  const inlineStyle = parseInlineStyle(element);
  const style = inheritStyle(parentStyle, inlineStyle, tagName);

  const registeredRenderer = elementRegistry.get(tagName);
  if (registeredRenderer) {
    await registeredRenderer(
      doc,
      element,
      parentStyle,
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );
    return;
  }

  // 0. Flexbox & Grid Layout containers
  if (
    style.display === 'flex' ||
    style.display === 'grid' ||
    style.display === 'inline-flex' ||
    style.display === 'inline-grid' ||
    style.gridTemplateColumns
  ) {
    await renderFlexContainer(
      doc,
      element,
      style,
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );
    return;
  }

  // 1. Inline container (Badges, tags, and adjacent inline metadata)
  if (isInlineContainer(element)) {
    const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
    let curX = layout.leftMargin;
    const curY = doc.y;
    let rowMaxHeight = 0;

    for (const child of tagChildren) {
      const cStyleRaw = parseInlineStyle(child);
      const cStyle: TextStyle = {
        ...style,
        fontSize: cStyleRaw.fontSize ?? style.fontSize,
        ...cStyleRaw,
      };
      const cFont = resolveFontFamily(cStyle.fontFamily, cStyle.bold, cStyle.italic, fontAliasSet);
      const text = child.children
        .filter((gc: any) => gc.type === 'text')
        .map((gc: any) => gc.data)
        .join('')
        .trim();

      if (!text) continue;

      const padL = cStyle.paddingLeft ?? cStyle.padding ?? 0;
      const padR = cStyle.paddingRight ?? cStyle.padding ?? 0;
      const padT = cStyle.paddingTop ?? cStyle.padding ?? 0;
      const padB = cStyle.paddingBottom ?? cStyle.padding ?? 0;
      const marL = cStyle.marginLeft ?? 0;

      curX += marL;

      doc.font(cFont).fontSize(cStyle.fontSize);
      const textWidth = doc.widthOfString(text);
      const textHeight = doc.heightOfString(text);
      const itemWidth = padL + textWidth + padR;
      const itemHeight = padT + textHeight + padB;

      if (itemHeight > rowMaxHeight) {
        rowMaxHeight = itemHeight;
      }

      if (cStyle.backgroundColor) {
        doc.fillColor(cStyle.backgroundColor).rect(curX, curY, itemWidth, itemHeight).fill();
      }
      if (cStyle.borderWidth && cStyle.borderColor) {
        doc.strokeColor(cStyle.borderColor).lineWidth(cStyle.borderWidth).rect(curX, curY, itemWidth, itemHeight).stroke();
      }

      doc.fillColor(cStyle.color).text(text, curX + padL, curY + padT, { lineBreak: false });
      curX += itemWidth;
    }

    doc.y = curY + (rowMaxHeight > 0 ? rowMaxHeight : 14) + (style.marginBottom ?? 8);
    doc.x = layout.leftMargin;
    return;
  }

  // 2. Box Model Decoration (Containers with background or border or padding)
  const hasBoxDecoration = Boolean(
    style.backgroundColor ||
      style.borderWidth ||
      style.borderLeftWidth ||
      style.borderTopWidth ||
      style.borderBottomWidth ||
      style.borderRightWidth,
  );

  if (hasBoxDecoration && tagName !== 'p' && tagName !== 'span' && tagName !== 'a') {
    const padTop = style.paddingTop ?? style.padding ?? 0;
    const padBottom = style.paddingBottom ?? style.padding ?? 0;
    const padLeft = style.paddingLeft ?? style.padding ?? 0;
    const padRight = style.paddingRight ?? style.padding ?? 0;
    const marginTop = style.marginTop ?? 0;
    const marginBottom = style.marginBottom ?? 0;
    const marginLeft = style.marginLeft ?? 0;
    const marginRight = style.marginRight ?? 0;

    const boxX = layout.leftMargin + marginLeft;
    const boxWidth = layout.contentWidth - marginLeft - marginRight;
    const innerWidth = Math.max(10, boxWidth - padLeft - padRight);

    let innerContentHeight = 0;
    for (const child of element.children) {
      if (child.type === 'tag') {
        innerContentHeight += estimateElementHeight(doc, child as Element, style, innerWidth, textCache, fontAliasSet);
      } else if (child.type === 'text' && (child as any).data?.trim()) {
        const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
        innerContentHeight += textCache.measure(doc, (child as any).data.trim(), fontFamily, style.fontSize, innerWidth);
      }
    }

    const totalBoxHeight = padTop + innerContentHeight + padBottom;

    if (marginTop > 0) {
      doc.y += marginTop;
    }

    const remainingPageSpace = layout.pageBottom - doc.y;
    const pageCapacity = layout.pageBottom - layout.contentTop;
    if (doc.y > layout.contentTop + 60 && totalBoxHeight > remainingPageSpace && totalBoxHeight <= pageCapacity) {
      doc.addPage({
        size: options.format ?? layout.format,
        layout: options.orientation ?? layout.orientation,
        margin: 0,
      });
      doc.y = layout.contentTop;
      doc.x = boxX;
    }

    const startY = doc.y;

    // Draw background
    if (style.backgroundColor) {
      if (style.borderRadius && style.borderRadius > 0) {
        doc.fillColor(style.backgroundColor).roundedRect(boxX, startY, boxWidth, totalBoxHeight, style.borderRadius).fill();
      } else {
        doc.fillColor(style.backgroundColor).rect(boxX, startY, boxWidth, totalBoxHeight).fill();
      }
    }

    // Render children inside box with padded layout
    const innerLayout = Object.create(layout);
    innerLayout.leftMargin = boxX + padLeft;
    innerLayout.contentWidth = innerWidth;

    doc.x = boxX + padLeft;
    doc.y = startY + padTop;

    await processChildren(
      doc,
      element.children,
      style,
      options,
      innerLayout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );

    const renderedChildHeight = Math.max(0, doc.y - (startY + padTop));
    const actualInnerHeight = Math.max(innerContentHeight, renderedChildHeight);
    const actualHeight = padTop + actualInnerHeight + padBottom;

    // Draw borders with actual height
    if (style.borderWidth && style.borderWidth > 0 && style.borderColor) {
      if (style.borderRadius && style.borderRadius > 0) {
        doc.strokeColor(style.borderColor).lineWidth(style.borderWidth).roundedRect(boxX, startY, boxWidth, actualHeight, style.borderRadius).stroke();
      } else {
        doc.strokeColor(style.borderColor).lineWidth(style.borderWidth).rect(boxX, startY, boxWidth, actualHeight).stroke();
      }
    }
    if (style.borderLeftWidth && style.borderLeftWidth > 0) {
      doc
        .moveTo(boxX, startY)
        .lineTo(boxX, startY + actualHeight)
        .lineWidth(style.borderLeftWidth)
        .strokeColor(style.borderLeftColor || style.borderColor || '#000000')
        .stroke();
    }
    if (style.borderTopWidth && style.borderTopWidth > 0 && !style.borderWidth) {
      doc
        .moveTo(boxX, startY)
        .lineTo(boxX + boxWidth, startY)
        .lineWidth(style.borderTopWidth)
        .strokeColor(style.borderTopColor || '#000000')
        .stroke();
    }
    if (style.borderBottomWidth && style.borderBottomWidth > 0 && !style.borderWidth) {
      doc
        .moveTo(boxX, startY + actualHeight)
        .lineTo(boxX + boxWidth, startY + actualHeight)
        .lineWidth(style.borderBottomWidth)
        .strokeColor(style.borderBottomColor || '#000000')
        .stroke();
    }
    if (style.borderRightWidth && style.borderRightWidth > 0 && !style.borderWidth) {
      doc
        .moveTo(boxX + boxWidth, startY)
        .lineTo(boxX + boxWidth, startY + actualHeight)
        .lineWidth(style.borderRightWidth)
        .strokeColor(style.borderRightColor || '#000000')
        .stroke();
    }

    doc.y = startY + actualHeight + marginBottom;
    doc.x = layout.leftMargin;
    return;
  }

  // 3. Block Elements with only inline content (headings, paragraphs, text-only divs)
  if (BLOCK_ELEMENTS.has(tagName) && tagName !== 'span' && tagName !== 'a') {
    if (tagName !== 'br' && tagName !== 'tr' && tagName !== 'thead' && tagName !== 'tbody' && tagName !== 'li') {
      const textOnlyContent = element.children
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.data)
        .join('')
        .trim();

      if (textOnlyContent && element.children.length === 1) {
        renderText(doc, textOnlyContent, style, options, layout, textCache, fontAliasSet);
        return;
      }

      if (hasOnlyInlineChildren(element)) {
        const runs = collectInlineRuns(element, style);
        if (runs.length > 0) {
          renderInlineRuns(doc, runs, style, options, layout, fontAliasSet);
          return;
        }
      }
    }

    await processChildren(
      doc,
      element.children,
      style,
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );
  } else {
    await processChildren(
      doc,
      element.children,
      style,
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );
  }
}

export { elementRegistry };
