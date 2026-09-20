import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { LruCache } from './core/lruCache.js';
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
 * Supprime les commentaires CSS (/* ... *\/) pour éviter de casser les sélecteurs.
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
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

const MAX_CSS_CACHE = 128;
const _fontFacesCache = new LruCache<string, FontFace[]>(MAX_CSS_CACHE);
const _cssRulesCache = new LruCache<string, CssRule[]>(MAX_CSS_CACHE);
const _pageRuleCache = new LruCache<string, PageZones | null>(MAX_CSS_CACHE);

export function parseFontFaces(css: string): FontFace[] {
  if (!css || typeof css !== 'string') return [];

  const cached = _fontFacesCache.get(css);
  if (cached !== undefined) return cached;

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

  _fontFacesCache.set(css, faces);
  return faces;
}

export function parseCssRules(css: string): CssRule[] {
  if (!css || typeof css !== 'string') return [];

  const cached = _cssRulesCache.get(css);
  if (cached !== undefined) return cached;

  const cssWithoutPage = stripCssComments(stripFontFaceBlocks(stripPageBlocks(css)));

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

  _cssRulesCache.set(css, rules);
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

export interface IndexedSelector {
  order: number;
  selector: string;
  styleString: string;
  type: 'id' | 'class' | 'tag' | 'tag#id' | 'tag.class' | 'complex';
  tagName?: string;
  id?: string;
  className?: string;
  extraClasses?: string[];
}

export interface CssRuleIndex {
  byId: Map<string, IndexedSelector[]>;
  byClass: Map<string, IndexedSelector[]>;
  byTag: Map<string, IndexedSelector[]>;
  complex: IndexedSelector[];
}

export function buildCssRuleIndex(rules: CssRule[]): CssRuleIndex {
  const byId = new Map<string, IndexedSelector[]>();
  const byClass = new Map<string, IndexedSelector[]>();
  const byTag = new Map<string, IndexedSelector[]>();
  const complex: IndexedSelector[] = [];

  const addToMap = (map: Map<string, IndexedSelector[]>, key: string, item: IndexedSelector) => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(item);
  };

  for (let order = 0; order < rules.length; order++) {
    const rule = rules[order]!;
    const styleString = Object.entries(rule.properties)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    if (!styleString) continue;

    const rawSelectors = rule.selector
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sel of rawSelectors) {
      // If complex: contains spaces (descendant), >, +, ~, [, :, *
      if (/[\s>+~[:*]/.test(sel)) {
        complex.push({ order, selector: sel, styleString, type: 'complex' });
        continue;
      }

      // 1. Pure ID: #myId
      const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
      if (idMatch && idMatch[1]) {
        addToMap(byId, idMatch[1], {
          order,
          selector: sel,
          styleString,
          type: 'id',
          id: idMatch[1],
        });
        continue;
      }

      // 2. Tag with ID: tag#myId (e.g. div#main)
      const tagIdMatch = sel.match(/^([a-zA-Z0-9]+)#([a-zA-Z0-9_-]+)$/);
      if (tagIdMatch && tagIdMatch[1] && tagIdMatch[2]) {
        addToMap(byId, tagIdMatch[2], {
          order,
          selector: sel,
          styleString,
          type: 'tag#id',
          tagName: tagIdMatch[1].toLowerCase(),
          id: tagIdMatch[2],
        });
        continue;
      }

      // 3. Pure Class: .myClass
      const classMatch = sel.match(/^\.([a-zA-Z0-9_-]+)$/);
      if (classMatch && classMatch[1]) {
        addToMap(byClass, classMatch[1], {
          order,
          selector: sel,
          styleString,
          type: 'class',
          className: classMatch[1],
        });
        continue;
      }

      // 4. Tag with Class(es): tag.myClass or tag.cls1.cls2 or .cls1.cls2
      const compoundClassMatch = sel.match(/^([a-zA-Z0-9]*)(\.[a-zA-Z0-9_-]+)+$/);
      if (compoundClassMatch) {
        const tagName = compoundClassMatch[1] ? compoundClassMatch[1].toLowerCase() : undefined;
        const classPart = compoundClassMatch[1] ? sel.slice(compoundClassMatch[1].length) : sel;
        const classes = classPart.split('.').filter(Boolean);
        const primaryClass = classes[0];
        if (primaryClass) {
          const extraClasses = classes.slice(1);
          addToMap(byClass, primaryClass, {
            order,
            selector: sel,
            styleString,
            type: tagName ? 'tag.class' : 'class',
            tagName,
            className: primaryClass,
            extraClasses: extraClasses.length > 0 ? extraClasses : undefined,
          });
          continue;
        }
      }

      // 5. Pure Tag: tag (e.g. h1, p, td, table)
      const tagMatch = sel.match(/^([a-zA-Z0-9]+)$/);
      if (tagMatch && tagMatch[1]) {
        addToMap(byTag, tagMatch[1].toLowerCase(), {
          order,
          selector: sel,
          styleString,
          type: 'tag',
          tagName: tagMatch[1].toLowerCase(),
        });
        continue;
      }

      // Otherwise, fallback to complex
      complex.push({ order, selector: sel, styleString, type: 'complex' });
    }
  }

  return { byId, byClass, byTag, complex };
}

export function applyCssToElements($: CheerioAPI, css: string): void {
  if (!css || typeof css !== 'string') return;

  const rules = parseCssRules(css);
  if (rules.length === 0) return;

  // Preserve original inline styles so external stylesheet rules don't overwrite them
  $('[style]').each((_index, element) => {
    if (element.type === 'tag' && element.attribs?.style && !element.attribs['data-orig-style']) {
      element.attribs['data-orig-style'] = element.attribs.style;
    }
  });

  const index = buildCssRuleIndex(rules);

  // Collect matches per element preserving rule order: Element -> Map<order, styleString>
  const elementMatches = new Map<Element, Map<number, string>>();

  const addMatch = (el: Element, order: number, styleString: string) => {
    let map = elementMatches.get(el);
    if (!map) {
      map = new Map<number, string>();
      elementMatches.set(el, map);
    }
    map.set(order, styleString);
  };

  // 1. Process complex selectors via Cheerio
  for (const c of index.complex) {
    const cleanSel = c.selector.trim();
    if (!cleanSel) continue;

    const applyComplex = (elements: Cheerio<any>) => {
      elements.each((_index: number, element: any) => {
        if (element.type === 'tag') {
          addMatch(element as Element, c.order, c.styleString);
        }
      });
    };

    try {
      applyComplex($(cleanSel));
    } catch {
      try {
        const fallbackSel = cleanSel.replace(ATTR_SELECTOR_REGEX, '').replace(PSEUDO_SELECTOR_REGEX, '').trim();
        if (fallbackSel) {
          applyComplex($(fallbackSel));
        }
      } catch {
        // Skip unsupported selectors
      }
    }
  }

  // 2. Single-pass traversal of DOM to match indexed rules in O(1)
  $('*').each((_index, element) => {
    if (element.type !== 'tag') return;
    const el = element as Element;
    const tagName = el.name ? el.name.toLowerCase() : '';
    const id = el.attribs?.id;
    const classAttr = el.attribs?.class;

    // Match byTag
    if (tagName) {
      const tagRules = index.byTag.get(tagName);
      if (tagRules) {
        for (const r of tagRules) {
          addMatch(el, r.order, r.styleString);
        }
      }
    }

    // Match byId
    if (id) {
      const idRules = index.byId.get(id);
      if (idRules) {
        for (const r of idRules) {
          if (!r.tagName || r.tagName === tagName) {
            addMatch(el, r.order, r.styleString);
          }
        }
      }
    }

    // Match byClass
    if (classAttr) {
      const classes = classAttr.split(WHITESPACE_REGEX).filter(Boolean);
      for (const cls of classes) {
        const classRules = index.byClass.get(cls);
        if (classRules) {
          for (const r of classRules) {
            if (r.tagName && r.tagName !== tagName) continue;
            if (r.extraClasses && !r.extraClasses.every((c) => classes.includes(c))) continue;
            addMatch(el, r.order, r.styleString);
          }
        }
      }
    }
  });

  // 3. Apply matches in order of appearance in the CSS
  for (const [el, matches] of elementMatches) {
    const sortedOrders = Array.from(matches.keys()).sort((a, b) => a - b);
    const combinedStyle = sortedOrders.map((o) => matches.get(o)!).join('; ');
    if (combinedStyle) {
      const current = el.attribs?.style || '';
      el.attribs.style = current ? current + '; ' + combinedStyle : combinedStyle;
    }
  }

  // Re-apply original inline styles at the end so they take highest precedence
  $('[data-orig-style]').each((_index, element) => {
    if (element.type === 'tag' && element.attribs?.['data-orig-style']) {
      const orig = element.attribs['data-orig-style'];
      const current = element.attribs.style || '';
      element.attribs.style = current ? current + '; ' + orig : orig;
      delete element.attribs['data-orig-style'];
    }
  });
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

  const cached = _pageRuleCache.get(css);
  if (cached !== undefined) return cached;

  const pageBody = extractPageBlock(css);
  if (!pageBody) {
    _pageRuleCache.set(css, null);
    return null;
  }

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

  const result = Object.keys(zones).length === 0 ? null : (zones as PageZones);
  _pageRuleCache.set(css, result);
  return result;
}
