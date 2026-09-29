import { renderText, renderInlineRuns, processChildren, lineGapFor, transformText } from './textRenderer.js';
import { renderImage } from './imageRenderer.js';
import { renderTable } from './tableRenderer.js';
import { renderList } from './listRenderer.js';
import { renderSvg } from './svgRenderer.js';
import { renderFlexContainer } from './flexGridRenderer.js';
import { parseInlineStyle, DEFAULT_STYLE } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import { computedFontSize, parseLength, PT_PER_PX, USER_AGENT_FONT_SCALE } from '../core/cssLength.js';
import { applyMarginBottom, applyMarginTop, collapsedMarginOverlap } from '../core/blockFlow.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';

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
      estimateElementHeight,
      collectInlineRuns,
    );
  },
);

// Lists receive their own computed style so that items inherit the list's font size and color.
elementRegistry.set('ul', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  const listStyle = inheritStyle(parentStyle, parseInlineStyle(element), element.name);
  renderList(doc, element, listStyle, options, 0, layout, textCache, fontAliasSet);
});

elementRegistry.set('ol', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  const listStyle = inheritStyle(parentStyle, parseInlineStyle(element), element.name);
  renderList(doc, element, listStyle, options, 0, layout, textCache, fontAliasSet);
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
  return tagChildren.every((c) => ['b', 'strong', 'i', 'em', 'span', 'a', 'small', 'code'].includes(c.name));
}

/**
 * Computed-style sharing (as in browser engines): computed styles are pure functions of the parent's
 * computed style, the element's parsed inline style and its tag. Parsed inline styles are already
 * shared per style string, so memoizing on those identities lets siblings (table rows, list items,
 * repeated paragraphs...) share one computed style object instead of allocating ~45-property objects
 * per element and per pass. Keys are weak: the chain is released with the document's root style.
 * Styles are never mutated after creation, which makes sharing safe.
 */
type StyleShareCache = WeakMap<object, WeakMap<object, Map<string, TextStyle>>>;

function sharedStyle(
  cache: StyleShareCache,
  parentStyle: TextStyle,
  inlineStyle: Partial<TextStyle>,
): Map<string, TextStyle> {
  let byInline = cache.get(parentStyle);
  if (byInline === undefined) {
    byInline = new WeakMap();
    cache.set(parentStyle, byInline);
  }
  let byTag = byInline.get(inlineStyle);
  if (byTag === undefined) {
    byTag = new Map();
    byInline.set(inlineStyle, byTag);
  }
  return byTag;
}

const _inlineRunStyleCache: StyleShareCache = new WeakMap();
const _inheritedStyleCache: StyleShareCache = new WeakMap();

function inlineRunStyle(parentStyle: TextStyle, el: Element): TextStyle {
  const childInline = parseInlineStyle(el);
  const byTag = sharedStyle(_inlineRunStyleCache, parentStyle, childInline);
  let childStyle = byTag.get(el.name);
  if (childStyle === undefined) {
    const isBold = el.name === 'b' || el.name === 'strong' || childInline.bold;
    const isItalic = el.name === 'i' || el.name === 'em' || childInline.italic;
    childStyle = {
      ...parentStyle,
      ...childInline,
      bold: Boolean(isBold || parentStyle.bold),
      italic: Boolean(isItalic || parentStyle.italic),
      fontSize: computedFontSize(
        childInline,
        parentStyle.fontSize,
        parentStyle.fontSize * (USER_AGENT_FONT_SCALE[el.name] ?? 1),
      ),
      fontSizeScale: undefined,
      color: childInline.color ?? parentStyle.color,
    };
    byTag.set(el.name, childStyle);
  }
  return childStyle;
}

function collectInlineRuns(element: Element, parentStyle: TextStyle): Array<{ text: string; style: TextStyle }> {
  const runs: Array<{ text: string; style: TextStyle }> = [];

  for (const child of element.children) {
    if (child.type === 'text') {
      const txt = (child as any).data;
      if (txt) {
        runs.push({ text: txt, style: parentStyle });
      }
    } else if (child.type === 'tag') {
      const el = child as Element;
      const innerRuns = collectInlineRuns(el, inlineRunStyle(parentStyle, el));
      runs.push(...innerRuns);
    }
  }

  return runs;
}

function inheritStyle(parentStyle: TextStyle, inlineStyle: Partial<TextStyle>, tagName: string): TextStyle {
  const byTag = sharedStyle(_inheritedStyleCache, parentStyle, inlineStyle);
  let style = byTag.get(tagName);
  if (style === undefined) {
    style = computeInheritedStyle(parentStyle, inlineStyle, tagName);
    byTag.set(tagName, style);
  }
  return style;
}

const _textStyleCache = new WeakMap<TextStyle, TextStyle>();

/**
 * Style of anonymous text inside an element: only the inherited (typographic) properties. The box model
 * (margins, padding, borders, background) belongs to the element and must not be applied again to its
 * text runs.
 */
export function inheritedTextStyle(style: TextStyle): TextStyle {
  let textStyle = _textStyleCache.get(style);
  if (textStyle === undefined) {
    textStyle = {
      fontFamily: style.fontFamily,
      color: style.color,
      fontSize: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textDecoration: style.textDecoration,
      textAlign: style.textAlign,
      textTransform: style.textTransform,
    };
    _textStyleCache.set(style, textStyle);
  }
  return textStyle;
}

/** Root style of the document: the defaults overridden by the inherited properties of `<body>`. */
export function computeRootStyle(body: Element | undefined): TextStyle {
  const defaults: TextStyle = { ...DEFAULT_STYLE };
  if (!body) return defaults;
  return inheritedTextStyle(computeInheritedStyle(defaults, parseInlineStyle(body), 'body'));
}

function computeInheritedStyle(parentStyle: TextStyle, inlineStyle: Partial<TextStyle>, tagName: string): TextStyle {
  return {
    // Propriétés CSS héritables (typographie & texte)
    fontFamily: inlineStyle.fontFamily ?? parentStyle.fontFamily,
    color: inlineStyle.color ?? parentStyle.color,
    fontSize: computedFontSize(
      inlineStyle,
      parentStyle.fontSize,
      parentStyle.fontSize * (USER_AGENT_FONT_SCALE[tagName] ?? 1),
    ),
    bold: inlineStyle.bold ?? (tagName === 'b' || tagName === 'strong' ? true : parentStyle.bold),
    italic: inlineStyle.italic ?? (tagName === 'i' || tagName === 'em' ? true : parentStyle.italic),
    lineHeight: inlineStyle.lineHeight ?? parentStyle.lineHeight,
    letterSpacing: inlineStyle.letterSpacing ?? parentStyle.letterSpacing,
    textDecoration: inlineStyle.textDecoration ?? parentStyle.textDecoration,
    textAlign: inlineStyle.textAlign ?? parentStyle.textAlign,
    textTransform: inlineStyle.textTransform ?? parentStyle.textTransform,
    verticalAlign: inlineStyle.verticalAlign ?? parentStyle.verticalAlign,

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

/** Measures text exactly as `renderText` will draw it (transform, line height and letter spacing). */
function measureStyledText(
  doc: PDFKit.PDFDocument,
  text: string,
  style: TextStyle,
  width: number,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
): number {
  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  return textCache.measure(
    doc,
    transformText(text, style),
    fontFamily,
    style.fontSize,
    width,
    lineGapFor(style),
    style.letterSpacing,
  );
}

interface InlineBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly paddingLeft: number;
  readonly paddingTop: number;
  readonly style: TextStyle;
  readonly font: string;
  readonly text: string;
}

/**
 * Lays out the boxes of an inline container (badges, tags) like inline-blocks: side by side, separated
 * by the white space of the source, with their margins, wrapping onto a new line when a box does not
 * fit. Positions are relative to the container; `height` is the height of all the lines.
 */
function layoutInlineBoxes(
  doc: PDFKit.PDFDocument,
  element: Element,
  style: TextStyle,
  width: number,
  fontAliasSet: Set<string>,
): { boxes: InlineBox[]; height: number } {
  const boxes: InlineBox[] = [];
  let x = 0;
  let y = 0;
  let lineHeight = 0;
  let gap = 0;
  for (const child of element.children) {
    if (child.type === 'text') {
      if (x > 0 && /\s/.test((child as any).data ?? '')) {
        doc.font(resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet)).fontSize(style.fontSize);
        gap = doc.widthOfString(' ');
      }
      continue;
    }
    if (child.type !== 'tag') continue;
    const boxElement = child as Element;
    const boxInline = parseInlineStyle(boxElement);
    const boxStyle: TextStyle = { ...style, fontSize: computedFontSize(boxInline, style.fontSize), ...boxInline };
    const text = boxElement.children
      .filter((gc: any) => gc.type === 'text')
      .map((gc: any) => gc.data)
      .join('')
      .trim();
    if (!text) continue;

    const font = resolveFontFamily(boxStyle.fontFamily, boxStyle.bold, boxStyle.italic, fontAliasSet);
    const paddingLeft = boxStyle.paddingLeft ?? boxStyle.padding ?? 0;
    const paddingRight = boxStyle.paddingRight ?? boxStyle.padding ?? 0;
    const paddingTop = boxStyle.paddingTop ?? boxStyle.padding ?? 0;
    const paddingBottom = boxStyle.paddingBottom ?? boxStyle.padding ?? 0;
    const marginLeft = boxStyle.marginLeft ?? 0;
    const marginRight = boxStyle.marginRight ?? 0;
    const marginTop = boxStyle.marginTop ?? 0;
    const marginBottom = boxStyle.marginBottom ?? 0;
    doc.font(font).fontSize(boxStyle.fontSize);
    const boxWidth = paddingLeft + doc.widthOfString(text) + paddingRight;
    const boxHeight = paddingTop + doc.heightOfString(text) + paddingBottom;

    if (x > 0 && x + gap + marginLeft + boxWidth + marginRight > width) {
      x = 0;
      y += lineHeight;
      lineHeight = 0;
      gap = 0;
    }
    x += gap + marginLeft;
    gap = 0;
    boxes.push({
      x,
      y: y + marginTop,
      width: boxWidth,
      height: boxHeight,
      paddingLeft,
      paddingTop,
      style: boxStyle,
      font,
      text,
    });
    x += boxWidth + marginRight;
    lineHeight = Math.max(lineHeight, marginTop + boxHeight + marginBottom);
  }
  return { boxes, height: y + (lineHeight > 0 ? lineHeight : 14) };
}

function hasBoxDecoration(style: TextStyle): boolean {
  return Boolean(
    style.backgroundColor ||
    style.borderWidth ||
    style.borderLeftWidth ||
    style.borderTopWidth ||
    style.borderBottomWidth ||
    style.borderRightWidth,
  );
}

function isFlexOrGrid(style: TextStyle): boolean {
  return (
    style.display === 'flex' ||
    style.display === 'grid' ||
    style.display === 'inline-flex' ||
    style.display === 'inline-grid' ||
    Boolean(style.gridTemplateColumns)
  );
}

/**
 * Whether `renderElement` lays out the element's vertical margins in the collapsing block flow
 * (`applyMarginTop` / `applyMarginBottom`). Images, SVG, lists and badge rows keep their own spacing.
 */
function collapsesMargins(element: Element, style: TextStyle): boolean {
  const tagName = element.name || 'div';
  if (tagName === 'table') return true;
  if (elementRegistry.has(tagName)) return false;
  if (isFlexOrGrid(style)) return true;
  if (isInlineContainer(element)) return false;
  return BLOCK_ELEMENTS.has(tagName) || (hasBoxDecoration(style) && tagName !== 'span' && tagName !== 'a');
}

/**
 * Height of children stacked in the block flow. With `collapse`, adjacent block siblings save the
 * overlap of their margins, as `applyMarginTop` does when they are rendered (flex and grid items don't).
 */
function stackedChildrenHeight(
  doc: PDFKit.PDFDocument,
  element: Element,
  style: TextStyle,
  innerWidth: number,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
  measurementCache: LayoutMeasurementCache,
  collapse: boolean,
): number {
  let height = 0;
  let previousMarginBottom = 0;
  for (const child of element.children) {
    if (child.type === 'tag') {
      const childElement = child as Element;
      height += estimateElementHeight(doc, childElement, style, innerWidth, textCache, fontAliasSet, measurementCache);
      if (!collapse) continue;
      const childStyle = inheritStyle(style, parseInlineStyle(childElement), childElement.name || 'div');
      if (collapsesMargins(childElement, childStyle)) {
        height -= collapsedMarginOverlap(previousMarginBottom, childStyle.marginTop ?? 0);
        previousMarginBottom = childStyle.marginBottom ?? 0;
      } else {
        previousMarginBottom = 0;
      }
    } else if (child.type === 'text' && (child as any).data?.trim()) {
      height += measureStyledText(doc, (child as any).data.trim(), style, innerWidth, textCache, fontAliasSet);
      previousMarginBottom = 0;
    }
  }
  return height;
}

export type LayoutMeasurementCache = WeakMap<Element, Map<string, number>>;
const _defaultLayoutCache: LayoutMeasurementCache = new WeakMap();

export function estimateElementHeight(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  width: number,
  textCache: TextMeasureCache,
  fontAliasSet: Set<string>,
  measurementCache: LayoutMeasurementCache = _defaultLayoutCache,
): number {
  const tagName = element.name || 'div';
  const inlineStyle = parseInlineStyle(element);
  const style = inheritStyle(parentStyle, inlineStyle, tagName);

  const padTop = style.paddingTop ?? style.padding ?? 0;
  const padBottom = style.paddingBottom ?? style.padding ?? 0;
  const padLeft = style.paddingLeft ?? style.padding ?? 0;
  const padRight = style.paddingRight ?? style.padding ?? 0;
  const innerWidth = Math.max(10, width - padLeft - padRight);

  // Fast cache key capturing all properties that affect calculated height
  const cacheKey = `${Math.round(innerWidth * 10) / 10}|${style.fontFamily || ''}|${style.fontSize || 12}|${style.bold ? 1 : 0}|${style.italic ? 1 : 0}|${style.display || ''}|${style.flexDirection || ''}|${style.lineHeight ?? ''}|${style.letterSpacing ?? ''}|${style.textTransform ?? ''}`;
  let elementCache = measurementCache.get(element);
  if (elementCache) {
    const cachedHeight = elementCache.get(cacheKey);
    if (cachedHeight !== undefined) {
      return cachedHeight;
    }
  }

  const recordResult = (calculatedHeight: number): number => {
    if (!elementCache) {
      elementCache = new Map<string, number>();
      measurementCache.set(element, elementCache);
    }
    elementCache.set(cacheKey, calculatedHeight);
    return calculatedHeight;
  };

  if (isInlineContainer(element) && !elementRegistry.has(tagName) && !isFlexOrGrid(style)) {
    // Same line layout as the rendered badges (no top margin nor padding, like renderElement).
    const inline = layoutInlineBoxes(doc, element, style, width, fontAliasSet);
    return recordResult(inline.height + (style.marginBottom ?? 8));
  }

  if (tagName === 'img' || tagName === 'svg') {
    // HTML width/height attributes are CSS pixels.
    const h = parseLength(element.attribs?.['height']);
    return recordResult((h || 100 * PT_PER_PX) + 8);
  }

  if (tagName === 'table') {
    let tableHeight = 0;
    const rows: Element[] = [];
    for (const child of element.children) {
      if (child.type !== 'tag') continue;
      const el = child as Element;
      if (el.name === 'thead' || el.name === 'tbody' || el.name === 'tfoot') {
        for (const gc of el.children) {
          if (gc.type === 'tag' && (gc as Element).name === 'tr') rows.push(gc as Element);
        }
      } else if (el.name === 'tr') {
        rows.push(el);
      }
    }
    for (const row of rows) {
      let rowMax = 0;
      for (const cell of row.children) {
        if (cell.type === 'tag' && ((cell as Element).name === 'td' || (cell as Element).name === 'th')) {
          const ch = estimateElementHeight(
            doc,
            cell as Element,
            style,
            innerWidth,
            textCache,
            fontAliasSet,
            measurementCache,
          );
          if (ch > rowMax) rowMax = ch;
        }
      }
      tableHeight += rowMax;
    }
    const marginTop = style.marginTop ?? 0;
    const marginBottom = style.marginBottom ?? 0;
    return recordResult(marginTop + padTop + tableHeight + padBottom + marginBottom);
  }

  if (style.display === 'flex' && style.flexDirection !== 'column') {
    let rowMax = 0;
    for (const child of element.children) {
      if (child.type === 'tag') {
        const ch = estimateElementHeight(
          doc,
          child as Element,
          style,
          innerWidth,
          textCache,
          fontAliasSet,
          measurementCache,
        );
        if (ch > rowMax) rowMax = ch;
      }
    }
    const marginTop = style.marginTop ?? 0;
    const marginBottom = style.marginBottom ?? 0;
    return recordResult(marginTop + padTop + rowMax + padBottom + marginBottom);
  }

  let totalChildHeight = 0;
  const tagChildren = element.children.filter((c: any) => c.type === 'tag') as Element[];
  const textChildren = element.children.filter((c: any) => c.type === 'text' && c.data?.trim());

  if (tagChildren.length === 0) {
    if (textChildren.length > 0) {
      const text = textChildren
        .map((c: any) => (c as any).data)
        .join('')
        .trim();
      totalChildHeight = measureStyledText(doc, text, style, innerWidth, textCache, fontAliasSet);
    }
  } else if (
    (BLOCK_ELEMENTS.has(tagName) || tagName === 'td' || tagName === 'th') &&
    !isInlineContainer(element) &&
    hasOnlyInlineChildren(element)
  ) {
    // Rendered as one paragraph of inline runs (renderInlineRuns, table cell runs), not as stacked blocks.
    const text = collectInlineRuns(element, style)
      .map((run) => run.text)
      .join('')
      .trim();
    if (text) totalChildHeight = measureStyledText(doc, text, style, innerWidth, textCache, fontAliasSet);
  } else {
    totalChildHeight = stackedChildrenHeight(
      doc,
      element,
      style,
      innerWidth,
      textCache,
      fontAliasSet,
      measurementCache,
      !isFlexOrGrid(style),
    );
  }

  const marginTop = style.marginTop ?? 0;
  const marginBottom = style.marginBottom ?? 0;
  return recordResult(marginTop + padTop + totalChildHeight + padBottom + marginBottom);
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

  if (style.display === 'none') return;
  if (tagName === 'script' || tagName === 'noscript') return;

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
      estimateElementHeight,
    );
    return;
  }

  // 1. Inline container (Badges, tags, and adjacent inline metadata)
  if (isInlineContainer(element)) {
    const inline = layoutInlineBoxes(doc, element, style, layout.contentWidth, fontAliasSet);
    const top = doc.y;
    for (const box of inline.boxes) {
      const x = layout.leftMargin + box.x;
      const y = top + box.y;
      const boxStyle = box.style;
      if (boxStyle.backgroundColor) {
        doc.fillColor(boxStyle.backgroundColor).rect(x, y, box.width, box.height).fill();
      }
      if (boxStyle.borderWidth && boxStyle.borderColor) {
        doc
          .strokeColor(boxStyle.borderColor)
          .lineWidth(boxStyle.borderWidth)
          .rect(x, y, box.width, box.height)
          .stroke();
      }
      const badgeTextOpts: PDFKit.Mixins.TextOptions = { lineBreak: false };
      if (boxStyle.textDecoration === 'underline') badgeTextOpts.underline = true;
      else if (boxStyle.textDecoration === 'line-through') badgeTextOpts.strike = true;
      doc.font(box.font).fontSize(boxStyle.fontSize).fillColor(boxStyle.color);
      doc.text(box.text, x + box.paddingLeft, y + box.paddingTop, badgeTextOpts);
    }

    doc.y = top + inline.height + (style.marginBottom ?? 8);
    doc.x = layout.leftMargin;
    return;
  }

  // 2. Box Model Decoration (Containers with background or border or padding)
  if (hasBoxDecoration(style) && tagName !== 'p' && tagName !== 'span' && tagName !== 'a') {
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

    const innerContentHeight = stackedChildrenHeight(
      doc,
      element,
      style,
      innerWidth,
      textCache,
      fontAliasSet,
      _defaultLayoutCache,
      true,
    );

    const totalBoxHeight = padTop + innerContentHeight + padBottom;

    applyMarginTop(doc, marginTop);

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
        doc
          .fillColor(style.backgroundColor)
          .roundedRect(boxX, startY, boxWidth, totalBoxHeight, style.borderRadius)
          .fill();
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

    // The box already applied its margins, padding and borders: text runs only inherit typography.
    await processChildren(
      doc,
      element.children,
      inheritedTextStyle(style),
      options,
      innerLayout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );

    const renderedChildHeight = Math.max(0, doc.y - (startY + padTop));
    const actualInnerHeight = renderedChildHeight > 0 ? renderedChildHeight : innerContentHeight;
    const actualHeight = padTop + actualInnerHeight + padBottom;

    // Draw borders with actual height
    if (style.borderWidth && style.borderWidth > 0 && style.borderColor) {
      if (style.borderRadius && style.borderRadius > 0) {
        doc
          .strokeColor(style.borderColor)
          .lineWidth(style.borderWidth)
          .roundedRect(boxX, startY, boxWidth, actualHeight, style.borderRadius)
          .stroke();
      } else {
        doc
          .strokeColor(style.borderColor)
          .lineWidth(style.borderWidth)
          .rect(boxX, startY, boxWidth, actualHeight)
          .stroke();
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

    doc.y = startY + actualHeight;
    applyMarginBottom(doc, marginBottom);
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

    // A block of blocks: its own margins frame the children, whose anonymous text only inherits typography.
    applyMarginTop(doc, style.marginTop ?? 0);
    await processChildren(
      doc,
      element.children,
      inheritedTextStyle(style),
      options,
      layout,
      textCache,
      fontAliasSet,
      imageCache,
      renderElement,
    );
    applyMarginBottom(doc, style.marginBottom ?? 0);
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
