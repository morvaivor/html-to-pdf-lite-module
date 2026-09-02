import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { applyCssToElements, parsePageRule, parseFontFaces } from './cssParser.js';

// --- Constants ---

const DEFAULT_STYLE = {
  color: '#000000',
  fontSize: 12,
  bold: false,
  italic: false,
  fontFamily: 'Helvetica',
};

const FONT_SIZES = {
  h1: 32, h2: 28, h3: 24, h4: 20, h5: 16, h6: 14,
  p: 12, span: 12, div: 12, a: 12, li: 12, td: 12, th: 12,
};

const BLOCK_ELEMENTS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'br',
]);

// --- Optimization: PageLayout (pre-calculated page geometry) ---

class PageLayout {
  constructor(doc, options) {
    this.leftMargin = options.margin?.left ?? 20;
    this.rightMargin = options.margin?.right ?? 20;
    this.topMargin = options.margin?.top ?? 20;
    this.bottomMargin = options.margin?.bottom ?? 20;
    this.headerHeight = options._headerHeight ?? 0;
    this.footerHeight = options._footerHeight ?? 0;
    this.pageWidth = doc.page.width;
    this.pageHeight = doc.page.height;
    this.contentWidth = this.pageWidth - this.leftMargin - this.rightMargin;
    this.contentTop = this.topMargin + this.headerHeight;
    this.pageBottom = this.pageHeight - this.bottomMargin - this.footerHeight;
    this.format = options.format || 'A4';
    this.orientation = options.orientation || 'portrait';
  }
}

// --- Optimization: TextMeasureCache (LRU cache for heightOfString) ---

class TextMeasureCache {
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

// --- Optimization: WeakMap cache for parseInlineStyle ---

const _styleCache = new WeakMap();

function parseInlineStyle(element) {
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

// --- Optimization: Fix concurrency — scoped font aliases instead of module-global ---

async function registerFontFaces(doc, css, fontBufferCache, fontAliasSet) {
  const faces = parseFontFaces(css);
  fontAliasSet.clear();

  if (faces.length === 0) return;

  const aliasesByFamily = new Map();

  // Optimization: Parallel font loading — download all remote fonts concurrently
  const downloadPromises = faces.map(async (face) => {
    if (fontBufferCache.has(face.url)) return;
    if (face.url.startsWith('data:')) {
      fontBufferCache.set(face.url, Buffer.from(face.url.split(',')[1], 'base64'));
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
      fontBufferCache.set(face.url, Buffer.from(await response.arrayBuffer()));
    }
  });

  await Promise.all(downloadPromises);

  // Register fonts (must be sequential — pdfkit is not concurrent-safe)
  for (const face of faces) {
    const buffer = fontBufferCache.get(face.url);
    let suffix = '';
    if (face.bold) suffix += '-Bold';
    if (face.italic) suffix += '-Italic';
    const alias = face.family + suffix;
    doc.registerFont(alias, buffer);
    fontAliasSet.add(alias);

    if (!aliasesByFamily.has(face.family)) aliasesByFamily.set(face.family, []);
    aliasesByFamily.get(face.family).push({ alias, buffer });
  }

  for (const [family, aliases] of aliasesByFamily) {
    if (!aliases.some(a => a.alias === family)) {
      doc.registerFont(family, aliases[0].buffer);
      fontAliasSet.add(family);
    }
  }
}

function resolveFontFamily(fontFamily, bold, italic, fontAliasSet) {
  const base = fontFamily || DEFAULT_STYLE.fontFamily;
  if (!bold && !italic) return base;

  let name = base;
  if (bold && italic) {
    if (base === 'Courier' || base === 'Helvetica') {
      name = `${base}-BoldOblique`;
    } else if (base === 'Times-Roman' || base === 'Times') {
      name = 'Times-BoldItalic';
    } else {
      name = `${base}-BoldItalic`;
    }
  } else if (bold) {
    name = `${base}-Bold`;
  } else if (italic) {
    if (base === 'Courier' || base === 'Helvetica') {
      name = `${base}-Oblique`;
    } else if (base === 'Times-Roman' || base === 'Times') {
      name = 'Times-Italic';
    } else {
      name = `${base}-Italic`;
    }
  }

  if (fontAliasSet && fontAliasSet.size > 0 && !fontAliasSet.has(name)) {
    let best = null;
    for (const registered of fontAliasSet) {
      if (registered.startsWith(base) && (best === null || registered.length > best.length)) {
        best = registered;
      }
    }
    if (best) name = best;
  }
  return name;
}

// --- Rendering functions (using PageLayout + TextMeasureCache) ---

function renderText(doc, text, style, options, layout, textCache, fontAliasSet) {
  const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
  const fontSize = style.fontSize;

  doc.font(fontFamily).fontSize(fontSize).fillColor(style.color);
  doc.x = layout.leftMargin;

  const textHeight = textCache.measure(doc, text, fontFamily, fontSize, layout.contentWidth);

  if (doc.y + textHeight > layout.pageBottom) {
    doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
    doc.y = layout.contentTop;
    doc.x = layout.leftMargin;
  }

  doc.text(text, doc.x, doc.y, { width: layout.contentWidth, lineGap: fontSize * 0.25 });
}

async function processChildren(doc, children, style, options, layout, textCache, fontAliasSet, imageCache) {
  for (const child of children) {
    if (child.type === 'tag') {
      await renderElement(doc, child, style, options, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), style, options, layout, textCache, fontAliasSet);
    }
  }
}

// --- Optimization: Image cache (shared between passes) ---

async function loadImage(src, imageCache) {
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

function renderImage(doc, element, parentStyle, options, layout, imageCache) {
  const attribs = element.attribs || {};
  const src = attribs.src || '';
  const imgWidth = parseInt(attribs.width) || 0;
  const imgHeight = parseInt(attribs.height) || 0;
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

function getListText(element) {
  let result = '';
  for (let i = 0; i < element.children.length; i++) {
    const c = element.children[i];
    if (c.type === 'text') result += c.data;
    else if (c.type === 'tag' && c.name !== 'ul' && c.name !== 'ol') result += getListText(c);
  }
  return result.trim();
}

function renderList(doc, element, parentStyle, options, depth, layout, textCache, fontAliasSet) {
  const isOrdered = element.name === 'ol';
  const indent = depth * 20;
  const itemSpacing = 4;
  const fontSize = FONT_SIZES.li || 12;

  let itemIndex = 0;

  const items = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.type === 'tag' && child.name === 'li') items.push(child);
  }

  for (const item of items) {
    const inlineStyle = parseInlineStyle(item);
    const itemStyle = {
      ...parentStyle,
      ...inlineStyle,
      fontSize: inlineStyle.fontSize ?? fontSize,
    };

    const fontFamily = resolveFontFamily(itemStyle.fontFamily, itemStyle.bold, itemStyle.italic, fontAliasSet);
    const itemFontSize = itemStyle.fontSize;

    const bullet = isOrdered ? `${itemIndex + 1}.` : '•';
    doc.font(fontFamily).fontSize(itemFontSize).widthOfString(bullet);

    const listContentWidth = layout.contentWidth - indent - (isOrdered ? 20 : 10);

    const nestedLists = [];
    const textChildren = [];
    for (let i = 0; i < item.children.length; i++) {
      const child = item.children[i];
      if (child.type === 'tag' && (child.name === 'ul' || child.name === 'ol')) {
        nestedLists.push(child);
      } else {
        textChildren.push(child);
      }
    }

    let text = '';
    for (let i = 0; i < textChildren.length; i++) {
      const c = textChildren[i];
      if (c.type === 'text') text += c.data;
      else if (c.type === 'tag') {
        for (let j = 0; j < c.children.length; j++) {
          if (c.children[j].type === 'text') text += c.children[j].data;
        }
      }
    }
    text = text.trim();

    const textHeight = text
      ? textCache.measure(doc, text, fontFamily, itemFontSize, listContentWidth)
      : 0;

    const lineHeight = Math.max(textHeight, itemFontSize) + itemSpacing;

    if (doc.y + lineHeight > layout.pageBottom) {
      doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
      doc.y = layout.contentTop;
      doc.x = layout.leftMargin;
    }

    doc.font(fontFamily).fontSize(itemFontSize).fillColor(itemStyle.color);
    doc.x = layout.leftMargin + indent;

    const fullText = text ? bullet + ' ' + text : bullet;
    doc.text(fullText, { width: layout.contentWidth - indent, lineGap: itemFontSize * 0.25 });
    doc.y += itemSpacing;

    for (const nestedList of nestedLists) {
      renderList(doc, nestedList, itemStyle, options, depth + 1, layout, textCache, fontAliasSet);
    }

    itemIndex++;
  }
}

function getCellText(element) {
  let result = '';
  for (let i = 0; i < element.children.length; i++) {
    const c = element.children[i];
    if (c.type === 'text') {
      result += c.data;
    } else if (c.type === 'tag' && c.name !== 'table') {
      for (let j = 0; j < c.children.length; j++) {
        if (c.children[j].type === 'text') result += c.children[j].data;
      }
    }
  }
  return result.trim();
}

function getCellNestedTables(element) {
  const tables = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.type === 'tag' && child.name === 'table') tables.push(child);
  }
  return tables;
}

function getCellNonTableChildren(element) {
  const children = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.type === 'tag' && child.name === 'table') continue;
    children.push(child);
  }
  return children;
}

async function renderTable(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) {
  const tableStyle = parseInlineStyle(element);

  const defaultPadding = tableStyle.padding ?? 4;
  const defaultBorder = tableStyle.border || null;
  const defaultBorderColor = tableStyle.borderColor || '#000000';
  const defaultBorderWidth = tableStyle.borderWidth ?? 1;

  const allRows = [];
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.type === 'tag') {
      if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
        for (let j = 0; j < child.children.length; j++) {
          const grandchild = child.children[j];
          if (grandchild.type === 'tag' && grandchild.name === 'tr') allRows.push(grandchild);
        }
      } else if (child.name === 'tr') {
        allRows.push(child);
      }
    }
  }

  if (allRows.length === 0) return;

  let maxCols = 0;
  for (let r = 0; r < allRows.length; r++) {
    let cols = 0;
    for (let c = 0; c < allRows[r].children.length; c++) {
      const cell = allRows[r].children[c];
      if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
        cols += parseInt(cell.attribs.colspan || '1', 10);
      }
    }
    if (cols > maxCols) maxCols = cols;
  }

  const colWidth = layout.contentWidth / maxCols;
  const borderWidth = defaultBorder ? defaultBorderWidth : 0;
  const borderColor = defaultBorder ? defaultBorderColor : undefined;

  {
    const rowCells = [];
    for (let r = 0; r < allRows.length; r++) {
      const cells = [];
      for (let c = 0; c < allRows[r].children.length; c++) {
        const cell = allRows[r].children[c];
        if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) cells.push(cell);
      }
      rowCells.push(cells);
    }

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
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

        // Optimization: call parseInlineStyle ONCE per cell (was called 3 times before)
        const cellInlineStyle = parseInlineStyle(cell);
        const cellStyle = {
          ...parentStyle,
          ...cellInlineStyle,
          fontSize: cellInlineStyle.fontSize ?? FONT_SIZES[cell.name] ?? parentStyle.fontSize,
          bold: cell.name === 'th' || cellInlineStyle.bold || parentStyle.bold,
        };

        const padding = cellStyle.padding ?? defaultPadding;
        const fontFamily = resolveFontFamily(cellStyle.fontFamily, cellStyle.bold, cellStyle.italic, fontAliasSet);
        const fontSize = cellStyle.fontSize;

        const text = getCellText(cell);
        const textHeight = text ? textCache.measure(doc, text, fontFamily, fontSize, colWidth - padding * 2) : 0;

        const nestedTables = getCellNestedTables(cell);
        let nestedHeight = 0;
        for (const nt of nestedTables) {
          const ntRows = [];
          for (let ci = 0; ci < nt.children.length; ci++) {
            const child = nt.children[ci];
            if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
              for (let gi = 0; gi < child.children.length; gi++) {
                const gc = child.children[gi];
                if (gc.type === 'tag' && gc.name === 'tr') ntRows.push(gc);
              }
            } else if (child.name === 'tr') {
              ntRows.push(child);
            }
          }
          const ntStyle = parseInlineStyle(nt);
          const ntPadding = ntStyle.padding ?? defaultPadding;
          const ntBorderWidth = ntStyle.border ? (ntStyle.borderWidth ?? 1) : 0;
          let ntH = 0;
          for (const ntRow of ntRows) {
            let rh = 0;
            for (let nci = 0; nci < ntRow.children.length; nci++) {
              const ntCell = ntRow.children[nci];
              if (ntCell.type === 'tag' && (ntCell.name === 'td' || ntCell.name === 'th')) {
                const ncStyle = parseInlineStyle(ntCell);
                const ncFontSize = ncStyle.fontSize ?? fontSize;
                const ncText = getCellText(ntCell);
                const ncPh = ncStyle.padding ?? ntPadding;
                const ncFf = resolveFontFamily(ncStyle.fontFamily, ncStyle.bold || ntCell.name === 'th', ncStyle.italic, fontAliasSet);
                rh = Math.max(rh, ncText ? textCache.measure(doc, ncText, ncFf, ncFontSize, colWidth - ncPh * 2) : 0);
              }
            }
            ntH += rh + (ntPadding * 2) + ntBorderWidth;
          }
          nestedHeight += ntH;
        }

        const cellHeight = Math.max(textHeight, fontSize) + padding * 2 + nestedHeight;

        data[col] = {
          text, style: cellStyle, padding, fontSize, fontFamily,
          height: cellHeight, colspan, rowspan, nestedTables,
          nonTableChildren: getCellNonTableChildren(cell),
          rawCell: cell, startRow: rowIdx, startCol: col,
        };

        for (let r = 0; r < colspan; r++) {
          data[col + r] = data[col];
        }
        col += colspan;
      }
      rowCells[rowIdx] = data;
    }

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
      if (doc.y + blockHeight > layout.pageBottom) {
        doc.addPage({ size: layout.format, layout: layout.orientation, margin: 0 });
        doc.y = layout.contentTop;
        doc.x = layout.leftMargin;
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
            const cellX = layout.leftMargin + cell.startCol * colWidth;
            const cellY = rowTop[r];
            const endRow = Math.min(r + cell.rowspan - 1, allRows.length - 1);
            const cellH = rowTop[endRow] + rowHeights[endRow] - cellY;

            if (cell.style.backgroundColor) {
              doc.fillColor(cell.style.backgroundColor).rect(cellX, cellY, cellWidth, cellH).fill();
            }

            if (borderWidth > 0) {
              doc.strokeColor(borderColor).lineWidth(borderWidth).rect(cellX, cellY, cellWidth, cellH).stroke();
            }

            doc.font(cell.fontFamily).fontSize(cell.fontSize).fillColor(cell.style.color);

            const textX = cellX + cell.padding;
            const textY = cellY + cell.padding + cell.fontSize;
            const textWidth = cellWidth - cell.padding * 2;
            // Optimization: reuse cached textHeight instead of re-measuring
            const textH = cell.text ? textCache.measure(doc, cell.text, cell.fontFamily, cell.fontSize, textWidth) : 0;

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
                await renderElement(doc, nt, cell.style, options, layout, textCache, fontAliasSet, imageCache);
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

async function renderElement(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache) {
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
    await renderImage(doc, element, parentStyle, options, layout, imageCache);
    return;
  }

  if (tagName === 'table') {
    await renderTable(doc, element, parentStyle, options, layout, textCache, fontAliasSet, imageCache);
    return;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    renderList(doc, element, parentStyle, options, 0, layout, textCache, fontAliasSet);
    return;
  }

  if (BLOCK_ELEMENTS.has(tagName) && tagName !== 'span' && tagName !== 'a') {
    if (tagName !== 'br' && tagName !== 'tr' && tagName !== 'thead' && tagName !== 'tbody' && tagName !== 'li') {
      const textOnlyContent = element.children
        .filter(c => c.type === 'text')
        .map(c => c.data)
        .join('').trim();

      if (textOnlyContent && element.children.length === 1) {
        renderText(doc, textOnlyContent, style, options, layout, textCache, fontAliasSet);
        return;
      }
    }

    await processChildren(doc, element.children, style, options, layout, textCache, fontAliasSet, imageCache);
  } else {
    await processChildren(doc, element.children, style, options, layout, textCache, fontAliasSet, imageCache);
  }
}

// --- Header / Footer / Page zones ---

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

function renderPageZone(doc, zoneProps, x, y, width, align, currentPage, totalPages, fontAliasSet) {
  const content = resolvePageZoneContent(zoneProps, currentPage, totalPages);
  if (!content) return;

  const fontSize = parseInt(zoneProps['font-size']?.replace('px', ''), 10) || 12;
  const color = zoneProps.color || '#000000';
  const fontFamily = zoneProps['font-family']?.split(',')[0].replace(/['"]/g, '').trim() || 'Helvetica';
  const bold = zoneProps['font-weight'] === 'bold' || parseInt(zoneProps['font-weight'], 10) >= 700;
  const italic = zoneProps['font-style'] === 'italic';

  const resolvedFont = resolveFontFamily(fontFamily, bold, italic, fontAliasSet);
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

function renderHeaderFooterContent(doc, html, x, y, width, align, fontAliasSet) {
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

      const fontFamily = resolveFontFamily(style.fontFamily, style.bold, style.italic, fontAliasSet);
      doc.x = x;
      doc.y = y;
      doc.font(fontFamily).fontSize(style.fontSize).fillColor(style.color);

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

// --- Optimization: Conditional two-pass + shared DOM ---

async function countPages(body, options, fontAliasSet, imageCache, textCache) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  await registerFontFaces(doc, options.css, options._fontBufferCache, fontAliasSet);

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  const layout = new PageLayout(doc, options);

  doc.x = layout.leftMargin;
  doc.y = layout.contentTop;

  const pageCount = { value: 1 };
  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    pageCount.value++;
  };

  const rootStyle = { ...DEFAULT_STYLE };
  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, options, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, options, layout, textCache, fontAliasSet);
    }
  }

  return pageCount.value;
}

async function renderHtmlToPdf(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('HTML content must be a non-empty string');
  }

  // Optimization: shared DOM — parse once, reuse everywhere
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

  // Shared caches between passes
  renderOptions._fontBufferCache = new Map();
  const fontAliasSet = new Set();
  const imageCache = new Map();
  const textCache = new TextMeasureCache();

  // Optimization: Conditional two-pass — only count pages if counter(num-pages) is used
  const needsPageCount = pageZones && JSON.stringify(pageZones).includes('counter(num-pages)');
  let totalPages = 0;
  if (needsPageCount) {
    totalPages = await countPages(body, renderOptions, fontAliasSet, imageCache, textCache);
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  await registerFontFaces(doc, options.css, renderOptions._fontBufferCache, fontAliasSet);

  doc.setMaxListeners(0);

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));

  let currentPage = 0;

  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(opts = {}) {
    originalAddPage({ ...opts, margin: 0 });
    currentPage++;

    const layout = new PageLayout(doc, renderOptions);
    const cw = layout.contentWidth;
    const savedY = doc.y;
    const savedX = doc.x;
    const footerY = doc.page.height - layout.bottomMargin - layout.footerHeight;
    const halfCw = cw / 2;

    if (pageZones) {
      if (pageZones['top-left']) {
        renderPageZone(doc, pageZones['top-left'], layout.leftMargin, layout.topMargin, halfCw, 'left', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['top-center']) {
        renderPageZone(doc, pageZones['top-center'], layout.leftMargin + halfCw * 0.15, layout.topMargin, halfCw, 'center', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['top-right']) {
        renderPageZone(doc, pageZones['top-right'], layout.leftMargin + halfCw, layout.topMargin, halfCw, 'right', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-left']) {
        renderPageZone(doc, pageZones['bottom-left'], layout.leftMargin, footerY, halfCw, 'left', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-center']) {
        renderPageZone(doc, pageZones['bottom-center'], layout.leftMargin + halfCw * 0.15, footerY, halfCw, 'center', currentPage, totalPages, fontAliasSet);
      }
      if (pageZones['bottom-right']) {
        renderPageZone(doc, pageZones['bottom-right'], layout.leftMargin + halfCw, footerY, halfCw, 'right', currentPage, totalPages, fontAliasSet);
      }
    }

    if (options.header && !pageZones) {
      const headerHtml = options.header.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, headerHtml, layout.leftMargin, layout.topMargin, cw, 'left', fontAliasSet);
    }

    if (options.footer && !pageZones) {
      const footerHtml = options.footer.replace('{page}', currentPage).replace('{totalPages}', totalPages);
      renderHeaderFooterContent(doc, footerHtml, layout.leftMargin, footerY, cw, 'left', fontAliasSet);
    }

    doc.y = savedY;
    doc.x = savedX;
  };

  doc.addPage({
    size: options.format || 'A4',
    layout: options.orientation || 'portrait',
    margin: 0,
  });

  const layout = new PageLayout(doc, renderOptions);
  doc.x = layout.leftMargin;
  doc.y = layout.contentTop;

  const rootStyle = { ...DEFAULT_STYLE };

  for (const child of body.children().toArray()) {
    if (child.type === 'tag') {
      await renderElement(doc, child, rootStyle, renderOptions, layout, textCache, fontAliasSet, imageCache);
    } else if (child.type === 'text' && child.data?.trim()) {
      renderText(doc, child.data.trim(), rootStyle, renderOptions, layout, textCache, fontAliasSet);
    }
  }

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.end();
  });
}

export { renderHtmlToPdf, PageLayout, TextMeasureCache };