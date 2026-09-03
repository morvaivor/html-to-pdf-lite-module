import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { CssRule, FontFace, PageZones, PageZoneProperties } from './types.js';

// --- Pre-compiled regex constants (compiled once at module load) ---
const FONT_FACE_REGEX = /@font-face\s*\{([^}]*)\}/g;
const RULE_REGEX = /([^{}]+)\{([^}]*)\}/g;
const FONT_FAMILY_REGEX = /font-family\s*:\s*([^;]+)/;
const FONT_SRC_REGEX = /src\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/;
const FONT_WEIGHT_REGEX = /font-weight\s*:\s*([^;]+)/;
const FONT_STYLE_REGEX = /font-style\s*:\s*([^;]+)/;
const WHITESPACE_REGEX = /\s+/;
const ATTR_SELECTOR_REGEX = /\[.*?\]/g;
const PSEUDO_SELECTOR_REGEX = /:.*?(?=[ ,{]|$)/g;
const QUOTE_REGEX = /['"]/g;

const PAGE_ZONES = [
  '@top-left',
  '@top-center',
  '@top-right',
  '@bottom-left',
  '@bottom-center',
  '@bottom-right',
] as const;

// Pre-compiled zone regex map (built once at module load)
const PAGE_ZONE_REGEXES: Record<string, RegExp> = {};
for (const zone of PAGE_ZONES) {
  PAGE_ZONE_REGEXES[zone] = new RegExp(`${zone}\\s*\\{([^}]*)\\}`, 'i');
}

/**
 * Supprime les blocs @page du CSS pour le parsing des règles normales.
 * Utilise un compteur de profondeur d'accolades équilibrées pour éviter les ReDoS regex.
 */
export function stripPageBlocks(css: string): string {
  let result = css;

  while (true) {
    const idx = result.indexOf('@page');
    if (idx === -1) break;

    const braceStart = result.indexOf('{', idx);
    if (braceStart === -1) break;

    // Compte la profondeur imbriquée d'accolades pour identifier la fin exacte du bloc
    let depth = 0;
    let blockEnd = -1;
    for (let charIndex = braceStart; charIndex < result.length; charIndex++) {
      if (result[charIndex] === '{') depth++;
      if (result[charIndex] === '}') depth--;
      if (depth === 0) {
        blockEnd = charIndex;
        break;
      }
    }
    if (blockEnd === -1) break;

    result = result.substring(0, idx) + result.substring(blockEnd + 1);
  }

  return result;
}

export function stripFontFaceBlocks(css: string): string {
  let result = css;

  while (true) {
    const idx = result.indexOf('@font-face');
    if (idx === -1) break;

    const braceStart = result.indexOf('{', idx);
    if (braceStart === -1) break;

    let depth = 0;
    let blockEnd = -1;
    for (let charIndex = braceStart; charIndex < result.length; charIndex++) {
      if (result[charIndex] === '{') depth++;
      if (result[charIndex] === '}') depth--;
      if (depth === 0) {
        blockEnd = charIndex;
        break;
      }
    }
    if (blockEnd === -1) break;

    result = result.substring(0, idx) + result.substring(blockEnd + 1);
  }

  return result;
}

export function parseFontFaces(css: string): FontFace[] {
  if (!css || typeof css !== 'string') return [];

  const faces: FontFace[] = [];
  FONT_FACE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FONT_FACE_REGEX.exec(css)) !== null) {
    const block = match[1];
    if (!block) continue;
    const family = block.match(FONT_FAMILY_REGEX)?.[1]?.replace(QUOTE_REGEX, '').trim();
    const urlMatch = block.match(FONT_SRC_REGEX);
    const weight = block.match(FONT_WEIGHT_REGEX)?.[1]?.trim() || 'normal';
    const fontStyle = block.match(FONT_STYLE_REGEX)?.[1]?.trim() || 'normal';

    if (!family || !urlMatch || !urlMatch[1]) continue;

    faces.push({
      family,
      url: urlMatch[1].trim(),
      bold: weight === 'bold' || parseInt(weight, 10) >= 700,
      italic: fontStyle === 'italic',
    });
  }

  return faces;
}

export function parseCssRules(css: string): CssRule[] {
  if (!css || typeof css !== 'string') return [];

  const cssWithoutPage = stripFontFaceBlocks(stripPageBlocks(css));

  const rules: CssRule[] = [];
  RULE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = RULE_REGEX.exec(cssWithoutPage)) !== null) {
    const selector = match[1]?.trim();
    const declarations = match[2]?.trim();
    if (!selector || !declarations) continue;

    const properties: Record<string, string> = {};
    const decls = declarations.split(';');
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.substring(0, colonIdx).trim();
      const value = decl.substring(colonIdx + 1).trim();
      if (prop && value) {
        properties[prop] = value;
      }
    }

    if (Object.keys(properties).length > 0) {
      rules.push({ selector, properties });
    }
  }

  return rules;
}

export function elementMatchesSelector(element: Element, selector: string): boolean {
  const tagName = element.name || '';
  const classes = (element.attribs?.class || '').split(WHITESPACE_REGEX).filter(Boolean);
  const id = element.attribs?.id || '';

  const selectors = selector.split(',').map((s) => s.trim());

  for (const sel of selectors) {
    const parts = sel.trim();

    let tagMatch = '';
    const classMatches: string[] = [];
    let idMatch = '';

    const tokens = parts.trim().split(WHITESPACE_REGEX);
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
    let classMatch = true;
    for (const cls of classMatches) {
      if (!classes.includes(cls)) {
        classMatch = false;
        break;
      }
    }
    if (!classMatch) continue;
    return true;
  }

  return false;
}

export function applyCssToElements($: CheerioAPI, css: string): void {
  if (!css || typeof css !== 'string') return;

  const rules = parseCssRules(css);

  for (const rule of rules) {
    const selector = rule.selector;

    // Hoist: serialize the style string ONCE per rule, not per element
    const newStyle = Object.entries(rule.properties)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');

    if (!newStyle) continue;

    try {
      const elements = $(selector);
      elements.each((_index, element) => {
        if (element.type === 'tag') {
          const existingStyle = element.attribs?.style || '';
          element.attribs.style = existingStyle ? newStyle + '; ' + existingStyle : newStyle;
        }
      });
    } catch {
      try {
        const cleanSelector = selector.replace(ATTR_SELECTOR_REGEX, '').replace(PSEUDO_SELECTOR_REGEX, '').trim();

        if (cleanSelector) {
          const elements = $(cleanSelector);
          elements.each((_index, element) => {
            if (element.type === 'tag') {
              const existingStyle = element.attribs?.style || '';
              element.attribs.style = existingStyle ? newStyle + '; ' + existingStyle : newStyle;
            }
          });
        }
      } catch {
        // Skip unsupported selectors
      }
    }
  }
}

export function extractPageBlock(css: string): string | null {
  const idx = css.indexOf('@page');
  if (idx === -1) return null;

  const braceStart = css.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let blockEnd = -1;
  for (let charIndex = braceStart; charIndex < css.length; charIndex++) {
    if (css[charIndex] === '{') depth++;
    if (css[charIndex] === '}') depth--;
    if (depth === 0) {
      blockEnd = charIndex;
      break;
    }
  }
  if (blockEnd === -1) return null;

  return css.substring(braceStart + 1, blockEnd);
}

export function parsePageRule(css: string): PageZones | null {
  if (!css || typeof css !== 'string') return null;

  const pageBody = extractPageBlock(css);
  if (!pageBody) return null;

  const zones: Partial<PageZones> = {};

  for (const zone of PAGE_ZONES) {
    const zoneRegex = PAGE_ZONE_REGEXES[zone];
    if (!zoneRegex) continue;
    const zoneMatch = zoneRegex.exec(pageBody);
    if (zoneMatch && zoneMatch[1]) {
      const declarations = zoneMatch[1].trim();
      const properties: PageZoneProperties = {};
      const decls = declarations.split(';');
      for (const decl of decls) {
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) continue;
        const prop = decl.substring(0, colonIdx).trim();
        const value = decl.substring(colonIdx + 1).trim();
        if (prop && value) {
          properties[prop] = value;
        }
      }
      if (Object.keys(properties).length > 0) {
        // Remove '@' from zone name for key
        zones[zone.replace('@', '') as keyof PageZones] = properties;
      }
    }
  }

  if (Object.keys(zones).length === 0) return null;

  return zones as PageZones;
}
