import { decodeDataUri, fetchRemoteResource, readLocalFile } from '../core/networkSecurity.js';
import type { TextStyle, RenderOptions } from '../types.js';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextMeasureCache } from '../core/cacheManager.js';
import type { Element } from 'domhandler';

export async function loadImage(src: string, imageCache: Map<string, Buffer>): Promise<Buffer | undefined> {
  if (imageCache.has(src)) return imageCache.get(src);

  let buffer: Buffer | undefined;
  if (src.startsWith('data:')) {
    buffer = decodeDataUri(src);
  } else if (src.startsWith('http://') || src.startsWith('https://')) {
    buffer = await fetchRemoteResource(src);
  } else {
    buffer = readLocalFile(src);
  }

  if (buffer) imageCache.set(src, buffer);
  return buffer;
}

export function renderImage(
  doc: PDFKit.PDFDocument,
  element: Element,
  _parentStyle: TextStyle,
  _options: RenderOptions,
  layout: PageLayout,
  _textCache: TextMeasureCache,
  _fontAliasSet: Set<string>,
  imageCache: Map<string, Buffer>,
): Promise<void> {
  const attribs = element.attribs || {};
  const src = attribs['src'] || '';
  const imgWidth = parseInt(attribs['width'] ?? '', 10) || 0;
  const imgHeight = parseInt(attribs['height'] ?? '', 10) || 0;
  const spacing = 8;

  if (!src) return Promise.resolve();

  return loadImage(src, imageCache).then((imgBuffer) => {
    if (!imgBuffer) return;
    const img = (doc as any).openImage(imgBuffer);

    let renderWidth = imgWidth || img.width;
    let renderHeight = imgHeight || img.height;

    if (imgHeight && imgWidth) {
      renderWidth = imgWidth;
      renderHeight = imgHeight;
    } else if (imgWidth) {
      const ratio = imgWidth / img.width;
      renderHeight = img.height * ratio;
    } else if (imgHeight) {
      const ratio = imgHeight / img.height;
      renderWidth = img.width * ratio;
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

    doc.image(img, doc.x, doc.y, { width: renderWidth, height: renderHeight });
    doc.y += renderHeight + spacing;
    doc.x = layout.leftMargin;
  });
}
