import { renderText, processChildren } from './textRenderer.js';
import { renderImage } from './imageRenderer.js';
import { renderTable } from './tableRenderer.js';
import { renderList } from './listRenderer.js';
import { renderSvg } from './svgRenderer.js';
import { parseInlineStyle } from '../core/cacheManager.js';
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

  const style: TextStyle = {
    ...parentStyle,
    fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? parentStyle.fontSize,
    ...inlineStyle,
  };

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
