function stripPageBlocks(css) {
  let result = css;

  while (true) {
    const idx = result.indexOf('@page');
    if (idx === -1) break;

    const braceStart = result.indexOf('{', idx);
    if (braceStart === -1) break;

    let depth = 0;
    let blockEnd = -1;
    for (let i = braceStart; i < result.length; i++) {
      if (result[i] === '{') depth++;
      if (result[i] === '}') depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
    if (blockEnd === -1) break;

    result = result.substring(0, idx) + result.substring(blockEnd + 1);
  }

  return result;
}

function stripFontFaceBlocks(css) {
  let result = css;

  while (true) {
    const idx = result.indexOf('@font-face');
    if (idx === -1) break;

    const braceStart = result.indexOf('{', idx);
    if (braceStart === -1) break;

    let depth = 0;
    let blockEnd = -1;
    for (let i = braceStart; i < result.length; i++) {
      if (result[i] === '{') depth++;
      if (result[i] === '}') depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
    if (blockEnd === -1) break;

    result = result.substring(0, idx) + result.substring(blockEnd + 1);
  }

  return result;
}

function parseFontFaces(css) {
  if (!css || typeof css !== 'string') return [];

  const faces = [];
  const regex = /@font-face\s*\{([^}]*)\}/g;
  let match;

  while ((match = regex.exec(css)) !== null) {
    const block = match[1];
    const family = block.match(/font-family\s*:\s*([^;]+)/)?.[1]?.replace(/['"]/g, '').trim();
    const urlMatch = block.match(/src\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    const weight = block.match(/font-weight\s*:\s*([^;]+)/)?.[1]?.trim() || 'normal';
    const fontStyle = block.match(/font-style\s*:\s*([^;]+)/)?.[1]?.trim() || 'normal';

    if (!family || !urlMatch) continue;

    faces.push({
      family,
      url: urlMatch[1].trim(),
      bold: weight === 'bold' || parseInt(weight, 10) >= 700,
      italic: fontStyle === 'italic',
    });
  }

  return faces;
}

function parseCssRules(css) {
  if (!css || typeof css !== 'string') return [];

  const cssWithoutPage = stripFontFaceBlocks(stripPageBlocks(css));

  const rules = [];
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  let match;

  while ((match = ruleRegex.exec(cssWithoutPage)) !== null) {
    const selector = match[1].trim();
    const declarations = match[2].trim();

    const properties = {};
    const decls = declarations.split(';');
    for (const decl of decls) {
      const parts = decl.split(':').map(s => s.trim());
      if (parts.length >= 2) {
        const prop = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        if (prop && value) {
          properties[prop] = value;
        }
      }
    }

    if (Object.keys(properties).length > 0) {
      rules.push({ selector, properties });
    }
  }

  return rules;
}

function elementMatchesSelector(element, selector) {
  const tagName = element.name || '';
  const classes = (element.attribs.class || '').split(/\s+/).filter(Boolean);
  const id = element.attribs.id || '';

  const selectors = selector.split(',').map(s => s.trim());

  for (const sel of selectors) {
    let parts = sel.trim();

    let tagMatch = '';
    let classMatches = [];
    let idMatch = '';

    const tokens = parts.trim().split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith('#')) {
        idMatch = token.slice(1);
      } else if (token.startsWith('.')) {
        classMatches.push(token.slice(1));
      } else {
        tagMatch = token;
      }
    }

    if (tagMatch && tagMatch.toLowerCase() !== tagName.toLowerCase()) continue;
    if (idMatch && idMatch !== id) continue;
    for (const cls of classMatches) {
      if (!classes.includes(cls)) continue;
    }
    return true;
  }

  return false;
}

function applyCssToElements($, css) {
  if (!css || typeof css !== 'string') return;

  const rules = parseCssRules(css);

  for (const rule of rules) {
    const selector = rule.selector;

    try {
      const elements = $(selector);
      elements.each((_index, element) => {
        if (element.type === 'tag') {
          const existingStyle = element.attribs.style || '';
          const newStyle = Object.entries(rule.properties)
            .map(([key, value]) => `${key}: ${value}`)
            .join('; ');

          if (newStyle) {
            element.attribs.style = existingStyle
              ? newStyle + '; ' + existingStyle
              : newStyle;
          }
        }
      });
    } catch {
      try {
        const cleanSelector = selector
          .replace(/\[.*?\]/g, '')
          .replace(/:.*?(?=[ ,{]|$)/g, '')
          .trim();

        if (cleanSelector) {
          const elements = $(cleanSelector);
          elements.each((_index, element) => {
            if (element.type === 'tag') {
              const existingStyle = element.attribs.style || '';
              const newStyle = Object.entries(rule.properties)
                .map(([key, value]) => `${key}: ${value}`)
                .join('; ');

              if (newStyle) {
                element.attribs.style = existingStyle
                  ? newStyle + '; ' + existingStyle
                  : newStyle;
              }
            }
          });
        }
      } catch {
        // Skip unsupported selectors
      }
    }
  }
}

const PAGE_ZONES = [
  '@top-left', '@top-center', '@top-right',
  '@bottom-left', '@bottom-center', '@bottom-right',
];

function extractPageBlock(css) {
  const idx = css.indexOf('@page');
  if (idx === -1) return null;

  const braceStart = css.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let blockEnd = -1;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) { blockEnd = i; break; }
  }
  if (blockEnd === -1) return null;

  return css.substring(braceStart + 1, blockEnd);
}

function parsePageRule(css) {
  if (!css || typeof css !== 'string') return null;

  const pageBody = extractPageBlock(css);
  if (!pageBody) return null;

  const zones = {};

  for (const zone of PAGE_ZONES) {
    const zoneRegex = new RegExp(`${zone}\\s*\\{([^}]*)\\}`, 'i');
    const zoneMatch = zoneRegex.exec(pageBody);
    if (zoneMatch) {
      const declarations = zoneMatch[1].trim();
      const properties = {};
      const decls = declarations.split(';');
      for (const decl of decls) {
        const parts = decl.split(':').map(s => s.trim());
        if (parts.length >= 2) {
          const prop = parts[0].trim();
          const value = parts.slice(1).join(':').trim();
          if (prop && value) {
            properties[prop] = value;
          }
        }
      }
      if (Object.keys(properties).length > 0) {
        zones[zone.replace('@', '')] = properties;
      }
    }
  }

  if (Object.keys(zones).length === 0) return null;

  return zones;
}

export { parseCssRules, elementMatchesSelector, applyCssToElements, parsePageRule, parseFontFaces, stripFontFaceBlocks };
