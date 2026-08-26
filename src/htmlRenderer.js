import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { applyCssToElements, parsePageRule, parseFontFaces } from './cssParser.js';

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

let registeredFontAliases = new Set();

async function registerFontFaces(doc, css, fontBufferCache) {
  const faces = parseFontFaces(css);
  if (faces.length === 0) {
    registeredFontAliases = new Set();
    return;
  }

  registeredFontAliases = new Set();
  const aliasesByFamily = new Map();

  for (const face of faces) {
    let buffer = fontBufferCache.get(face.url);
    if (!buffer) {
      if (face.url.startsWith('data:')) {
        buffer = Buffer.from(face.url.split(',')[1], 'base64');
      } else {
        let response;
        try {
          response = await fetch(face.url);
        } catch {
          throw new Error(`Failed to load font from ${face.url}`);
        }
        if (!response.ok) {
          throw new Error(`Failed to load font from ${face.url} (HTTP ${response.status})`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
      }
      fontBufferCache.set(face.url, buffer);
    }

    let suffix = '';
    if (face.bold) suffix += '-Bold';
    if (face.italic) suffix += '-Italic';
    const alias = face.family + suffix;
    doc.registerFont(alias, buffer);
    registeredFontAliases.add(alias);

    if (!aliasesByFamily.has(face.family)) aliasesByFamily.set(face.family, []);
    aliasesByFamily.get(face.family).push({ alias, buffer });
  }

  for (const [family, aliases] of aliasesByFamily) {
    if (!aliases.some(a => a.alias === family)) {
      doc.registerFont(family, aliases[0].buffer);
      registeredFontAliases.add(family);
    }
  }
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
  let name = suffixes.length > 0 ? `${base}${suffixes.join('')}` : base;
  if (registeredFontAliases.size > 0 && !registeredFontAliases.has(name)) {
    let best = null;
    for (const registered of registeredFontAliases) {
      if (registered.startsWith(base) && (best === null || registered.length > best.length)) {
        best = registered;
      }
    }
    if (best) name = best;
  }
  return name;
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
      margin: 0,
    });
    doc.y = topMargin + headerHeight;
    doc.x = leftMargin;
  }

  doc.text(text, doc.x, doc.y, {
    width: contentWidth,
    lineGap: fontSize * 0.25,
  });
}

async function processChildren(doc, children, style, options) {
  for (const child of children) {
    if (child.type === 'tag') {
      await renderElement(doc, child, style, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), style, options);
    }
  }
}

async function loadImage(src) {
  if (src.startsWith('data:')) {
    const match = src.match(/base64,(.*)/);
    if (match) {
      return Buffer.from(match[1], 'base64');
    }
  }

  if (src.startsWith('http://') || src.startsWith('https://')) {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const fullPath = resolve(src);
  if (fullPath.startsWith(process.cwd())) {
    return readFileSync(fullPath);
  }

  return readFileSync(src);
}

function renderImage(doc, element, parentStyle, options) {
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;
  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const footerHeight = options._footerHeight ?? 0;
  const headerHeight = options._headerHeight ?? 0;
  const contentWidth = doc.page.width - leftMargin - rightMargin;
  const pageBottom = doc.page.height - bottomMargin - footerHeight;

  const attribs = element.attribs || {};
  const src = attribs.src || '';
  const imgWidth = parseInt(attribs.width) || 0;
  const imgHeight = parseInt(attribs.height) || 0;

  const spacing = 8;

  if (!src) {
    return Promise.resolve();
  }

  return loadImage(src).then(imgBuffer => {
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

    if (renderWidth > contentWidth) {
      const ratio = contentWidth / renderWidth;
      renderWidth = contentWidth;
      renderHeight = renderHeight * ratio;
    }

    if (doc.y + renderHeight + spacing > pageBottom) {
      doc.addPage({
        size: options.format || 'A4',
        layout: options.orientation || 'portrait',
        margin: 0,
      });
      doc.y = topMargin + headerHeight;
      doc.x = leftMargin;
    }

    doc.image(img, doc.x, doc.y, {
      width: renderWidth,
      height: renderHeight,
    });

    doc.y += renderHeight + spacing;
    doc.x = leftMargin;
  });
}

function getListText(element) {
  return element.children
    .map(c => {
      if (c.type === 'text') return c.data;
      if (c.type === 'tag' && c.name !== 'ul' && c.name !== 'ol') return getListText(c);
      return '';
    })
    .join('')
    .trim();
}

function renderList(doc, element, parentStyle, options, depth) {
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;
  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const footerHeight = options._footerHeight ?? 0;
  const headerHeight = options._headerHeight ?? 0;
  const contentWidth = doc.page.width - leftMargin - rightMargin;
  const pageBottom = doc.page.height - bottomMargin - footerHeight;

  const isOrdered = element.name === 'ol';
  const indent = depth * 20;
  const bulletWidth = isOrdered ? 20 : 10;
  const itemSpacing = 4;
  const fontSize = FONT_SIZES.li || 12;

  let itemIndex = 0;

  const items = [];
  element.children.forEach(child => {
    if (child.type === 'tag' && child.name === 'li') {
      items.push(child);
    }
  });

  for (const item of items) {
    const itemStyle = {
      ...parentStyle,
      ...parseInlineStyle(item),
      fontSize: parseInlineStyle(item).fontSize ?? fontSize,
    };

    const fontFamily = resolveFontFamily(itemStyle.fontFamily, itemStyle.bold, itemStyle.italic);
    const itemFontSize = itemStyle.fontSize;

    const bullet = isOrdered ? `${itemIndex + 1}.` : '•';
    const bulletTextWidth = doc.font(fontFamily).fontSize(itemFontSize).widthOfString(bullet);

    const listContentWidth = contentWidth - indent - bulletWidth;

    const nestedLists = [];
    const textChildren = [];
    item.children.forEach(child => {
      if (child.type === 'tag' && (child.name === 'ul' || child.name === 'ol')) {
        nestedLists.push(child);
      } else {
        textChildren.push(child);
      }
    });

    const text = textChildren
      .map(c => {
        if (c.type === 'text') return c.data;
        if (c.type === 'tag') return c.children.map(gc => gc.type === 'text' ? gc.data : '').join('');
        return '';
      })
      .join('')
      .trim();

    const textHeight = text
      ? measureTextHeight(doc, text, fontFamily, itemFontSize, listContentWidth)
      : 0;

    const lineHeight = Math.max(textHeight, itemFontSize) + itemSpacing;

    if (doc.y + lineHeight > pageBottom) {
      doc.addPage({
        size: options.format || 'A4',
        layout: options.orientation || 'portrait',
        margin: 0,
      });
      doc.y = topMargin + headerHeight;
      doc.x = leftMargin;
    }

    doc.font(fontFamily)
       .fontSize(itemFontSize)
       .fillColor(itemStyle.color);

    doc.x = leftMargin + indent;

    const fullText = text ? bullet + ' ' + text : bullet;

    doc.text(fullText, {
      width: contentWidth - indent,
      lineGap: itemFontSize * 0.25,
    });

    doc.y += itemSpacing;

    for (const nestedList of nestedLists) {
      renderList(doc, nestedList, itemStyle, options, depth + 1);
    }

    itemIndex++;
  }
}

function getCellText(element) {
  return element.children
    .map(c => {
      if (c.type === 'text') return c.data;
      if (c.type === 'tag' && c.name !== 'table') return c.children.map(gc => gc.type === 'text' ? gc.data : '').join('');
      return '';
    })
    .join('')
    .trim();
}

function getCellNestedTables(element) {
  const tables = [];
  element.children.forEach(child => {
    if (child.type === 'tag' && child.name === 'table') {
      tables.push(child);
    }
  });
  return tables;
}

function getCellNonTableChildren(element) {
  const children = [];
  element.children.forEach(child => {
    if (child.type === 'tag' && child.name === 'table') {
      return;
    }
    children.push(child);
  });
  return children;
}

async function renderTable(doc, element, parentStyle, options) {
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

  const borderWidth = defaultBorder ? defaultBorderWidth : 0;
  const borderColor = defaultBorder ? defaultBorderColor : undefined;

  {
    const rowCells = [];
    allRows.forEach(row => {
      const cells = [];
      row.children.forEach(cell => {
        if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
          cells.push(cell);
        }
      });
      rowCells.push(cells);
    });

    allRows.forEach((row, rowIdx) => {
      const data = new Array(maxCols).fill(null);
      if (rowIdx > 0) {
        for (let col = 0; col < maxCols; col++) {
          const prevCell = rowCells[rowIdx - 1][col];
          if (prevCell && prevCell.startRow < rowIdx && prevCell.startRow + prevCell.rowspan > rowIdx) {
            data[col] = prevCell;
          }
        }
      }
      let col = 0;
      for (const cell of rowCells[rowIdx]) {
        while (col < maxCols && data[col] !== null) col++;
        if (col >= maxCols) break;
        const colspan = Math.min(parseInt(cell.attribs.colspan || '1', 10), maxCols - col);
        const rowspan = Math.max(1, Math.min(parseInt(cell.attribs.rowspan || '1', 10), allRows.length - rowIdx));

        const cellStyle = {
          ...parentStyle,
          ...parseInlineStyle(cell),
          fontSize: parseInlineStyle(cell).fontSize ?? FONT_SIZES[cell.name] ?? parentStyle.fontSize,
          bold: cell.name === 'th' || parseInlineStyle(cell).bold || parentStyle.bold,
        };

        const padding = cellStyle.padding ?? defaultPadding;
        const fontFamily = resolveFontFamily(cellStyle.fontFamily, cellStyle.bold, cellStyle.italic);
        const fontSize = cellStyle.fontSize;

        const text = getCellText(cell);
        const textHeight = text ? measureTextHeight(doc, text, fontFamily, fontSize, colWidth - padding * 2) : 0;

        const nestedTables = getCellNestedTables(cell);
        let nestedHeight = 0;
        for (const nt of nestedTables) {
          const ntRows = [];
          nt.children.forEach(child => {
            if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
              child.children.forEach(gc => {
                if (gc.type === 'tag' && gc.name === 'tr') ntRows.push(gc);
              });
            } else if (child.name === 'tr') {
              ntRows.push(child);
            }
          });
          const ntStyle = parseInlineStyle(nt);
          const ntPadding = ntStyle.padding ?? defaultPadding;
          const ntBorderWidth = ntStyle.border ? (ntStyle.borderWidth ?? 1) : 0;
          let ntH = 0;
          for (const ntRow of ntRows) {
            let rh = 0;
            for (const ntCell of ntRow.children) {
              if (ntCell.type === 'tag' && (ntCell.name === 'td' || ntCell.name === 'th')) {
                const ncStyle = parseInlineStyle(ntCell);
                const ncFontSize = ncStyle.fontSize ?? fontSize;
                const ncText = getCellText(ntCell);
                const ncPh = ncStyle.padding ?? ntPadding;
                const ncFf = resolveFontFamily(ncStyle.fontFamily, ncStyle.bold || ntCell.name === 'th', ncStyle.italic);
                rh = Math.max(rh, ncText ? measureTextHeight(doc, ncText, ncFf, ncFontSize, colWidth - ncPh * 2) : 0);
              }
            }
            ntH += rh + (ntPadding * 2) + ntBorderWidth;
          }
          nestedHeight += ntH;
        }

        const cellHeight = Math.max(textHeight, fontSize) + padding * 2 + nestedHeight;

        data[col] = {
          text,
          style: cellStyle,
          padding,
          fontSize,
          fontFamily,
          height: cellHeight,
          colspan,
          rowspan,
          nestedTables,
          nonTableChildren: getCellNonTableChildren(cell),
          rawCell: cell,
          startRow: rowIdx,
          startCol: col,
        };

        for (let r = 0; r < colspan; r++) {
          data[col + r] = data[col];
        }
        col += colspan;
      }
      rowCells[rowIdx] = data;
    });

    const rowHeights = allRows.map((_, rowIdx) => {
      let h = 0;
      for (let col = 0; col < maxCols; col++) {
        const cell = rowCells[rowIdx][col];
        if (cell && cell.startRow === rowIdx) {
          h = Math.max(h, cell.height / cell.rowspan);
        }
      }
      return h + (borderWidth > 0 ? borderWidth : 0);
    });

    const blocks = [];
    {
      let prevStart = 0;
      let blockEnd = 0;
      for (let r = 0; r < allRows.length; r++) {
        blockEnd = Math.max(blockEnd, r);
        for (let col = 0; col < maxCols; col++) {
          const cell = rowCells[r][col];
          if (cell && cell.startRow === r) {
            blockEnd = Math.max(blockEnd, r + cell.rowspan - 1);
          }
        }
        if (r === blockEnd) {
          blocks.push({ start: prevStart, end: r });
          prevStart = r + 1;
        }
      }
      if (prevStart <= blocks[blocks.length - 1].end) {
        blocks.push({ start: prevStart, end: allRows.length - 1 });
      }
    }

    for (const block of blocks) {
      const blockHeight = rowHeights.slice(block.start, block.end + 1).reduce((a, b) => a + b, 0);
      if (doc.y + blockHeight > pageBottom) {
        doc.addPage({
          size: options.format || 'A4',
          layout: options.orientation || 'portrait',
          margin: 0,
        });
        doc.y = topMargin + headerHeight;
        doc.x = leftMargin;
      }

      const blockY = doc.y;
      const rowTop = new Array(allRows.length).fill(0);
      let offset = 0;
      for (let r = block.start; r <= block.end; r++) {
        rowTop[r] = blockY + offset;
        offset += rowHeights[r];
      }

      for (let r = block.start; r <= block.end; r++) {
        let col = 0;
        while (col < maxCols) {
          const cell = rowCells[r][col];
          if (cell && cell.startRow === r) {
            const cellWidth = colWidth * cell.colspan;
            const cellX = leftMargin + cell.startCol * colWidth;
            const cellY = rowTop[r];
            const endRow = Math.min(r + cell.rowspan - 1, allRows.length - 1);
            const cellH = rowTop[endRow] + rowHeights[endRow] - cellY;

            if (cell.style.backgroundColor) {
              doc.fillColor(cell.style.backgroundColor)
                .rect(cellX, cellY, cellWidth, cellH)
                .fill();
            }

            if (borderWidth > 0) {
              doc.strokeColor(borderColor)
                .lineWidth(borderWidth)
                .rect(cellX, cellY, cellWidth, cellH)
                .stroke();
            }

            doc.font(cell.fontFamily)
               .fontSize(cell.fontSize)
               .fillColor(cell.style.color);

            const textX = cellX + cell.padding;
            const textY = cellY + cell.padding + cell.fontSize;
            const textWidth = cellWidth - cell.padding * 2;
            const textH = cell.text ? measureTextHeight(doc, cell.text, cell.fontFamily, cell.fontSize, textWidth) : 0;

            if (cell.text && textH + cell.padding <= cellH) {
              if (cell.style.textAlign === 'center') {
                doc.text(cell.text, textX, textY, { width: textWidth, align: 'center' });
              } else if (cell.style.textAlign === 'right') {
                doc.text(cell.text, textX, textY, { width: textWidth, align: 'right' });
              } else {
                doc.text(cell.text, textX, textY, { width: textWidth });
              }
            }

            if (cell.nestedTables.length > 0) {
              const savedX = doc.x;
              const savedY = doc.y;
              doc.x = cellX;
              doc.y = cellY + cell.padding;
              for (const nt of cell.nestedTables) {
                await renderElement(doc, nt, cell.style, options);
              }
              doc.x = savedX;
              doc.y = savedY;
            }

            col += cell.colspan;
          } else {
            col++;
          }
        }
      }

      doc.y = rowTop[block.end] + rowHeights[block.end];
    }
  }
}

async function renderElement(doc, element, parentStyle, options) {
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

  if (tagName === 'img') {
    await renderImage(doc, element, parentStyle, options);
    return;
  }

  if (tagName === 'table') {
    await renderTable(doc, element, parentStyle, options);
    return;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    renderList(doc, element, parentStyle, options, 0);
    return;
  }

  if (BLOCK_ELEMENTS.has(tagName) && tagName !== 'span' && tagName !== 'a') {
    if (tagName !== 'br' && tagName !== 'tr' && tagName !== 'thead' && tagName !== 'tbody' && tagName !== 'li') {
      const textOnlyContent = element.children
        .filter(c => c.type === 'text')
        .map(c => c.data)
        .join('').trim();

      if (textOnlyContent && element.children.length === 1) {
        renderText(doc, textOnlyContent, style, options);
        return;
      }
    }

    await processChildren(doc, element.children, style, options);
  } else {
    await processChildren(doc, element.children, style, options);
  }
}

function resolvePageZoneContent(zoneProps, currentPage, totalPages) {
  const content = zoneProps.content;
  if (!content) return '';

  let resolved = content;
  resolved = resolved.replace(/counter\s*\(\s*page\s*\)/g, String(currentPage));
  resolved = resolved.replace(/counter\s*\(\s*num-pages\s*\)/g, String(totalPages));
  resolved = resolved.replace(/["']/g, '');
  resolved = resolved.replace(/\s+/g, ' ').trim();
  return resolved;
}

function renderPageZone(doc, zoneProps, x, y, width, align, currentPage, totalPages) {
  const content = resolvePageZoneContent(zoneProps, currentPage, totalPages);
  if (!content) return;

  const fontSize = parseInt(zoneProps['font-size']?.replace('px', ''), 10) || 12;
  const color = zoneProps.color || '#000000';
  const fontFamily = zoneProps['font-family']?.split(',')[0].replace(/['"]/g, '').trim() || 'Helvetica';
  const bold = zoneProps['font-weight'] === 'bold' || parseInt(zoneProps['font-weight'], 10) >= 700;
  const italic = zoneProps['font-style'] === 'italic';

  const resolvedFont = resolveFontFamily(fontFamily, bold, italic);
  const savedX = doc.x;
  const savedY = doc.y;

  doc.x = x;
  doc.y = y;
  doc.font(resolvedFont).fontSize(fontSize).fillColor(color);

  const textOpts = { width: width };
  if (align === 'center') textOpts.align = 'center';
  else if (align === 'right') textOpts.align = 'right';

  doc.text(content, x, y, textOpts);

  doc.x = savedX;
  doc.y = savedY;
}

function renderHeaderFooterContent(doc, html, x, y, width, align) {
  if (!html) return;

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
        fontSize: inlineStyle.fontSize ?? FONT_SIZES[tagName] ?? DEFAULT_STYLE.fontSize,
        ...inlineStyle,
      };

      const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic);
      doc.x = x;
      doc.y = y;
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
      doc.x = x;
      doc.y = y;
      doc.font('Helvetica').fontSize(12).fillColor('#000000');
      const textOpts = { width: width };
      if (align === 'center') textOpts.align = 'center';
      else if (align === 'right') textOpts.align = 'right';
      doc.text(child.data.trim(), x, y, textOpts);
    }
  });

  doc.restore();
  doc.x = savedX;
  doc.y = savedY;
}

async function countPages(html, options) {
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

  await registerFontFaces(doc, options.css, options._fontBufferCache);

  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const leftMargin = options.margin?.left ?? 20;
  const headerHeight = options._headerHeight ?? 0;
  const footerHeight = options._footerHeight ?? 0;

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  doc.x = leftMargin;
  doc.y = topMargin + headerHeight;

  const pageCount = { value: 1 };

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    pageCount.value++;
  };

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, options);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, options);
    }
  }

  return pageCount.value;
}

async function renderHtmlToPdf(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML content must be a non-empty string');
  }

  const $ = cheerio.load(html);

  if (options.css) {
    applyCssToElements($, options.css);
  }

  const body = $('body').length > 0 ? $('body') : $(html);

  const pageZones = options.css ? parsePageRule(options.css) : null;
  const hasPageHeader = pageZones && (pageZones['top-left'] || pageZones['top-center'] || pageZones['top-right']);
  const hasPageFooter = pageZones && (pageZones['bottom-left'] || pageZones['bottom-center'] || pageZones['bottom-right']);
  const hasHeader = !!options.header || hasPageHeader;
  const hasFooter = !!options.footer || hasPageFooter;
  const headerHeight = hasHeader ? 20 : 0;
  const footerHeight = hasFooter ? 20 : 0;

  const renderOptions = {
    ...options,
    _headerHeight: headerHeight,
    _footerHeight: footerHeight,
    _pageZones: pageZones,
  };

   renderOptions._fontBufferCache = new Map();

  const totalPages = await countPages(html, renderOptions);

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  await registerFontFaces(doc, options.css, renderOptions._fontBufferCache);

  doc.setMaxListeners(0);

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));

  const topMargin = options.margin?.top ?? 20;
  const bottomMargin = options.margin?.bottom ?? 20;
  const leftMargin = options.margin?.left ?? 20;
  const rightMargin = options.margin?.right ?? 20;

  let currentPage = 0;

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    currentPage++;

    const cw = doc.page.width - leftMargin - rightMargin;
    const savedY = doc.y;
    const savedX = doc.x;
    const pageHeight = doc.page.height;
    const footerY = pageHeight - bottomMargin - footerHeight;

    if (pageZones) {
      const halfCw = cw / 2;

      if (pageZones['top-left']) {
        renderPageZone(doc, pageZones['top-left'], leftMargin, topMargin, halfCw, 'left', currentPage, totalPages);
      }
      if (pageZones['top-center']) {
        renderPageZone(doc, pageZones['top-center'], leftMargin + halfCw * 0.15, topMargin, halfCw, 'center', currentPage, totalPages);
      }
      if (pageZones['top-right']) {
        renderPageZone(doc, pageZones['top-right'], leftMargin + halfCw, topMargin, halfCw, 'right', currentPage, totalPages);
      }

      if (pageZones['bottom-left']) {
        renderPageZone(doc, pageZones['bottom-left'], leftMargin, footerY, halfCw, 'left', currentPage, totalPages);
      }
      if (pageZones['bottom-center']) {
        renderPageZone(doc, pageZones['bottom-center'], leftMargin + halfCw * 0.15, footerY, halfCw, 'center', currentPage, totalPages);
      }
      if (pageZones['bottom-right']) {
        renderPageZone(doc, pageZones['bottom-right'], leftMargin + halfCw, footerY, halfCw, 'right', currentPage, totalPages);
      }
    }

    if (options.header && !pageZones) {
      const headerHtml = options.header.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, headerHtml, leftMargin, topMargin, cw, 'left');
    }

    if (options.footer && !pageZones) {
      const footerHtml = options.footer.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, footerHtml, leftMargin, footerY, cw, 'left');
    }

    doc.y = savedY;
    doc.x = savedX;
  };

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  doc.x = leftMargin;
  doc.y = topMargin + headerHeight;

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, renderOptions);
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