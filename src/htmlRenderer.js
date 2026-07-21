const cheerio = require('cheerio');
const PDFDocument = require('pdfkit');

const DEFAULT_STYLE = {
  color: '#000000',
  fontSize: 12,
  bold: false,
  italic: false,
  fontFamily: 'Helvetica',
};

const FONT_SIZES = {
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

const BLOCK_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'br',
]);

function parseInlineStyle(element) {
  const styleAttr = element.attribs.style;
  if (!styleAttr) return {};

  const style = {};
  const rules = styleAttr.split(';');

  for (const rule of rules) {
    const parts = rule.split(':').map(s => s.trim());
    const prop = parts[0];
    const value = parts.slice(1).join(':').trim();
    if (!prop || !value) continue;

    switch (prop) {
      case 'color':
        style.color = value.startsWith('#') ? value : DEFAULT_STYLE.color;
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
    }
  }

  return style;
}

function resolveFontFamily(fontFamily, bold, italic) {
  const base = fontFamily || DEFAULT_STYLE.fontFamily;
  const suffixes = [];
  if (bold) suffixes.push('-Bold');
  if (italic) suffixes.push('-Italic');
  return suffixes.length > 0 ? `${base}${suffixes.join('')}` : base;
}

function renderText(doc, text, style, options) {
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;
  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const contentWidth = doc.page.width - leftMargin - rightMargin;
  const pageBottom = doc.page.height - bottomMargin;

  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic);
  const fontSize = style.fontSize;

  doc.font(fontFamily)
     .fontSize(fontSize)
     .fillColor(style.color);

  doc.x = leftMargin;

  const lines = doc.text(text, doc.x, doc.y, {
    width: contentWidth,
    lineGap: fontSize * 0.25,
    dryRun: true,
  });

  const textHeight = lines.reduce((sum, l) => sum + l.height, 0);

  if (doc.y + textHeight > pageBottom) {
    doc.addPage({
      size: options.format || 'A4',
      layout: options.orientation || 'portrait',
    });
    doc.y = topMargin;
    doc.x = leftMargin;
  }

  doc.text(text, doc.x, doc.y, {
    width: contentWidth,
    lineGap: fontSize * 0.25,
  });
}

function processChildren(doc, children, style, options) {
  children.forEach(child => {
    if (child.type === 'tag') {
      renderElement(doc, child, style, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), style, options);
    }
  });
}

function renderElement(doc, element, parentStyle, options) {
  const tagName = element.name || 'span';
  const inlineStyle = parseInlineStyle(element);

  const style = {
    ...parentStyle,
    fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? parentStyle.fontSize,
    ...inlineStyle,
  };

  if (tagName === 'br') {
    doc.text('', doc.x, doc.y);
    return;
  }

  if (BLOCK_ELEMENTS.has(tagName) && tagName !== 'span' && tagName !== 'a') {
    if (tagName !== 'br' && tagName !== 'tr' && tagName !== 'thead' && tagName !== 'tbody') {
      const textOnlyContent = element.children
        .filter(c => c.type === 'text')
        .map(c => c.data)
        .join('').trim();

      if (textOnlyContent && element.children.length === 1) {
        renderText(doc, textOnlyContent, style, options);
      }
    }

    processChildren(doc, element.children, style, options);
  } else {
    processChildren(doc, element.children, style, options);
  }
}

function renderHtmlToPdf(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML content must be a non-empty string');
  }

  const $ = cheerio.load(html);
  const body = $('body').length > 0 ? $('body') : $(html);

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  doc.setMaxListeners(0);

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));

  const topMargin = options.margin?.top ?? 20;
  const leftMargin = options.margin?.left ?? 20;

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
  });

  doc.x = leftMargin;
  doc.y = topMargin;

  const rootStyle = { ...DEFAULT_STYLE };

  body.children().each((_index, child) => {
    if (child.type === 'tag') {
      renderElement(doc, child, rootStyle, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, options);
    }
  });

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { renderHtmlToPdf };