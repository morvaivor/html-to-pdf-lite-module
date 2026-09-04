import type { TextStyle } from '../types.js';

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
  cache: Map<string, number>;
  maxSize: number;

  constructor(maxSize: number = 512) {
    this.cache = new Map<string, number>();
    this.maxSize = maxSize;
  }

  measure(
    doc: PDFKit.PDFDocument,
    text: string,
    fontFamily: string,
    fontSize: number,
    maxWidth: number,
    lineGap?: number,
  ): number {
    const effectiveLineGap = lineGap ?? fontSize * 0.15;
    const key = `${fontFamily}|${fontSize}|${maxWidth}|${effectiveLineGap}|${text.length > 80 ? text.substring(0, 80) + text.length : text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    doc.font(fontFamily).fontSize(fontSize);
    const height = doc.heightOfString(text, { width: maxWidth, lineGap: effectiveLineGap });

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, height);
    return height;
  }

  clear(): void {
    this.cache.clear();
  }
}

// WeakMap inline style cache
const _styleCache = new WeakMap<{ attribs?: { style?: string } }, Partial<TextStyle>>();

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

function parseBoxSpacing(val: string): { top: number; right: number; bottom: number; left: number } {
  const parts = val
    .trim()
    .split(/\s+/)
    .map((p) => parseFloat(p.replace(/(px|pt)/i, '')) || 0);
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

function parseBorderShorthand(val: string): { width: number; style: string; color: string } {
  if (!val || val === 'none' || val === '0') {
    return { width: 0, style: 'none', color: '#000000' };
  }
  const parts = val.trim().split(/\s+/);
  let width = 1;
  let style = 'solid';
  let color = '#000000';

  for (const part of parts) {
    if (/^\d+(\.\d+)?(px|pt)?$/i.test(part)) {
      width = parseFloat(part.replace(/(px|pt)/i, '')) || 1;
    } else if (/^(solid|dashed|dotted|double|none)$/i.test(part)) {
      style = part.toLowerCase();
    } else if (isValidColor(part)) {
      color = part;
    }
  }
  return { width, style, color };
}

/**
 * Parses inline CSS style attributes into an object, using a WeakMap cache.
 */
export function parseInlineStyle(element: { attribs?: { style?: string } }): Partial<TextStyle> {
  const cached = _styleCache.get(element);
  if (cached !== undefined) return cached;

  const styleAttr = element.attribs?.style;
  if (!styleAttr) {
    const empty: Partial<TextStyle> = {};
    _styleCache.set(element, empty);
    return empty;
  }

  const style: Partial<TextStyle> = {};
  const rules = styleAttr.split(';');

  for (const rule of rules) {
    const colonIdx = rule.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = rule.substring(0, colonIdx).trim().toLowerCase();
    const value = rule.substring(colonIdx + 1).trim();
    if (!prop || !value) continue;

    switch (prop) {
      case 'color':
        style.color = isValidColor(value) ? value : DEFAULT_STYLE.color;
        break;
      case 'background':
      case 'background-color':
        style.backgroundColor = isValidColor(value) ? value : undefined;
        break;
      case 'font-size':
        style.fontSize = parseFloat(value.replace(/(px|pt)/i, '')) || DEFAULT_STYLE.fontSize;
        break;
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
        const b = parseBorderShorthand(value);
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
        style.borderWidth = parseFloat(value.replace(/(px|pt)/i, '')) || 1;
        break;
      case 'border-left': {
        const bl = parseBorderShorthand(value);
        style.borderLeftWidth = bl.width;
        style.borderLeftColor = bl.color;
        break;
      }
      case 'border-bottom': {
        const bb = parseBorderShorthand(value);
        style.borderBottomWidth = bb.width;
        style.borderBottomColor = bb.color;
        break;
      }
      case 'border-top': {
        const bt = parseBorderShorthand(value);
        style.borderTopWidth = bt.width;
        style.borderTopColor = bt.color;
        break;
      }
      case 'border-right': {
        const br = parseBorderShorthand(value);
        style.borderRightWidth = br.width;
        style.borderRightColor = br.color;
        break;
      }
      case 'padding': {
        const p = parseBoxSpacing(value);
        style.padding = p.top;
        style.paddingTop = p.top;
        style.paddingRight = p.right;
        style.paddingBottom = p.bottom;
        style.paddingLeft = p.left;
        break;
      }
      case 'padding-top':
        style.paddingTop = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'padding-bottom':
        style.paddingBottom = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'padding-left':
        style.paddingLeft = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'padding-right':
        style.paddingRight = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'margin': {
        const m = parseBoxSpacing(value);
        style.margin = m.top;
        style.marginTop = m.top;
        style.marginRight = m.right;
        style.marginBottom = m.bottom;
        style.marginLeft = m.left;
        break;
      }
      case 'margin-top':
        style.marginTop = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'margin-bottom':
        style.marginBottom = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'margin-left':
        style.marginLeft = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'margin-right':
        style.marginRight = parseFloat(value.replace(/(px|pt)/i, '')) || 0;
        break;
      case 'line-height': {
        const lh = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(lh)) style.lineHeight = lh;
        break;
      }
      case 'letter-spacing': {
        const ls = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(ls)) style.letterSpacing = ls;
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
      case 'text-align':
        style.textAlign = value as TextStyle['textAlign'];
        break;
      case 'flex-direction':
        if (value.toLowerCase() === 'row' || value.toLowerCase() === 'column') {
          style.flexDirection = value.toLowerCase() as TextStyle['flexDirection'];
        }
        break;
      case 'gap': {
        const g = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(g)) style.gap = g;
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
        const mw = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(mw)) style.minWidth = mw;
        break;
      }
      case 'max-width': {
        const mxw = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(mxw)) style.maxWidth = mxw;
        break;
      }
      case 'border-radius': {
        const br = parseFloat(value.replace(/(px|pt)/i, ''));
        if (!isNaN(br)) style.borderRadius = br;
        break;
      }
    }
  }

  _styleCache.set(element, style);
  return style;
}

export { DEFAULT_STYLE };
