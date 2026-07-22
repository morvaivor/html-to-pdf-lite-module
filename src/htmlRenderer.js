import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { applyCssToElements } from './cssParser.js';

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

  return style;
}

function resolveFontFamily(fontFamily, bold, italic) {
  const base = fontFamily || DEFAULT_STYLE.fontFamily;
  const suffixes = [];
  if (bold) suffixes.push('-Bold');
  if (italic) {
    if (base === 'Courier' || base === 'Helvetica') {
      suffixes.push('-Oblique');
    } else {
      suffixes.push('-Italic');
    }
  }
  return suffixes.length > 0 ? `${base}${suffixes.join('')}` : base;
}

function measureTextHeight(doc, text, fontFamily, fontSize, maxWidth) {
  doc.font(fontFamily).fontSize(fontSize);
  return doc.heightOfString(text, {
    width: maxWidth,
    lineGap: fontSize * 0.25,
  });
}

function renderText(doc, text, style, options) {
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;
  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const footerHeight = options._footerHeight ?? 0;
  const headerHeight = options._headerHeight ?? 0;
  const contentWidth = doc.page.width - leftMargin - rightMargin;
  const pageBottom = doc.page.height - bottomMargin - footerHeight;

  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic);
  const fontSize = style.fontSize;

  doc.font(fontFamily)
     .fontSize(fontSize)
     .fillColor(style.color);

  doc.x = leftMargin;

  const textHeight = measureTextHeight(doc, text, fontFamily, fontSize, contentWidth);

  if (doc.y + textHeight > pageBottom) {
    doc.addPage({
      size: options.format || 'A4',
      layout: options.orientation || 'portrait',
    });
    doc.y = topMargin + headerHeight;
    doc.x = leftMargin;
  }

  doc.text(text, doc.x, doc.y, {
    width: contentWidth,
    lineGap: fontSize * 0.25,
  });
}

function processChildren(doc, children, style, options) {
  for (const child of children) {
    if (child.type === 'tag') {
      renderElement(doc, child, style, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), style, options);
    }
  }
}

function getCellText(element) {
  return element.children
    .map(c => {
      if (c.type === 'text') return c.data;
      if (c.type === 'tag') return c.children.map(gc => gc.type === 'text' ? gc.data : '').join('');
      return '';
    })
    .join('')
    .trim();
}

function renderTable(doc, element, parentStyle, options) {
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;
  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const footerHeight = options._footerHeight ?? 0;
  const headerHeight = options._headerHeight ?? 0;
  const contentWidth = doc.page.width - leftMargin - rightMargin;
  const pageBottom = doc.page.height - bottomMargin - footerHeight;

  const tableStyle = parseInlineStyle(element);

  const defaultPadding = tableStyle.padding ?? 4;
  const defaultBorder = tableStyle.border || null;
  const defaultBorderColor = tableStyle.borderColor || '#000000';
  const defaultBorderWidth = tableStyle.borderWidth ?? 1;

  const allRows = [];
  element.children.forEach(child => {
    if (child.type === 'tag') {
      if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
        child.children.forEach(grandchild => {
          if (grandchild.type === 'tag' && grandchild.name === 'tr') {
            allRows.push(grandchild);
          }
        });
      } else if (child.name === 'tr') {
        allRows.push(child);
      }
    }
  });

  if (allRows.length === 0) return;

  let maxCols = 0;
  allRows.forEach(row => {
    let cols = 0;
    row.children.forEach(cell => {
      if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
        cols += parseInt(cell.attribs.colspan || '1', 10);
      }
    });
    if (cols > maxCols) maxCols = cols;
  });

  const colWidth = contentWidth / maxCols;

  const cellData = [];
  for (const row of allRows) {
    const rowData = [];
    for (const cell of row.children) {
      if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
        const cellStyle = {
          ...parentStyle,
          ...parseInlineStyle(cell),
          fontSize: parseInlineStyle(cell).fontSize ?? FONT_SIZES[cell.name] ?? parentStyle.fontSize,
          bold: cell.name === 'th' || parseInlineStyle(cell).bold || parentStyle.bold,
        };

        const text = getCellText(cell);
        const padding = cellStyle.padding ?? defaultPadding;
        const fontFamily = resolveFontFamily(cellStyle.fontFamily, cellStyle.bold, cellStyle.italic);
        const fontSize = cellStyle.fontSize;

        const textHeight = measureTextHeight(doc, text, fontFamily, fontSize, colWidth - padding * 2);
        const cellHeight = textHeight + padding * 2;

        rowData.push({
          text,
          style: cellStyle,
          padding,
          fontSize,
          fontFamily,
          height: cellHeight,
          colspan: parseInt(cell.attribs.colspan || '1', 10),
        });
      }
    }
    cellData.push(rowData);
  }

  const borderWidth = defaultBorder ? defaultBorderWidth : 0;
  const borderColor = defaultBorder ? defaultBorderColor : undefined;

  let rowIdx = 0;
  while (rowIdx < cellData.length) {
    const row = cellData[rowIdx];
    const maxCellHeight = Math.max(...row.map(c => c.height));
    const rowHeight = maxCellHeight + (borderWidth > 0 ? borderWidth : 0);

    if (doc.y + rowHeight > pageBottom) {
      doc.addPage({
        size: options.format || 'A4',
        layout: options.orientation || 'portrait',
      });
      doc.y = topMargin + headerHeight;
      doc.x = leftMargin;
    }

    const y = doc.y;
    let colX = leftMargin;

    for (const cell of row) {
      const cellWidth = colWidth * cell.colspan;
      const cellY = y;

      if (cell.style.backgroundColor) {
        doc.fillColor(cell.style.backgroundColor)
          .rect(colX, cellY, cellWidth, maxCellHeight)
          .fill();
      }

      if (borderWidth > 0) {
        doc.strokeColor(borderColor)
          .lineWidth(borderWidth)
          .rect(colX, cellY, cellWidth, maxCellHeight)
          .stroke();
      }

      doc.font(cell.fontFamily)
         .fontSize(cell.fontSize)
         .fillColor(cell.style.color);

      const textY = cellY + cell.padding + cell.fontSize;
      const textX = colX + cell.padding;

      if (cell.style.textAlign === 'center') {
        doc.text(cell.text, textX, textY, {
          width: cellWidth - cell.padding * 2,
          align: 'center',
        });
      } else if (cell.style.textAlign === 'right') {
        doc.text(cell.text, textX, textY, {
          width: cellWidth - cell.padding * 2,
          align: 'right',
        });
      } else {
        doc.text(cell.text, textX, textY, {
          width: cellWidth - cell.padding * 2,
        });
      }

      colX += cellWidth;
    }

    doc.y = y + maxCellHeight + (borderWidth > 0 ? borderWidth : 0);
    rowIdx++;
  }
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

  if (tagName === 'table') {
    renderTable(doc, element, parentStyle, options);
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

function renderHeaderFooterContent(doc, html, x, y, width, align) {
  if (!html) return;

  const $ = cheerio.load(html);
  const body = $('body').length > 0 ? $('body') : $(html);

  body.children().each((_index, child) => {
    if (child.type === 'tag') {
      const inlineStyle = parseInlineStyle(child);
      const tagName = child.name || 'span';
      const style = {
        ...DEFAULT_STYLE,
        fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? DEFAULT_STYLE.fontSize,
        ...inlineStyle,
      };

      const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic);
      doc.font(fontFamily)
         .fontSize(style.fontSize)
         .fillColor(style.color);

      const textContent = child.children
        .filter(c => c.type === 'text')
        .map(c => c.data)
        .join('')
        .trim();

      if (textContent) {
        const textOpts = { width: width };
        if (align === 'center') textOpts.align = 'center';
        else if (align === 'right') textOpts.align = 'right';

        doc.text(textContent, x, y, textOpts);
      }
    } else if (child.type === 'text' && child.data?.trim()) {
      doc.font('Helvetica').fontSize(12).fillColor('#000000');
      const textOpts = { width: width };
      if (align === 'center') textOpts.align = 'center';
      else if (align === 'right') textOpts.align = 'right';
      doc.text(child.data.trim(), x, y, textOpts);
    }
  });
}

function countPages(html, options) {
  const $ = cheerio.load(html);

  if (options.css) {
    applyCssToElements($, options.css);
  }

  const body = $('body').length > 0 ? $('body') : $(html);

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const leftMargin = options.margin?.left ?? 20;
  const headerHeight = options._headerHeight ?? 0;
  const footerHeight = options._footerHeight ?? 0;

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
  });

  doc.x = leftMargin;
  doc.y = topMargin + headerHeight;

  const pageCount = { value: 1 };

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts) {
    originalAddPage(opts);
    pageCount.value++;
  };

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      renderElement(doc, child, rootStyle, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, options);
    }
  }

  return pageCount.value;
}

function renderHtmlToPdf(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML content must be a non-empty string');
  }

  const $ = cheerio.load(html);

  if (options.css) {
    applyCssToElements($, options.css);
  }

  const body = $('body').length > 0 ? $('body') : $(html);

  const hasHeader = !!options.header;
  const hasFooter = !!options.footer;
  const headerHeight = hasHeader ? 20 : 0;
  const footerHeight = hasFooter ? 20 : 0;

  const renderOptions = {
    ...options,
    _headerHeight: headerHeight,
    _footerHeight: footerHeight,
  };

  const totalPages = countPages(html, renderOptions);

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
  const bottomMargin = options.margin?.bottom ?? 20;
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;

  let currentPage = 0;

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts) {
    originalAddPage(opts);
    currentPage++;

    const cw = doc.page.width - leftMargin - rightMargin;
    const savedY = doc.y;
    const savedX = doc.x;

    if (hasHeader) {
      const headerY = topMargin;
      const headerHtml = options.header.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, headerHtml, leftMargin, headerY, cw, 'left');
    }

    if (hasFooter) {
      const footerY = doc.page.height - footerHeight;
      const footerHtml = options.footer.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, footerHtml, leftMargin, footerY, cw, 'left');
    }

    doc.y = savedY;
    doc.x = savedX;
  };

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
  });

  doc.x = leftMargin;
  doc.y = topMargin + headerHeight;

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      renderElement(doc, child, rootStyle, renderOptions);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, renderOptions);
    }
  }

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.end();
  });
}

export { renderHtmlToPdf };