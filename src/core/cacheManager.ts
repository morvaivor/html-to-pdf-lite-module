import { LruCache } from './lruCache.js';
import type { TextStyle } from '../types.js';
import { DEFAULT_FONT_SIZE_PT, parseFontSize, parseLength, parseLineHeight } from './cssLength.js';

const DEFAULT_STYLE: TextStyle = {
  color: '#000000',
  fontSize: 12,
  bold: false,
  italic: false,
  fontFamily: 'Helvetica',
};

/**
 * LRU Cache for PDFKit string height calculations.
 */
export class TextMeasureCache {
  cache: LruCache<string, number>;
  maxSize: number;

  constructor(maxSize: number = 512) {
    this.maxSize = maxSize;
    this.cache = new LruCache<string, number>(maxSize);
  }

  measure(
    doc: PDFKit.PDFDocument,
    text: string,
    fontFamily: string,
    fontSize: number,
    maxWidth: number,
    lineGap?: number,
    characterSpacing?: number,
  ): number {
    const effectiveLineGap = lineGap ?? fontSize * 0.15;
    const spacing = characterSpacing ?? 0;
    // Complete key avoids collision between different strings of identical length
    const key =
      spacing === 0
        ? `${fontFamily}|${fontSize}|${maxWidth}|${effectiveLineGap}|${text}`
        : `${fontFamily}|${fontSize}|${maxWidth}|${effectiveLineGap}|cs${spacing}|${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    doc.font(fontFamily).fontSize(fontSize);
    // Letter spacing widens every word, so it changes wrapping and must be measured like it is drawn.
    const height = doc.heightOfString(
      text,
      spacing === 0
        ? { width: maxWidth, lineGap: effectiveLineGap }
        : { width: maxWidth, lineGap: effectiveLineGap, characterSpacing: spacing },
    );

    this.cache.set(key, height);
    return height;
  }

  clear(): void {
    this.cache.clear();
  }
}

// WeakMap inline style cache
const _styleCache = new WeakMap<object, Partial<TextStyle>>();

// LRU Cache for unique inline style attribute strings (avoids periodic cache-thrashing from wholesale clear)
const MAX_PARSED_STYLE_CACHE = 1024;
const _parsedStringStyleCache = new LruCache<string, Partial<TextStyle>>(MAX_PARSED_STYLE_CACHE);

/**
 * Shared (frozen) style of every element without a `style` attribute. A single identity lets the
 * computed-style memoization in the renderers share results between unstyled siblings.
 */
export const EMPTY_INLINE_STYLE: Readonly<Partial<TextStyle>> = Object.freeze({});

const NAMED_COLORS = new Set([
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'cyan',
  'magenta',
  'gray',
  'grey',
  'lightgray',
  'darkgray',
  'orange',
  'purple',
  'brown',
  'pink',
  'indigo',
  'violet',
  'teal',
  'navy',
  'amber',
  'emerald',
  'sky',
  'slate',
  'zinc',
  'neutral',
  'stone',
]);

function isValidColor(c: string): boolean {
  if (!c) return false;
  if (c.startsWith('#')) return true;
  if (c.startsWith('rgb(') || c.startsWith('rgba(')) return true;
  if (c.startsWith('hsl(') || c.startsWith('hsla(')) return true;
  if (NAMED_COLORS.has(c.toLowerCase())) return true;
  return false;
}

function parseBoxSpacing(val: string, emBase: number): { top: number; right: number; bottom: number; left: number } {
  const parts = val
    .trim()
    .split(/\s+/)
    .map((p) => parseLength(p, emBase) ?? 0);
  if (parts.length === 1) {
    const v = parts[0] ?? 0;
    return { top: v, right: v, bottom: v, left: v };
  } else if (parts.length === 2) {
    const [tb = 0, lr = 0] = parts;
    return { top: tb, right: lr, bottom: tb, left: lr };
  } else if (parts.length === 3) {
    const [t = 0, lr = 0, b = 0] = parts;
    return { top: t, right: lr, bottom: b, left: lr };
  } else if (parts.length >= 4) {
    const [t = 0, r = 0, b = 0, l = 0] = parts;
    return { top: t, right: r, bottom: b, left: l };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** `border-width` keywords, in points (1px, 3px and 5px, as browsers draw them). */
const BORDER_WIDTH_KEYWORDS: Readonly<Record<string, number>> = { thin: 0.75, medium: 2.25, thick: 3.75 };

function parseBorderWidth(value: string, emBase: number): number | undefined {
  return BORDER_WIDTH_KEYWORDS[value.toLowerCase()] ?? parseLength(value, emBase);
}

function parseBorderShorthand(val: string, emBase: number): { width: number; style: string; color: string } {
  if (!val || val === 'none' || val === '0') {
    return { width: 0, style: 'none', color: '#000000' };
  }
  const parts = val.trim().split(/\s+/);
  let width = 1;
  let style = 'solid';
  let color = '#000000';

  for (const part of parts) {
    const partWidth = parseBorderWidth(part, emBase);
    if (partWidth !== undefined) {
      width = partWidth;
    } else if (/^(solid|dashed|dotted|double|none|hidden)$/i.test(part)) {
      style = part.toLowerCase();
    } else if (isValidColor(part)) {
      color = part;
    }
  }
  // `none` and `hidden` borders have a computed width of 0.
  if (style === 'none' || style === 'hidden') width = 0;
  return { width, style, color };
}

/**
 * Parses inline CSS style attributes into an object, using a WeakMap cache.
 */
export function parseInlineStyle(element: { attribs?: { style?: string } }): Partial<TextStyle> {
  const cached = _styleCache.get(element);
  if (cached !== undefined) return cached;

  const styleAttr = element.attribs?.style;
  const style = styleAttr ? parseStyleString(styleAttr) : EMPTY_INLINE_STYLE;
  _styleCache.set(element, style);
  return style;
}

/**
 * Records the already-parsed style of an element whose `style` attribute was just rewritten, so that
 * `parseInlineStyle` does not have to hash and re-parse the (long, per-element) attribute string.
 * `style` must be the result of `parseStyleString(element.attribs.style)`.
 */
export function primeInlineStyle(element: object, style: Partial<TextStyle>): void {
  _styleCache.set(element, style);
}

const IMPORTANT_REGEX = /\s*!\s*important\s*$/i;
const FONT_SIZE_DECLARATION_REGEX = /(?:^|;)\s*font-size\s*:\s*([^;]+)/i;

/**
 * Parses a CSS declaration string (inline `style` attribute syntax), memoized by string.
 */
export function parseStyleString(styleAttr: string): Partial<TextStyle> {
  const cachedByString = _parsedStringStyleCache.get(styleAttr);
  if (cachedByString !== undefined) {
    return cachedByString;
  }

  const style: Partial<TextStyle> = {};
  const rules = styleAttr.split(';');

  // `em` lengths resolve against the element's own font size: the one declared in this rule when it
  // is absolute, otherwise the default size (the parent's size is not known at parse time).
  let emBase = DEFAULT_FONT_SIZE_PT;
  const fontSizeMatch = FONT_SIZE_DECLARATION_REGEX.exec(styleAttr);
  if (fontSizeMatch) {
    const declared = parseFontSize((fontSizeMatch[1] as string).replace(IMPORTANT_REGEX, ''));
    emBase = declared.fontSize ?? DEFAULT_FONT_SIZE_PT * (declared.fontSizeScale ?? 1);
  }

  for (const rule of rules) {
    const colonIdx = rule.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = rule.substring(0, colonIdx).trim().toLowerCase();
    // The `!important` priority is not modelled, but the value must still parse.
    const value = rule
      .substring(colonIdx + 1)
      .replace(IMPORTANT_REGEX, '')
      .trim();
    if (!prop || !value) continue;

    switch (prop) {
      case 'color':
        style.color = isValidColor(value) ? value : DEFAULT_STYLE.color;
        break;
      case 'background':
      case 'background-color':
        style.backgroundColor = isValidColor(value) ? value : undefined;
        break;
      case 'font-size': {
        const size = parseFontSize(value);
        if (size.fontSize !== undefined) style.fontSize = size.fontSize;
        else if (size.fontSizeScale !== undefined) style.fontSizeScale = size.fontSizeScale;
        break;
      }
      case 'font-weight':
        style.bold = value === 'bold' || parseInt(value, 10) >= 700;
        break;
      case 'font-style':
        style.italic = value === 'italic';
        break;
      case 'font-family': {
        const family = value.split(',')[0];
        style.fontFamily = family ? family.replace(/['"]/g, '').trim() : DEFAULT_STYLE.fontFamily;
        break;
      }
      case 'border': {
        style.border = value;
        const b = parseBorderShorthand(value, emBase);
        style.borderWidth = b.width;
        style.borderColor = b.color;
        style.borderStyle = b.style;
        style.borderTopWidth = b.width;
        style.borderTopColor = b.color;
        style.borderBottomWidth = b.width;
        style.borderBottomColor = b.color;
        style.borderLeftWidth = b.width;
        style.borderLeftColor = b.color;
        style.borderRightWidth = b.width;
        style.borderRightColor = b.color;
        break;
      }
      case 'border-color':
        style.borderColor = isValidColor(value) ? value : '#000000';
        break;
      case 'border-width':
        style.borderWidth = parseBorderWidth(value.split(/\s+/)[0] as string, emBase) ?? 1;
        break;
      case 'border-left': {
        const bl = parseBorderShorthand(value, emBase);
        style.borderLeftWidth = bl.width;
        style.borderLeftColor = bl.color;
        break;
      }
      case 'border-bottom': {
        const bb = parseBorderShorthand(value, emBase);
        style.borderBottomWidth = bb.width;
        style.borderBottomColor = bb.color;
        break;
      }
      case 'border-top': {
        const bt = parseBorderShorthand(value, emBase);
        style.borderTopWidth = bt.width;
        style.borderTopColor = bt.color;
        break;
      }
      case 'border-right': {
        const br = parseBorderShorthand(value, emBase);
        style.borderRightWidth = br.width;
        style.borderRightColor = br.color;
        break;
      }
      case 'padding': {
        const p = parseBoxSpacing(value, emBase);
        style.padding = p.top;
        style.paddingTop = p.top;
        style.paddingRight = p.right;
        style.paddingBottom = p.bottom;
        style.paddingLeft = p.left;
        break;
      }
      case 'padding-top':
        style.paddingTop = parseLength(value, emBase) ?? 0;
        break;
      case 'padding-bottom':
        style.paddingBottom = parseLength(value, emBase) ?? 0;
        break;
      case 'padding-left':
        style.paddingLeft = parseLength(value, emBase) ?? 0;
        break;
      case 'padding-right':
        style.paddingRight = parseLength(value, emBase) ?? 0;
        break;
      case 'margin': {
        const m = parseBoxSpacing(value, emBase);
        style.margin = m.top;
        style.marginTop = m.top;
        style.marginRight = m.right;
        style.marginBottom = m.bottom;
        style.marginLeft = m.left;
        break;
      }
      case 'margin-top':
        style.marginTop = parseLength(value, emBase) ?? 0;
        break;
      case 'margin-bottom':
        style.marginBottom = parseLength(value, emBase) ?? 0;
        break;
      case 'margin-left':
        style.marginLeft = parseLength(value, emBase) ?? 0;
        break;
      case 'margin-right':
        style.marginRight = parseLength(value, emBase) ?? 0;
        break;
      case 'line-height': {
        const lh = parseLineHeight(value, emBase);
        if (lh !== undefined) style.lineHeight = lh;
        break;
      }
      case 'letter-spacing': {
        const ls = value.toLowerCase() === 'normal' ? 0 : parseLength(value, emBase);
        if (ls !== undefined) style.letterSpacing = ls;
        break;
      }
      case 'text-decoration': {
        const td = value.toLowerCase();
        if (td === 'underline') style.textDecoration = 'underline';
        else if (td === 'line-through') style.textDecoration = 'line-through';
        break;
      }
      case 'text-transform':
        if (['uppercase', 'lowercase', 'capitalize', 'none'].includes(value.toLowerCase())) {
          style.textTransform = value.toLowerCase() as TextStyle['textTransform'];
        }
        break;
      case 'display':
        style.display = value.toLowerCase();
        break;
      case 'vertical-align': {
        const va = value.toLowerCase();
        if (va === 'top' || va === 'text-top') style.verticalAlign = 'top';
        else if (va === 'bottom' || va === 'text-bottom') style.verticalAlign = 'bottom';
        else if (va === 'middle' || va === 'center') style.verticalAlign = 'middle';
        else if (va === 'baseline') style.verticalAlign = 'baseline';
        break;
      }
      case 'text-align':
        style.textAlign = value as TextStyle['textAlign'];
        break;
      case 'flex-direction':
        if (value.toLowerCase() === 'row' || value.toLowerCase() === 'column') {
          style.flexDirection = value.toLowerCase() as TextStyle['flexDirection'];
        }
        break;
      case 'gap': {
        const g = parseLength(value.split(/\s+/)[0], emBase);
        if (g !== undefined) style.gap = g;
        break;
      }
      case 'justify-content': {
        const jc = value.toLowerCase();
        if (['flex-start', 'center', 'flex-end', 'space-between', 'space-around'].includes(jc)) {
          style.justifyContent = jc as TextStyle['justifyContent'];
        }
        break;
      }
      case 'align-items': {
        const ai = value.toLowerCase();
        if (['flex-start', 'center', 'flex-end', 'stretch'].includes(ai)) {
          style.alignItems = ai as TextStyle['alignItems'];
        }
        break;
      }
      case 'grid-template-columns':
        style.gridTemplateColumns = value;
        break;
      case 'width':
        style.width = value;
        break;
      case 'height':
        style.height = value;
        break;
      case 'min-width': {
        const mw = parseLength(value, emBase);
        if (mw !== undefined) style.minWidth = mw;
        break;
      }
      case 'max-width': {
        const mxw = parseLength(value, emBase);
        if (mxw !== undefined) style.maxWidth = mxw;
        break;
      }
      case 'border-radius': {
        const br = parseLength(value.split(/\s+/)[0], emBase);
        if (br !== undefined) style.borderRadius = br;
        break;
      }
    }
  }

  _parsedStringStyleCache.set(styleAttr, style);
  return style;
}

export { DEFAULT_STYLE };
