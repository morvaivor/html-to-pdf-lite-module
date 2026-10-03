import SVGtoPDF from 'svg-to-pdfkit';
import { parseInlineStyle } from '../core/cacheManager.js';
import { parseLength, parseLengthOrPercentage, PT_PER_PX } from '../core/cssLength.js';
import { decodeDataUri, fetchRemoteResource, readLocalFile } from '../core/networkSecurity.js';
import { defaultAssetCache } from '../core/assetCache.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';

export async function loadImage(
  src: string,
  imageCache: Map<string, Buffer>,
  allowedLocalIps?: readonly string[],
): Promise<Buffer | undefined> {
  if (imageCache.has(src)) return imageCache.get(src);

  const loader = async (): Promise<Buffer> => {
    if (src.startsWith('data:')) {
      return decodeDataUri(src);
    } else if (src.startsWith('http://') || src.startsWith('https://')) {
      return fetchRemoteResource(src, allowedLocalIps);
    } else {
      return readLocalFile(src);
    }
  };

  try {
    const buffer = await defaultAssetCache.getImage(src, loader);
    if (buffer) imageCache.set(src, buffer);
    return buffer;
  } catch {
    return undefined;
  }
}

// PDFKit only reuses images opened from string paths (`_imageRegistry`); a Buffer is decoded,
// re-compressed and embedded again for every <img>. Opened images are memoized per document by buffer
// identity (loadImage hands out one Buffer per source), so repeated logos and icons share one XObject.
/** Subset of PDFKit's opened image object (not covered by @types/pdfkit) used for layout. */
interface OpenedImage {
  readonly width: number;
  readonly height: number;
}

const _openedImages = new WeakMap<object, WeakMap<Buffer, OpenedImage>>();

function openImageOnce(doc: PDFKit.PDFDocument, buffer: Buffer): OpenedImage {
  let opened = _openedImages.get(doc);
  if (opened === undefined) {
    opened = new WeakMap();
    _openedImages.set(doc, opened);
  }
  let image = opened.get(buffer);
  if (image === undefined) {
    image = (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(buffer);
    opened.set(buffer, image);
  }
  return image;
}

export function renderImage(
  doc: PDFKit.PDFDocument,
  element: Element,
  _parentStyle: TextStyle,
  options: RenderOptions,
  layout: PageLayout,
  _textCache: TextMeasureCache,
  _fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
): Promise<void> {
  const attribs = element.attribs || {};
  const src = attribs['src'] || '';
  // Size: the CSS width/height (any unit, a width percentage of the content box) win over the HTML
  // width/height attributes, which are CSS pixels.
  const cssStyle = parseInlineStyle(element);
  const cssWidth = cssStyle.width === undefined ? undefined : String(cssStyle.width);
  const cssHeight = cssStyle.height === undefined ? undefined : String(cssStyle.height);
  const imgWidth = parseLengthOrPercentage(cssWidth, layout.contentWidth) || parseLength(attribs['width']) || 0;
  const imgHeight = parseLength(cssHeight) || parseLength(attribs['height']) || 0;
  const spacing = 8;

  if (!src) return Promise.resolve();

  return loadImage(src, imageCache, options.allowedLocalIps).then((imgBuffer) => {
    if (!imgBuffer) return;

    const isSvg =
      src.endsWith('.svg') ||
      src.startsWith('data:image/svg+xml') ||
      imgBuffer.subarray(0, 100).toString('utf8').includes('<svg');

    if (isSvg) {
      let renderWidth = imgWidth || 150 * PT_PER_PX;
      let renderHeight = imgHeight || 150 * PT_PER_PX;

      if (renderWidth > layout.contentWidth) {
        const ratio = layout.contentWidth / renderWidth;
        renderWidth = layout.contentWidth;
        renderHeight = renderHeight * ratio;
      }

      if (doc.y + renderHeight + spacing > layout.pageBottom) {
        doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
        doc.y = layout.contentTop;
        doc.x = layout.leftMargin;
      }

      try {
        SVGtoPDF(doc as any, imgBuffer.toString('utf8'), doc.x, doc.y, {
          width: renderWidth,
          height: renderHeight,
          preserveAspectRatio: 'xMidYMid meet',
          assumePt: false,
        });
      } catch (err) {
        console.warn('Warning: Failed to render SVG image:', err);
      }

      doc.y += renderHeight + spacing;
      doc.x = layout.leftMargin;
      return;
    }

    const img = openImageOnce(doc, imgBuffer);

    // Intrinsic size: one image pixel per CSS pixel, as browsers display images at 1x.
    const intrinsicWidth = img.width * PT_PER_PX;
    const intrinsicHeight = img.height * PT_PER_PX;
    let renderWidth = imgWidth || intrinsicWidth;
    let renderHeight = imgHeight || intrinsicHeight;

    if (imgHeight && imgWidth) {
      renderWidth = imgWidth;
      renderHeight = imgHeight;
    } else if (imgWidth) {
      renderHeight = intrinsicHeight * (imgWidth / intrinsicWidth);
    } else if (imgHeight) {
      renderWidth = intrinsicWidth * (imgHeight / intrinsicHeight);
    }

    if (renderWidth > layout.contentWidth) {
      const ratio = layout.contentWidth / renderWidth;
      renderWidth = layout.contentWidth;
      renderHeight = renderHeight * ratio;
    }

    if (doc.y + renderHeight + spacing > layout.pageBottom) {
      doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
      doc.y = layout.contentTop;
      doc.x = layout.leftMargin;
    }

    // PDFKit's image() accepts an already opened image, which its typings do not declare.
    doc.image(img as unknown as PDFKit.Mixins.ImageSrc, doc.x, doc.y, { width: renderWidth, height: renderHeight });
    doc.y += renderHeight + spacing;
    doc.x = layout.leftMargin;
  });
}
