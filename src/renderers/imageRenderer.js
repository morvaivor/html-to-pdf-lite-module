import { readFileSync } from 'fs';
import { resolve } from 'path';

export async function loadImage(src, imageCache) {
  if (imageCache.has(src)) return imageCache.get(src);

  let buffer;
  if (src.startsWith('data:')) {
    const match = src.match(/base64,(.*)/);
    if (match) {
      buffer = Buffer.from(match[1], 'base64');
    }
  } else if (src.startsWith('http://') || src.startsWith('https://')) {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    const fullPath = resolve(src);
    if (fullPath.startsWith(process.cwd())) {
      buffer = readFileSync(fullPath);
    } else {
      buffer = readFileSync(src);
    }
  }

  if (buffer) imageCache.set(src, buffer);
  return buffer;
}

export function renderImage(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) {
  const attribs = element.attribs || {};
  const src = attribs.src || '';
  const imgWidth = parseInt(attribs.width, 10) || 0;
  const imgHeight = parseInt(attribs.height, 10) || 0;
  const spacing = 8;

  if (!src) return Promise.resolve();

  return loadImage(src, imageCache).then(imgBuffer => {
    const img = doc.openImage(imgBuffer);

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
