import SVGtoPDF from 'svg-to-pdfkit';
import { render } from 'dom-serializer';
import type { Element } from 'domhandler';
import type { PageLayout } from '../core/PageLayout.js';
import type { TextStyle, RenderOptions } from '../types.js';

interface SvgDimensions {
  width: number;
  height: number;
}

function parseDimension(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseFloat(value.replace(/px|pt|em|rem/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function extractSvgDimensions(element: Element): SvgDimensions {
  const attribs = element.attribs || {};
  let width = parseDimension(attribs['width']);
  let height = parseDimension(attribs['height']);

  // Check inline style if width/height not in attributes
  if ((!width || !height) && attribs['style']) {
    const styleStr = attribs['style'];
    const wMatch = styleStr.match(/width\s*:\s*([^;]+)/i);
    const hMatch = styleStr.match(/height\s*:\s*([^;]+)/i);
    if (!width && wMatch?.[1]) width = parseDimension(wMatch[1]);
    if (!height && hMatch?.[1]) height = parseDimension(hMatch[1]);
  }

  // Parse viewBox if available
  if (attribs['viewBox']) {
    const parts = attribs['viewBox']
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] && parts[3]) {
      const vbWidth = parts[2];
      const vbHeight = parts[3];

      if (!width && !height) {
        width = vbWidth;
        height = vbHeight;
      } else if (width && !height) {
        height = (width / vbWidth) * vbHeight;
      } else if (!width && height) {
        width = (height / vbHeight) * vbWidth;
      }
    }
  }

  // Fallbacks if still undefined
  const defaultDim = 150;
  return {
    width: width ?? defaultDim,
    height: height ?? defaultDim,
  };
}

export function renderSvg(
  doc: PDFKit.PDFDocument,
  element: Element,
  parentStyle: TextStyle,
  _options: RenderOptions,
  layout: PageLayout,
): void {
  const { width: originalWidth, height: originalHeight } = extractSvgDimensions(element);
  const spacing = 8;

  let renderWidth = originalWidth;
  let renderHeight = originalHeight;

  // Scale down proportionally if wider than available page width
  if (renderWidth > layout.contentWidth) {
    const ratio = layout.contentWidth / renderWidth;
    renderWidth = layout.contentWidth;
    renderHeight = renderHeight * ratio;
  }

  // Handle page break
  if (doc.y + renderHeight + spacing > layout.pageBottom) {
    doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
    doc.y = layout.contentTop;
    doc.x = layout.leftMargin;
  }

  // Determine horizontal alignment
  let startX = doc.x || layout.leftMargin;
  if (parentStyle.textAlign === 'center') {
    startX = layout.leftMargin + Math.max(0, (layout.contentWidth - renderWidth) / 2);
  } else if (parentStyle.textAlign === 'right') {
    startX = layout.leftMargin + Math.max(0, layout.contentWidth - renderWidth);
  }

  const svgXml = render(element as any, { xmlMode: true });

  try {
    SVGtoPDF(doc as any, svgXml, startX, doc.y, {
      width: renderWidth,
      height: renderHeight,
      preserveAspectRatio: 'xMidYMid meet',
      assumePt: true,
    });
  } catch (err) {
    // Gracefully fallback if SVG is malformed
    console.warn('Warning: Failed to render SVG vector path:', err);
  }

  doc.y += renderHeight + spacing;
  doc.x = layout.leftMargin;
}
