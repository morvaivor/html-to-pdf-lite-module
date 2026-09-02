import { renderText, processChildren } from './textRenderer.js';
import { renderImage } from './imageRenderer.js';
import { renderTable } from './tableRenderer.js';
import { renderList } from './listRenderer.js';
import { parseInlineStyle } from '../core/cacheManager.js';

const FONT_SIZES = {
  h1: 32, h2: 28, h3: 24, h4: 20, h5: 16, h6: 14,
  p: 12, span: 12, div: 12, a: 12, li: 12, td: 12, th: 12,
};

const BLOCK_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'br',
]);

/**
 * Registry associating HTML tags with specialized renderers.
 */
const elementRegistry = new Map();

elementRegistry.set('br', (doc) => {
  doc.text('', doc.x, doc.y);
});

elementRegistry.set('img', (doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) => {
  return renderImage(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache);
});

elementRegistry.set('table', (doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache, renderElementFn) => {
  return renderTable(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache, renderElementFn);
});

elementRegistry.set('ul', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  renderList(doc, element, parentStyle, options, 0, layout, textCache, fontAliasSet);
});

elementRegistry.set('ol', (doc, element, parentStyle, options, layout, textCache, fontAliasSet) => {
  renderList(doc, element, parentStyle, options, 0, layout, textCache, fontAliasSet);
});

/**
 * Main dispatcher delegating element rendering to specialized handlers from elementRegistry.
 */
export async function renderElement(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) {
  const tagName = element.name || 'span';
  const inlineStyle = parseInlineStyle(element);

  const style = {
    ...parentStyle,
    fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? parentStyle.fontSize,
    ...inlineStyle,
  };

  const registeredRenderer = elementRegistry.get(tagName);
  if (registeredRenderer) {
    await registeredRenderer(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache, renderElement);
    return;
  }

  if (BLOCK_ELEMENTS.has(tagName) && tagName !== 'span' && tagName !== 'a') {
    if (tagName !== 'br' && tagName !== 'tr' && tagName !== 'thead' && tagName !== 'tbody' && tagName !== 'li') {
      const textOnlyContent = element.children
        .filter(c => c.type === 'text')
        .map(c => c.data)
        .join('').trim();

      if (textOnlyContent && element.children.length === 1) {
        renderText(doc, textOnlyContent, style, options, layout, textCache, fontAliasSet);
        return;
      }
    }

    await processChildren(doc, element.children, style, options, layout, textCache, fontAliasSet, imageCache, renderElement);
  } else {
    await processChildren(doc, element.children, style, options, layout, textCache, fontAliasSet, imageCache, renderElement);
  }
}

export { elementRegistry };
