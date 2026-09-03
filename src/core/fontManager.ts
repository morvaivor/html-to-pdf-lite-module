import { parseFontFaces } from '../cssParser.js';
import { DEFAULT_STYLE } from './cacheManager.js';
import { fetchRemoteResource, decodeDataUri } from './networkSecurity.js';
import type { FontFace } from '../types.js';

/**
 * Registers custom @font-face rules with PDFKit, downloading remote fonts concurrently.
 */
export async function registerFontFaces(
  doc: PDFKit.PDFDocument,
  css: string | undefined,
  fontBufferCache: Map<string, Buffer>,
  fontAliasSet: Set<string>,
): Promise<void> {
  const faces: FontFace[] = parseFontFaces(css ?? '');
  fontAliasSet.clear();

  if (faces.length === 0) return;

  const aliasesByFamily = new Map<string, Array<{ alias: string; buffer: Buffer }>>();

  // Concurrent font download
  const downloadPromises = faces.map(async (face) => {
    if (fontBufferCache.has(face.url)) return;
    if (face.url.startsWith('data:')) {
      fontBufferCache.set(face.url, decodeDataUri(face.url));
    } else {
      try {
        const buffer = await fetchRemoteResource(face.url);
        fontBufferCache.set(face.url, buffer);
      } catch (err) {
        throw new Error(`Failed to load font from ${face.url}: ${(err as Error).message}`);
      }
    }
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

    if (!aliasesByFamily.has(face.family)) aliasesByFamily.set(face.family, []);
    aliasesByFamily.get(face.family)?.push({ alias, buffer });
  }

  for (const [family, aliases] of aliasesByFamily) {
    if (!aliases.some((a) => a.alias === family)) {
      const firstAlias = aliases[0];
      if (firstAlias) {
        doc.registerFont(family, firstAlias.buffer);
        fontAliasSet.add(family);
      }
    }
  }
}

/**
 * Resolves font family name considering bold/italic variants and custom @font-face aliases.
 */
export function resolveFontFamily(
  fontFamily: string | undefined,
  bold: boolean,
  italic: boolean,
  fontAliasSet: Set<string> | null | undefined,
): string {
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
    let best: string | null = null;
    for (const registered of fontAliasSet) {
      if (registered.startsWith(base) && (best === null || registered.length > best.length)) {
        best = registered;
      }
    }
    if (best) name = best;
  }
  return name;
}
