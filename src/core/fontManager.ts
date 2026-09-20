import { parseFontFaces } from '../cssParser.js';
import { DEFAULT_STYLE } from './cacheManager.js';
import { fetchRemoteResource, decodeDataUri } from './networkSecurity.js';
import { AssetCache, defaultAssetCache } from './assetCache.js';
import { LruCache } from './lruCache.js';
import type { FontFace } from '../types.js';

// WeakMap mapping fontAliasSet to direct O(1) font variant lookup index (Patch 07)
const _aliasDirectIndex = new WeakMap<Set<string>, Map<string, string>>();

/**
 * Registers custom @font-face rules with PDFKit, downloading remote fonts concurrently.
 */
export async function registerFontFaces(
  doc: PDFKit.PDFDocument,
  css: string | undefined,
  fontBufferCache: Map<string, Buffer>,
  fontAliasSet: Set<string>,
  allowedLocalIps?: readonly string[],
): Promise<void> {
  const faces: FontFace[] = parseFontFaces(css ?? '');
  fontAliasSet.clear();

  let directIndex = _aliasDirectIndex.get(fontAliasSet);
  if (!directIndex) {
    directIndex = new Map<string, string>();
    _aliasDirectIndex.set(fontAliasSet, directIndex);
  }
  directIndex.clear();

  if (faces.length === 0) return;

  const aliasesByFamily = new Map<string, Array<{ alias: string; buffer: Buffer }>>();

  // Concurrent font download with cross-PDF caching and in-flight coalescing
  const downloadPromises = faces.map(async (face) => {
    if (fontBufferCache.has(face.url)) return;

    const fontKey = AssetCache.buildFontKey(face.url, face.bold, face.italic);
    const loader = async (): Promise<Buffer> => {
      if (face.url.startsWith('data:')) {
        return decodeDataUri(face.url);
      }
      try {
        return await fetchRemoteResource(face.url, allowedLocalIps);
      } catch (err) {
        throw new Error(`Failed to load font from ${face.url}: ${(err as Error).message}`);
      }
    };

    const buffer = await defaultAssetCache.getFont(fontKey, loader);
    fontBufferCache.set(face.url, buffer);
  });

  await Promise.all(downloadPromises);

  for (const face of faces) {
    const buffer = fontBufferCache.get(face.url);
    if (!buffer) continue;
    let suffix = '';
    if (face.bold) suffix += '-Bold';
    if (face.italic) suffix += '-Italic';
    const alias = face.family + suffix;
    doc.registerFont(alias, buffer);
    fontAliasSet.add(alias);

    // Build O(1) direct lookup index
    const normFamily = face.family.toLowerCase();
    directIndex.set(`${normFamily}|${face.bold ? 1 : 0}|${face.italic ? 1 : 0}`, alias);
    directIndex.set(normFamily, face.family);

    if (!aliasesByFamily.has(face.family)) aliasesByFamily.set(face.family, []);
    aliasesByFamily.get(face.family)?.push({ alias, buffer });
  }

  for (const [family, aliases] of aliasesByFamily) {
    if (!aliases.some((a) => a.alias === family)) {
      const firstAlias = aliases[0];
      if (firstAlias) {
        doc.registerFont(family, firstAlias.buffer);
        fontAliasSet.add(family);
        directIndex.set(family.toLowerCase(), family);
      }
    }
  }
}

function normalizeBaseFont(fontFamily: string): string {
  const f = fontFamily.toLowerCase().trim();
  if (f.includes('courier') || f.includes('mono') || f.includes('consolas')) {
    return 'Courier';
  }
  if (
    f.includes('times') ||
    f.includes('serif') ||
    f.includes('georgia') ||
    f.includes('cursive') ||
    f.includes('script')
  ) {
    return 'Times-Roman';
  }
  return 'Helvetica';
}

const _fontResolutionCache = new LruCache<string, string>(512);

/**
 * Resolves font family name considering bold/italic variants and custom @font-face aliases.
 */
export function resolveFontFamily(
  fontFamily: string | undefined,
  bold: boolean,
  italic: boolean,
  fontAliasSet: Set<string> | null | undefined,
): string {
  const hasCustomAliases = Boolean(fontAliasSet && fontAliasSet.size > 0);
  const cacheKey = !hasCustomAliases ? `${fontFamily || ''}|${bold ? 1 : 0}|${italic ? 1 : 0}` : null;
  if (cacheKey) {
    const cached = _fontResolutionCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  let directIndex: Map<string, string> | undefined;
  const rawBase = fontFamily?.trim() || DEFAULT_STYLE.fontFamily;
  const normBase = rawBase.toLowerCase();
  const directKey = `${normBase}|${bold ? 1 : 0}|${italic ? 1 : 0}`;

  if (hasCustomAliases && fontAliasSet) {
    directIndex = _aliasDirectIndex.get(fontAliasSet);
    if (!directIndex) {
      directIndex = new Map<string, string>();
      _aliasDirectIndex.set(fontAliasSet, directIndex);
      for (const alias of fontAliasSet) {
        directIndex.set(alias.toLowerCase(), alias);
      }
    }
    const directMatch = directIndex.get(directKey);
    if (directMatch !== undefined) {
      return directMatch;
    }
  }

  let base = rawBase;

  const isCustomRegistered =
    hasCustomAliases && fontAliasSet
      ? directIndex?.has(normBase) ||
        fontAliasSet.has(base) ||
        Array.from(fontAliasSet).some((a) => a.toLowerCase().startsWith(normBase))
      : false;

  if (!isCustomRegistered) {
    base = normalizeBaseFont(base);
  }

  if (!bold && !italic) {
    if (directIndex) {
      directIndex.set(directKey, base);
    }
    return base;
  }

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
    if (base === 'Times-Roman' || base === 'Times') {
      name = 'Times-Bold';
    } else {
      name = `${base}-Bold`;
    }
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
    let best: string | null = null;
    for (const registered of fontAliasSet) {
      if (registered.startsWith(base) && (best === null || registered.length > best.length)) {
        best = registered;
      }
    }
    if (best) name = best;
  }

  if (directIndex) {
    directIndex.set(directKey, name);
  }

  if (cacheKey) {
    _fontResolutionCache.set(cacheKey, name);
  }

  return name;
}
