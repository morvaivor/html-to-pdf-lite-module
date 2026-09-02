import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { applyCssToElements, parsePageRule } from './cssParser.js';
import { PageLayout } from './core/PageLayout.js';
import { TextMeasureCache, DEFAULT_STYLE } from './core/cacheManager.js';
import { registerFontFaces } from './core/fontManager.js';
import { renderElement } from './renderers/registry.js';
import { renderText } from './renderers/textRenderer.js';
import { renderPageZone, renderHeaderFooterContent } from './renderers/headerFooterRenderer.js';

async function countPages(body, options, fontAliasSet, imageCache, textCache) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  await registerFontFaces(doc, options.css, options._fontBufferCache, fontAliasSet);

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  const layout = new PageLayout(doc, options);

  doc.x = layout.leftMargin;
  doc.y = layout.contentTop;

  const pageCount = { value: 1 };
  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    pageCount.value++;
  };

  const rootStyle = { ...DEFAULT_STYLE };
  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, options, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, options, layout, textCache, fontAliasSet);
    }
  }

  return pageCount.value;
}

export async function renderHtmlToPdf(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML content must be a non-empty string');
  }

  // Single-pass AST parsing
  const $ = cheerio.load(html);
  if (options.css) {
    applyCssToElements($, options.css);
  }
  const body = $('body').length > 0 ? $('body') : $(html);

  const pageZones = options.css ? parsePageRule(options.css) : null;
  const hasPageHeader = pageZones && (pageZones['top-left'] || pageZones['top-center'] || pageZones['top-right']);
  const hasPageFooter = pageZones && (pageZones['bottom-left'] || pageZones['bottom-center'] || pageZones['bottom-right']);
  const hasHeader = !!options.header || hasPageHeader;
  const hasFooter = !!options.footer || hasPageFooter;
  const headerHeight = hasHeader ? 20 : 0;
  const footerHeight = hasFooter ? 20 : 0;

  const renderOptions = {
    ...options,
    _headerHeight: headerHeight,
    _footerHeight: footerHeight,
    _pageZones: pageZones,
  };

  renderOptions._fontBufferCache = new Map();
  const fontAliasSet = new Set();
  const imageCache = new Map();
  const textCache = new TextMeasureCache();

  // Conditional two-pass rendering
  const needsPageCount = pageZones && JSON.stringify(pageZones).includes('counter(num-pages)');
  let totalPages = 0;
  if (needsPageCount) {
    totalPages = await countPages(body, renderOptions, fontAliasSet, imageCache, textCache);
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  await registerFontFaces(doc, options.css, renderOptions._fontBufferCache, fontAliasSet);

  doc.setMaxListeners(0);

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));

  let currentPage = 0;

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    currentPage++;

    const layout = new PageLayout(doc, renderOptions);
    const cw = layout.contentWidth;
    const savedY = doc.y;
    const savedX = doc.x;
    const footerY = doc.page.height - layout.bottomMargin - layout.footerHeight;
    const halfCw = cw / 2;

    if (pageZones) {
      if (pageZones['top-left']) {
        renderPageZone(doc, pageZones['top-left'], layout.leftMargin, layout.topMargin, halfCw, 'left', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['top-center']) {
        renderPageZone(doc, pageZones['top-center'], layout.leftMargin + halfCw * 0.15, layout.topMargin, halfCw, 'center', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['top-right']) {
        renderPageZone(doc, pageZones['top-right'], layout.leftMargin + halfCw, layout.topMargin, halfCw, 'right', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-left']) {
        renderPageZone(doc, pageZones['bottom-left'], layout.leftMargin, footerY, halfCw, 'left', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-center']) {
        renderPageZone(doc, pageZones['bottom-center'], layout.leftMargin + halfCw * 0.15, footerY, halfCw, 'center', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-right']) {
        renderPageZone(doc, pageZones['bottom-right'], layout.leftMargin + halfCw, footerY, halfCw, 'right', currentPage, totalPages, fontAliasSet);
      }
    }

    if (options.header && !pageZones) {
      const headerHtml = options.header.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, headerHtml, layout.leftMargin, layout.topMargin, cw, 'left', fontAliasSet);
    }

    if (options.footer && !pageZones) {
      const footerHtml = options.footer.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, footerHtml, layout.leftMargin, footerY, cw, 'left', fontAliasSet);
    }

    doc.y = savedY;
    doc.x = savedX;
  };

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  const layout = new PageLayout(doc, renderOptions);
  doc.x = layout.leftMargin;
  doc.y = layout.contentTop;

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, renderOptions, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, renderOptions, layout, textCache, fontAliasSet);
    }
  }

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.end();
  });
}

export { PageLayout, TextMeasureCache };