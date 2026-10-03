import * as cheerio from 'cheerio';
import { parseInlineStyle, DEFAULT_STYLE } from '../core/cacheManager.js';
import { resolveFontFamily } from '../core/fontManager.js';
import { computedFontSize, parseFontSize, USER_AGENT_FONT_SCALE } from '../core/cssLength.js';
import type { PageZoneProperties, TextAlign } from '../types.js';

/** Font size of a @page margin box: its `font-size`, relative to the default size of the page context. */
function zoneFontSize(zoneProps: PageZoneProperties): number {
  const value = zoneProps['font-size'];
  return value ? computedFontSize(parseFontSize(value), DEFAULT_STYLE.fontSize) : DEFAULT_STYLE.fontSize;
}

const COUNTER_REGEX = /^counters?\(\s*([\w-]+)[^)]*\)/i;
const CSS_ESCAPE_REGEX = /\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g;

function unescapeCssString(value: string): string {
  return value.replace(CSS_ESCAPE_REGEX, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex) {
      const codePoint = parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    }
    return char === '\n' ? '' : (char ?? '');
  });
}

/**
 * Resolves the CSS `content` value of a @page margin box: quoted strings (with CSS escapes, so inner
 * apostrophes survive) are concatenated with `counter(page)` and `counter(pages)` / `counter(num-pages)`.
 * Unquoted words are kept, separated by a space, for backward compatibility.
 */
export function resolvePageZoneContent(zoneProps: PageZoneProperties, currentPage: number, totalPages: number): string {
  const content = zoneProps.content?.trim();
  if (!content || content === 'none' || content === 'normal') return '';

  let resolved = '';
  let spaceBefore = false;
  let previousWasWord = false;
  let index = 0;
  while (index < content.length) {
    const char = content[index] as string;
    if (/\s/.test(char)) {
      spaceBefore = true;
      index++;
      continue;
    }

    let token: string;
    let isWord = false;
    const counter = COUNTER_REGEX.exec(content.slice(index));
    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < content.length && content[end] !== char) end += content[end] === '\\' ? 2 : 1;
      token = unescapeCssString(content.slice(index + 1, end));
      index = end + 1;
    } else if (counter) {
      const name = (counter[1] as string).toLowerCase();
      token =
        name === 'page' ? String(currentPage) : name === 'pages' || name === 'num-pages' ? String(totalPages) : '';
      index += counter[0].length;
    } else {
      const word = /^[^\s"']+?(?=\s|"|'|counters?\(|$)/i.exec(content.slice(index))?.[0] ?? char;
      token = word;
      isWord = true;
      index += word.length;
    }

    if (spaceBefore && (isWord || previousWasWord) && resolved) resolved += ' ';
    resolved += token;
    spaceBefore = false;
    previousWasWord = isWord;
  }
  return resolved.replace(/\s+/g, ' ').trim();
}

interface PreparedZone {
  readonly content: string;
  readonly font: string;
  readonly fontSize: number;
  readonly color: string;
}

function preparePageZone(
  zoneProps: PageZoneProperties | undefined,
  currentPage: number,
  totalPages: number,
  fontAliasSet: Set<string>,
): PreparedZone | null {
  if (!zoneProps) return null;
  const content = resolvePageZoneContent(zoneProps, currentPage, totalPages);
  if (!content) return null;
  const fontFamily = zoneProps['font-family']?.split(',')[0]?.replace(/['"]/g, '').trim() || 'Helvetica';
  const bold = zoneProps['font-weight'] === 'bold' || parseInt(zoneProps['font-weight'] ?? '', 10) >= 700;
  const italic = zoneProps['font-style'] === 'italic';
  return {
    content,
    font: resolveFontFamily(fontFamily, bold, italic, fontAliasSet),
    fontSize: zoneFontSize(zoneProps),
    color: zoneProps.color || '#000000',
  };
}

function drawPageZone(
  doc: PDFKit.PDFDocument,
  zone: PreparedZone,
  x: number,
  y: number,
  width: number,
  align: TextAlign,
) {
  doc.font(zone.font).fontSize(zone.fontSize).fillColor(zone.color);
  const textOpts: PDFKit.Mixins.TextOptions = { width: Math.max(1, width) };
  if (align === 'center') textOpts.align = 'center';
  else if (align === 'right') textOpts.align = 'right';
  doc.text(zone.content, x, y, textOpts);
}

/**
 * Lays out one row of @page margin boxes (left, center, right) as CSS Paged Media does: the center box
 * is centered on the page and the side boxes share the remaining width, so their texts cannot overlap.
 */
export function renderPageZoneRow(
  doc: PDFKit.PDFDocument,
  zones: readonly [PageZoneProperties | undefined, PageZoneProperties | undefined, PageZoneProperties | undefined],
  x: number,
  y: number,
  width: number,
  currentPage: number,
  totalPages: number,
  fontAliasSet: Set<string>,
): void {
  const [left, center, right] = zones.map((zone) => preparePageZone(zone, currentPage, totalPages, fontAliasSet));
  if (!left && !center && !right) return;

  // Natural single-line widths, with a small allowance for word-by-word wrapping without kerning.
  const naturalWidth = (zone: PreparedZone | null | undefined): number => {
    if (!zone) return 0;
    doc.font(zone.font).fontSize(zone.fontSize);
    const measured = doc.widthOfString(zone.content);
    return measured + Math.max(2, measured * 0.03);
  };
  const leftWidth = naturalWidth(left);
  const centerWidth = Math.min(width, naturalWidth(center));
  const rightWidth = naturalWidth(right);

  let leftBox: number;
  let rightBox: number;
  if (center) {
    leftBox = (width - centerWidth) / 2;
    rightBox = leftBox;
  } else if (leftWidth + rightWidth <= width) {
    rightBox = rightWidth;
    leftBox = width - rightWidth;
  } else {
    leftBox = (width * leftWidth) / (leftWidth + rightWidth);
    rightBox = width - leftBox;
  }

  const savedX = doc.x;
  const savedY = doc.y;
  if (left) drawPageZone(doc, left, x, y, leftBox, 'left');
  if (center) drawPageZone(doc, center, x + (width - centerWidth) / 2, y, centerWidth, 'center');
  if (right) drawPageZone(doc, right, x + width - rightBox, y, rightBox, 'right');
  doc.x = savedX;
  doc.y = savedY;
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

  const fontSize = zoneFontSize(zoneProps);
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
        fontSize: computedFontSize(
          inlineStyle,
          DEFAULT_STYLE.fontSize,
          DEFAULT_STYLE.fontSize * (USER_AGENT_FONT_SCALE[tagName] ?? 1),
        ),
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
