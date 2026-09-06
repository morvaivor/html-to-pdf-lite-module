import * as cheerio from 'cheerio';
import { parseInlineStyle, DEFAULT_STYLE } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import type { PageZoneProperties, TextAlign } from '../types.js';

const FONT_SIZES_HF: Record<string, number> = {
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

export function resolvePageZoneContent(zoneProps: PageZoneProperties, currentPage: number, totalPages: number): string {
  const content = zoneProps.content;
  if (!content) return '';
  let resolved = content;
  resolved = resolved.replace(/counter\s*\(\s*page\s*\)/g, String(currentPage));
  resolved = resolved.replace(/counter\s*\(\s*num-pages\s*\)/g, String(totalPages));
  resolved = resolved.replace(/["']/g, '');
  resolved = resolved.replace(/\s+/g, ' ').trim();
  return resolved;
}

export function renderPageZone(
  doc: PDFKit.PDFDocument,
  zoneProps: PageZoneProperties,
  x: number,
  y: number,
  width: number,
  align: TextAlign,
  currentPage: number,
  totalPages: number,
  fontAliasSet: Set<string>,
): void {
  const content = resolvePageZoneContent(zoneProps, currentPage, totalPages);
  if (!content) return;

  const fontSize = parseInt(zoneProps['font-size']?.replace('px', '') ?? '', 10) || 12;
  const color = zoneProps.color || '#000000';
  const fontFamily = zoneProps['font-family']?.split(',')[0]?.replace(/['"]/g, '').trim() || 'Helvetica';
  const bold = zoneProps['font-weight'] === 'bold' || parseInt(zoneProps['font-weight'] ?? '', 10) >= 700;
  const italic = zoneProps['font-style'] === 'italic';

  const resolvedFont = resolveFontFamily(fontFamily, bold, italic, fontAliasSet);
  const savedX = doc.x;
  const savedY = doc.y;

  doc.x = x;
  doc.y = y;
  doc.font(resolvedFont).fontSize(fontSize).fillColor(color);

  const textOpts: PDFKit.Mixins.TextOptions = { width };
  if (align === 'center') textOpts.align = 'center';
  else if (align === 'right') textOpts.align = 'right';

  doc.text(content, x, y, textOpts);

  doc.x = savedX;
  doc.y = savedY;
}

export function renderHeaderFooterContent(
  doc: PDFKit.PDFDocument,
  html: string,
  x: number,
  y: number,
  width: number,
  align: TextAlign,
  fontAliasSet: Set<string>,
): void {
  if (!html) return;

  // Plain-text fast path: bypass cheerio loading if no HTML tags are present
  if (!html.includes('<')) {
    const textContent = html.trim();
    if (!textContent) return;
    const savedX = doc.x;
    const savedY = doc.y;
    doc.save();
    doc.x = x;
    doc.y = y;
    doc.font('Helvetica').fontSize(12).fillColor('#000000');
    const textOpts: PDFKit.Mixins.TextOptions = { width };
    if (align === 'center') textOpts.align = 'center';
    else if (align === 'right') textOpts.align = 'right';
    doc.text(textContent, x, y, textOpts);
    doc.restore();
    doc.x = savedX;
    doc.y = savedY;
    return;
  }

  const savedX = doc.x;
  const savedY = doc.y;
  doc.save();

  const $ = cheerio.load(html);
  const body = $('body').length > 0 ? $('body') : $(html);

  body.children().each((_index, child) => {
    if (child.type === 'tag') {
      const inlineStyle = parseInlineStyle(child);
      const tagName = child.name || 'span';
      const style = {
        ...DEFAULT_STYLE,
        fontSize: inlineStyle.fontSize ?? FONT_SIZES_HF[tagName] ?? DEFAULT_STYLE.fontSize,
        ...inlineStyle,
      };

      const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
      doc.x = x;
      doc.y = y;
      doc.font(fontFamily).fontSize(style.fontSize).fillColor(style.color);

      const textContent = child.children
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.data)
        .join('')
        .trim();

      if (textContent) {
        const textOpts: PDFKit.Mixins.TextOptions = { width };
        if (align === 'center') textOpts.align = 'center';
        else if (align === 'right') textOpts.align = 'right';
        doc.text(textContent, x, y, textOpts);
      }
    } else if ((child as any).type === 'text' && (child as any).data?.trim()) {
      doc.x = x;
      doc.y = y;
      doc.font('Helvetica').fontSize(12).fillColor('#000000');
      const textOpts: PDFKit.Mixins.TextOptions = { width };
      if (align === 'center') textOpts.align = 'center';
      else if (align === 'right') textOpts.align = 'right';
      doc.text((child as any).data.trim(), x, y, textOpts);
    }
  });

  doc.restore();
  doc.x = savedX;
  doc.y = savedY;
}
