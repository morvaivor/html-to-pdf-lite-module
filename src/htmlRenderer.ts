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
import type { PdfGenerateOptions, RenderOptions, TextStyle, ProfilingTimings } from './types.js';
import type { Element } from 'domhandler';

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

export async function renderHtmlToPdf(html: string, options: PdfGenerateOptions = {}): Promise<Buffer> {
  const logger = createLogger(options);
  const isDebugMode = Boolean(options.debug || logger.isEnabledFor('DEBUG'));
  const isProfiling = Boolean(options.profiling || options.onProfile || isDebugMode);
  const startTime = performance.now();
  let parseHtmlMs = 0;
  let cssMs = 0;
  let fontRegisterMs = 0;
  let layoutRenderMs = 0;
  let pdfAssemblyMs = 0;

  logger.info('Début de la tâche de génération du PDF');

  if (!html || typeof html !== 'string') {
    const errorMsg = 'HTML content must be a non-empty string';
    logger.error(`Echec de construction du pdf : ${errorMsg}`);
    throw new Error(errorMsg);
  }

  logger.debug(`Taille du HTML : ${html.length} caractères (${Buffer.byteLength(html, 'utf-8')} octets)`);

  try {
    // Single-pass AST parsing
    const tParseStart = isProfiling ? performance.now() : 0;
    const $ = cheerio.load(html);
    if (isProfiling) {
      parseHtmlMs = performance.now() - tParseStart;
    }

    const tCssStart = isProfiling ? performance.now() : 0;
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
    if (isProfiling) {
      cssMs = performance.now() - tCssStart;
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

    const doc = new (PDFDocument as any)({
      autoFirstPage: false,
      size: options.format || 'A4',
      layout: options.orientation || 'portrait',
      margin: 0,
      bufferPages: true,
    });

    const tFontStart = isProfiling ? performance.now() : 0;
    await registerFontFaces(doc, fullCss, renderOptions._fontBufferCache, fontAliasSet, renderOptions.allowedLocalIps);
    if (isProfiling) {
      fontRegisterMs = performance.now() - tFontStart;
    }

    doc.setMaxListeners(0);

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));

    let cachedLayout: PageLayout | null = null;
    const getLayout = (): PageLayout => {
      if (cachedLayout && doc.page.width === cachedLayout.pageWidth && doc.page.height === cachedLayout.pageHeight) {
        return cachedLayout;
      }
      cachedLayout = new PageLayout(doc, renderOptions);
      return cachedLayout;
    };

    // Intercepte doc.addPage() pour initialiser les marges de layout
    const originalAddPage = doc.addPage.bind(doc);
    doc.addPage = function (opts: any = {}) {
      originalAddPage({ ...opts, margin: 0 });
      const layout = getLayout();
      doc.x = layout.leftMargin;
      doc.y = layout.contentTop;
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

    const tLayoutStart = isProfiling ? performance.now() : 0;
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

    // Zero-Cost Virtual Page Zone & Header/Footer Emission (Single-pass layout)
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      doc.switchToPage(pageIdx);
      const curPageNum = pageIdx + 1;
      const pageLayout = getLayout();
      const cw = pageLayout.contentWidth;
      const footerY = doc.page.height - pageLayout.bottomMargin - pageLayout.footerHeight;
      const halfCw = cw / 2;

      if (pageZones) {
        if (pageZones['top-left']) {
          renderPageZone(
            doc,
            pageZones['top-left'],
            pageLayout.leftMargin,
            pageLayout.topMargin,
            halfCw,
            'left',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['top-center']) {
          renderPageZone(
            doc,
            pageZones['top-center'],
            pageLayout.leftMargin + halfCw * 0.15,
            pageLayout.topMargin,
            halfCw,
            'center',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['top-right']) {
          renderPageZone(
            doc,
            pageZones['top-right'],
            pageLayout.leftMargin + halfCw,
            pageLayout.topMargin,
            halfCw,
            'right',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-left']) {
          renderPageZone(
            doc,
            pageZones['bottom-left'],
            pageLayout.leftMargin,
            footerY,
            halfCw,
            'left',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-center']) {
          renderPageZone(
            doc,
            pageZones['bottom-center'],
            pageLayout.leftMargin + halfCw * 0.15,
            footerY,
            halfCw,
            'center',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
        if (pageZones['bottom-right']) {
          renderPageZone(
            doc,
            pageZones['bottom-right'],
            pageLayout.leftMargin + halfCw,
            footerY,
            halfCw,
            'right',
            curPageNum,
            totalPages,
            fontAliasSet,
          );
        }
      }

      if (options.header && !pageZones) {
        const headerHtml = options.header
          .replace('{page}', String(curPageNum))
          .replace('{totalPages}', String(totalPages));
        renderHeaderFooterContent(
          doc,
          headerHtml,
          pageLayout.leftMargin,
          pageLayout.topMargin,
          cw,
          'left',
          fontAliasSet,
        );
      }

      if (options.footer && !pageZones) {
        const footerHtml = options.footer
          .replace('{page}', String(curPageNum))
          .replace('{totalPages}', String(totalPages));
        renderHeaderFooterContent(doc, footerHtml, pageLayout.leftMargin, footerY, cw, 'left', fontAliasSet);
      }
    }
    if (isProfiling) {
      layoutRenderMs = performance.now() - tLayoutStart;
    }

    const tAssemblyStart = isProfiling ? performance.now() : 0;
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);
      doc.end();
    });
    if (isProfiling) {
      pdfAssemblyMs = performance.now() - tAssemblyStart;
    }

    const totalDuration = performance.now() - startTime;
    if (isProfiling) {
      const timings: ProfilingTimings = {
        parseHtmlMs,
        cssMs,
        fontRegisterMs,
        layoutRenderMs,
        pdfAssemblyMs,
        totalMs: totalDuration,
      };
      if (isDebugMode) {
        const pct = (ms: number): string => ((ms / (totalDuration || 1)) * 100).toFixed(1);
        logger.debug(
          `[Sondes Profilage] HTML: ${parseHtmlMs.toFixed(2)} ms (${pct(parseHtmlMs)}%) | CSS: ${cssMs.toFixed(2)} ms (${pct(cssMs)}%) | Polices: ${fontRegisterMs.toFixed(2)} ms (${pct(fontRegisterMs)}%) | Layout & Rendu: ${layoutRenderMs.toFixed(2)} ms (${pct(layoutRenderMs)}%) | Assemblage PDF: ${pdfAssemblyMs.toFixed(2)} ms (${pct(pdfAssemblyMs)}%) | Total: ${totalDuration.toFixed(2)} ms`,
        );
      }
      if (options.profiling) {
        logger.info(
          `[Profiling] parseHtml: ${parseHtmlMs.toFixed(2)}ms, css: ${cssMs.toFixed(2)}ms, fontRegister: ${fontRegisterMs.toFixed(2)}ms, layoutRender: ${layoutRenderMs.toFixed(2)}ms, pdfAssembly: ${pdfAssemblyMs.toFixed(2)}ms, total: ${totalDuration.toFixed(2)}ms`,
        );
      }
      options.onProfile?.(timings);
    }

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

/**
 * Generates a PDF from HTML as a progressive Web ReadableStream<Uint8Array>.
 */
export async function renderHtmlToPdfStream(
  html: string,
  options: PdfGenerateOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const buffer = await renderHtmlToPdf(html, options);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      controller.close();
    },
  });
}

export { PageLayout, TextMeasureCache };
