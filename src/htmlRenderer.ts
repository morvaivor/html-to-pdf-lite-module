import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { applyCssToElements, parsePageRule } from './cssParser.js';
import { PageLayout } from './core/PageLayout.js';
import { TextMeasureCache, DEFAULT_STYLE } from './core/cacheManager.js';
import { registerFontFaces } from './core/fontManager.js';
import { fetchRemoteResource, decodeDataUri, readLocalFile } from './core/networkSecurity.js';
import { createLogger, type Logger } from './core/logger.js';
import { renderElement } from './renderers/registry.js';
import { renderText } from './renderers/textRenderer.js';
import { renderPageZone, renderHeaderFooterContent } from './renderers/headerFooterRenderer.js';
import type { PdfGenerateOptions, RenderOptions, TextStyle } from './types.js';
import type { Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

const IMPORT_REGEX = /@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"])\s*;/g;

async function resolveCssImports(
  css: string,
  allowedIps?: readonly string[],
  logger?: Logger,
  depth = 0,
): Promise<string> {
  if (!css || depth >= 3 || !css.includes('@import')) return css;

  let match: RegExpExecArray | null;
  IMPORT_REGEX.lastIndex = 0;
  const replacements: Array<{ fullMatch: string; url: string }> = [];

  while ((match = IMPORT_REGEX.exec(css)) !== null) {
    const fullMatch = match[0];
    const url = (match[1] || match[2] || '').trim();
    if (url) {
      replacements.push({ fullMatch, url });
    }
  }

  const resolved = await Promise.all(
    replacements.map(async ({ fullMatch, url }) => {
      try {
        let importedCss = '';
        if (url.startsWith('data:')) {
          importedCss = decodeDataUri(url).toString('utf-8');
          logger?.debug(`CSS chargé à partir de data URI (@import)`);
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          const buf = await fetchRemoteResource(url, allowedIps);
          importedCss = buf.toString('utf-8');
          logger?.debug(`CSS chargé à partir de ${url}`);
        } else {
          importedCss = readLocalFile(url).toString('utf-8');
          logger?.debug(`CSS chargé à partir de ${url}`);
        }
        importedCss = await resolveCssImports(importedCss, allowedIps, logger, depth + 1);
        return { fullMatch, replacement: importedCss };
      } catch (err) {
        logger?.warn(`Erreur de chargement du CSS depuis @import ${url} : ${(err as Error).message}`);
        return { fullMatch, replacement: '' };
      }
    }),
  );

  let result = css;
  for (const { fullMatch, replacement } of resolved) {
    result = result.replace(fullMatch, replacement);
  }

  return result;
}

async function countPages(
  body: Cheerio<AnyNode>,
  options: RenderOptions,
  fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
  textCache: TextMeasureCache,
): Promise<number> {
  const doc = new (PDFDocument as any)({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
    compress: false,
  });

  await registerFontFaces(doc, options.css, options._fontBufferCache, fontAliasSet, options.allowedLocalIps);

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
  doc.addPage = function (opts: any = {}) {
    originalAddPage({ ...opts, margin: 0 });
    pageCount.value++;
  };

  const rootStyle: TextStyle = { ...DEFAULT_STYLE };
  for (const child of body.children().toArray()) {
    if ((child as any).type === 'tag') {
      await renderElement(doc, child as Element, rootStyle, options, layout, textCache, fontAliasSet, imageCache);
    } else if ((child as any).type === 'text' && (child as any).data?.trim()) {
      renderText(doc, (child as any).data.trim(), rootStyle, options, layout, textCache, fontAliasSet);
    }
  }

  return pageCount.value;
}

export async function renderHtmlToPdf(html: string, options: PdfGenerateOptions = {}): Promise<Buffer> {
  const logger = createLogger(options);
  const startTime = performance.now();

  logger.info('Début de la tâche de génération du PDF');

  if (!html || typeof html !== 'string') {
    const errorMsg = 'HTML content must be a non-empty string';
    logger.error(`Echec de construction du pdf : ${errorMsg}`);
    throw new Error(errorMsg);
  }

  logger.debug(`Taille du HTML : ${html.length} caractères (${Buffer.byteLength(html, 'utf-8')} octets)`);

  try {
    // Single-pass AST parsing
    const $ = cheerio.load(html);

    const allowedCssIps = options.allowedCssIps ?? options.allowedLocalIps;

    // Extract external <link rel="stylesheet"> tags from HTML
    const linkElements = $('link[rel="stylesheet"], link[rel="alternate stylesheet"]').toArray();
    const externalStyles: string[] = await Promise.all(
      linkElements.map(async (element) => {
        const href = $(element).attr('href')?.trim();
        if (!href) return '';
        try {
          if (href.startsWith('data:')) {
            logger.debug('CSS chargé à partir de data URI (<link rel="stylesheet">)');
            return decodeDataUri(href).toString('utf-8');
          }
          if (href.startsWith('http://') || href.startsWith('https://')) {
            const buf = await fetchRemoteResource(href, allowedCssIps);
            logger.debug(`CSS chargé à partir de ${href}`);
            return buf.toString('utf-8');
          }
          const buf = readLocalFile(href);
          logger.debug(`CSS chargé à partir du fichier local ${href}`);
          return buf.toString('utf-8');
        } catch (err) {
          logger.warn(`Erreur de chargement du CSS depuis ${href} : ${(err as Error).message}`);
          if (options.strictCss) {
            throw new Error(`Failed to load stylesheet from ${href}: ${(err as Error).message}`, {
              cause: err,
            });
          }
          return '';
        }
      }),
    );
    $('link[rel="stylesheet"], link[rel="alternate stylesheet"]').remove();

    // Extract internal <style> blocks from HTML
    const internalStyles: string[] = [];
    $('style').each((_index, element) => {
      internalStyles.push($(element).text());
    });
    if (internalStyles.length > 0) {
      logger.debug(`CSS chargé à partir de <style> interne (${internalStyles.length} bloc(s))`);
    }
    // Remove <style> elements from DOM so their CSS text is not rendered as document text
    $('style').remove();

    // Handle options.css if it is a remote URL or direct CSS string
    let optionsCss = options.css || '';
    if (optionsCss.trim().startsWith('http://') || optionsCss.trim().startsWith('https://')) {
      const url = optionsCss.trim();
      try {
        const buf = await fetchRemoteResource(url, allowedCssIps);
        optionsCss = buf.toString('utf-8');
        logger.debug(`CSS chargé à partir de l'URL d'options ${url}`);
      } catch (err) {
        logger.warn(`Erreur de chargement du CSS depuis ${url} : ${(err as Error).message}`);
        if (options.strictCss) {
          throw new Error(`Failed to load stylesheet from ${url}: ${(err as Error).message}`, {
            cause: err,
          });
        }
        optionsCss = '';
      }
    } else if (optionsCss.trim()) {
      logger.debug('CSS chargé à partir des options');
    }

    const rawCss = [externalStyles.join('\n'), internalStyles.join('\n'), optionsCss].filter(Boolean).join('\n');
    const fullCss = await resolveCssImports(rawCss, allowedCssIps, logger);

    if (fullCss) {
      applyCssToElements($, fullCss);
    }
    const body = $('body').length > 0 ? $('body') : $(html);

    const pageZones = fullCss ? parsePageRule(fullCss) : null;
    const hasPageHeader = Boolean(
      pageZones && (pageZones['top-left'] || pageZones['top-center'] || pageZones['top-right']),
    );
    const hasPageFooter = Boolean(
      pageZones && (pageZones['bottom-left'] || pageZones['bottom-center'] || pageZones['bottom-right']),
    );
    const hasHeader = !!options.header || hasPageHeader;
    const hasFooter = !!options.footer || hasPageFooter;
    const headerHeight = hasHeader ? 20 : 0;
    const footerHeight = hasFooter ? 20 : 0;

    const renderOptions: RenderOptions = {
      ...options,
      css: fullCss,
      _headerHeight: headerHeight,
      _footerHeight: footerHeight,
      _pageZones: pageZones,
      _fontBufferCache: new Map<string, Buffer>(),
    };

    const fontAliasSet = new Set<string>();
    const imageCache = new Map<string, Buffer>();
    const textCache = new TextMeasureCache();

    // Conditional two-pass rendering
    const needsPageCount = Boolean(pageZones && fullCss.includes('counter(num-pages)'));
    let totalPages = 0;
    if (needsPageCount) {
      totalPages = await countPages(body, renderOptions, fontAliasSet, imageCache, textCache);
    }

    const doc = new (PDFDocument as any)({
      autoFirstPage: false,
      size: options.format || 'A4',
      layout: options.orientation || 'portrait',
      margin: 0,
    });

    await registerFontFaces(doc, fullCss, renderOptions._fontBufferCache, fontAliasSet, renderOptions.allowedLocalIps);

    doc.setMaxListeners(0);

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));

    let currentPage = 0;
    let cachedLayout: PageLayout | null = null;
    const getLayout = (): PageLayout => {
      if (cachedLayout && doc.page.width === cachedLayout.pageWidth && doc.page.height === cachedLayout.pageHeight) {
        return cachedLayout;
      }
      cachedLayout = new PageLayout(doc, renderOptions);
      return cachedLayout;
    };

    // Intercepte doc.addPage() pour injecter dynamiquement les en-têtes,
    // pieds de page et zones CSS @page sur chaque nouvelle page créée
    const originalAddPage = doc.addPage.bind(doc);
    doc.addPage = function (opts: any = {}) {
      originalAddPage({ ...opts, margin: 0 });
      currentPage++;

      const layout = getLayout();
      const cw = layout.contentWidth;
      const savedY = doc.y;
      const savedX = doc.x;
      const footerY = doc.page.height - layout.bottomMargin - layout.footerHeight;
      const halfCw = cw / 2;

      if (pageZones) {
        if (pageZones['top-left']) {
          renderPageZone(
            doc,
            pageZones['top-left'],
            layout.leftMargin,
            layout.topMargin,
            halfCw,
            'left',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['top-center']) {
          renderPageZone(
            doc,
            pageZones['top-center'],
            layout.leftMargin + halfCw * 0.15,
            layout.topMargin,
            halfCw,
            'center',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['top-right']) {
          renderPageZone(
            doc,
            pageZones['top-right'],
            layout.leftMargin + halfCw,
            layout.topMargin,
            halfCw,
            'right',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-left']) {
          renderPageZone(
            doc,
            pageZones['bottom-left'],
            layout.leftMargin,
            footerY,
            halfCw,
            'left',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-center']) {
          renderPageZone(
            doc,
            pageZones['bottom-center'],
            layout.leftMargin + halfCw * 0.15,
            footerY,
            halfCw,
            'center',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-right']) {
          renderPageZone(
            doc,
            pageZones['bottom-right'],
            layout.leftMargin + halfCw,
            footerY,
            halfCw,
            'right',
            currentPage,
            totalPages,
            fontAliasSet,
          );
        }
      }

      if (options.header && !pageZones) {
        const headerHtml = options.header
          .replace('{page}', String(currentPage))
          .replace('{totalPages}', String(totalPages));
        renderHeaderFooterContent(doc, headerHtml, layout.leftMargin, layout.topMargin, cw, 'left', fontAliasSet);
      }

      if (options.footer && !pageZones) {
        const footerHtml = options.footer
          .replace('{page}', String(currentPage))
          .replace('{totalPages}', String(totalPages));
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

    const layout = getLayout();
    doc.x = layout.leftMargin;
    doc.y = layout.contentTop;

    const rootStyle: TextStyle = { ...DEFAULT_STYLE };

    for (const child of body.children().toArray()) {
      if ((child as any).type === 'tag') {
        await renderElement(
          doc,
          child as Element,
          rootStyle,
          renderOptions,
          layout,
          textCache,
          fontAliasSet,
          imageCache,
        );
      } else if ((child as any).type === 'text' && (child as any).data?.trim()) {
        renderText(doc, (child as any).data.trim(), rootStyle, renderOptions, layout, textCache, fontAliasSet);
      }
    }

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);
      doc.end();
    });

    const totalDuration = performance.now() - startTime;
    logger.debug(`Temps de production du html : ${totalDuration.toFixed(2)} ms`);
    logger.info(
      `Tâche de génération du PDF terminée avec succès (taille: ${pdfBuffer.length} octets, temps: ${totalDuration.toFixed(2)} ms)`,
    );

    return pdfBuffer;
  } catch (err) {
    logger.error(`Echec de construction du pdf : ${(err as Error).message}`);
    throw err;
  }
}

export { PageLayout, TextMeasureCache };
