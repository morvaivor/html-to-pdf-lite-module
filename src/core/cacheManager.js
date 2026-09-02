const DEFAULT_STYLE = {
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
  constructor(maxSize = 512) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  measure(doc, text, fontFamily, fontSize, maxWidth) {
    const key = `${fontFamily}|${fontSize}|${maxWidth}|${text.length > 80 ? text.substring(0, 80) + text.length : text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    doc.font(fontFamily).fontSize(fontSize);
    const height = doc.heightOfString(text, { width: maxWidth, lineGap: fontSize * 0.25 });

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, height);
    return height;
  }

  clear() {
    this.cache.clear();
  }
}

// WeakMap inline style cache
const _styleCache = new WeakMap();

/**
 * Parses inline CSS style attributes into an object, using a WeakMap cache.
 */
export function parseInlineStyle(element) {
  const cached = _styleCache.get(element);
  if (cached !== undefined) return cached;

  const styleAttr = element.attribs?.style;
  if (!styleAttr) {
    const empty = {};
    _styleCache.set(element, empty);
    return empty;
  }

  const style = {};
  const rules = styleAttr.split(';');

  for (const rule of rules) {
    const colonIdx = rule.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = rule.substring(0, colonIdx).trim();
    const value = rule.substring(colonIdx + 1).trim();
    if (!prop || !value) continue;

    switch (prop) {
      case 'color':
        style.color = value.startsWith('#') ? value : DEFAULT_STYLE.color;
        break;
      case 'background-color':
        style.backgroundColor = value.startsWith('#') ? value : undefined;
        break;
      case 'font-size':
        style.fontSize = parseInt(value.replace('px', ''), 10) || DEFAULT_STYLE.fontSize;
        break;
      case 'font-weight':
        style.bold = value === 'bold' || parseInt(value, 10) >= 700;
        break;
      case 'font-style':
        style.italic = value === 'italic';
        break;
      case 'font-family':
        style.fontFamily = value.split(',')[0].replace(/['"]/g, '').trim();
        break;
      case 'border':
        style.border = value;
        break;
      case 'border-color':
        style.borderColor = value.startsWith('#') ? value : '#000000';
        break;
      case 'border-width':
        style.borderWidth = parseFloat(value.replace('px', '')) || 1;
        break;
      case 'padding':
        style.padding = parseInt(value.replace('px', ''), 10) || 0;
        break;
      case 'text-align':
        style.textAlign = value;
        break;
    }
  }

  _styleCache.set(element, style);
  return style;
}

export { DEFAULT_STYLE };
