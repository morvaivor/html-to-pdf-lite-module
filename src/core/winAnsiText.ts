/**
 * Unicode → WinAnsi mapping for the 14 standard PDF fonts.
 *
 * Standard fonts are single-byte (WinAnsiEncoding). PDFKit writes any other UTF-16 code unit as extra
 * hex digits, which corrupts the string: the French thousands separator U+202F becomes " /", "✔"
 * becomes "'" and an emoji becomes "Ø<ß1", while the measured width no longer matches what is drawn.
 * Text measured or drawn with a standard font is therefore mapped first: typographic variants get
 * their WinAnsi equivalent, symbols are drawn with the standard Symbol and ZapfDingbats fonts (✔ ★ → ≤ β),
 * and characters without any glyph are dropped, as a viewer does for a missing glyph. Embedded
 * (@font-face) fonts are left untouched: they encode the full Unicode range.
 */
import { symbolGlyph, type SymbolFontName } from './standardSymbols.js';

/** Unicode code points of the WinAnsi (Windows-1252) bytes 0x80–0x9F; 0 marks the unassigned bytes. */
const WIN_ANSI_C1: readonly number[] = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

/** Characters above U+00FF that WinAnsiEncoding provides. */
const WIN_ANSI_HIGH = new Set<number>(WIN_ANSI_C1.filter((code) => code > 0xff));

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Explicit substitutes, checked before the Unicode compatibility decomposition (which would, for
 * instance, turn the no-break U+202F into a breaking space). An empty string removes an invisible
 * format character.
 */
const SUBSTITUTES = new Map<number, string>([
  // No-break spaces keep their no-break semantics.
  [0x202f, NO_BREAK_SPACE],
  [0x2007, NO_BREAK_SPACE],
  [0x2060, ''],
  // Invisible format characters and variation selectors.
  [0x200b, ''],
  [0x200c, ''],
  [0x200d, ''],
  [0x200e, ''],
  [0x200f, ''],
  [0xfeff, ''],
  [0xfe0e, ''],
  [0xfe0f, ''],
  // Line and paragraph separators.
  [0x2028, ' '],
  [0x2029, ' '],
  // Hyphens, dashes and minus.
  [0x2010, '-'],
  [0x2011, '-'],
  [0x2012, '–'],
  [0x2015, '—'],
  [0x2043, '-'],
  [0x2212, '-'],
  [0x2044, '/'],
  // Quotes and primes.
  [0x201b, '‘'],
  [0x201f, '“'],
  [0x2032, "'"],
  [0x2033, '"'],
  // Bullets and dots.
  [0x2023, '•'],
  [0x2219, '•'],
  [0x25cf, '•'],
  [0x22c5, '·'],
  // Letters without a canonical decomposition.
  [0x0131, 'i'],
  [0x0141, 'L'],
  [0x0142, 'l'],
  [0x0110, 'Ð'],
  [0x0111, 'd'],
  // Relations and arrows, spelled with ASCII.
  [0x2190, '<-'],
  [0x2192, '->'],
  [0x2194, '<->'],
  [0x21d2, '=>'],
  [0x2264, '<='],
  [0x2265, '>='],
  [0x2260, '!='],
  [0x2248, '~'],
]);

const COMBINING_MARK_REGEX = /\p{M}/gu;
const WHITESPACE_REGEX = /\s/;

function isWinAnsi(code: number): boolean {
  return code <= 0xff || WIN_ANSI_HIGH.has(code);
}

/** True when every UTF-16 code unit of `text` has a WinAnsi code (surrogates never do). */
function isEncodable(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff && !WIN_ANSI_HIGH.has(code)) return false;
  }
  return true;
}

/** Per code point: its WinAnsi substitute, or null when the character has no glyph and is dropped. */
const substituteCache = new Map<number, string | null>();

function substituteFor(char: string, code: number): string | null {
  const cached = substituteCache.get(code);
  if (cached !== undefined) return cached;

  let substitute: string | null = SUBSTITUTES.get(code) ?? null;
  if (substitute === null && /\p{M}/u.test(char)) substitute = '';
  if (substitute === null) {
    // Compatibility forms: typographic spaces, ligatures, full-width letters, circled digits, fractions...
    const compatible = char.normalize('NFKC');
    if (compatible !== char) {
      let mapped: string | null = '';
      for (const part of compatible) {
        const partCode = part.codePointAt(0) as number;
        const partSubstitute = isWinAnsi(partCode) ? part : SUBSTITUTES.get(partCode);
        if (partSubstitute === undefined) {
          mapped = null;
          break;
        }
        mapped += partSubstitute;
      }
      if (mapped) substitute = mapped;
    }
  }
  if (substitute === null) {
    // Accented letters outside Windows-1252 (Central European, Romanian, Vietnamese...): base letter.
    const base = char.normalize('NFD').replace(COMBINING_MARK_REGEX, '');
    if (base && base !== char && isEncodable(base)) substitute = base;
  }

  if (substituteCache.size < 4096) substituteCache.set(code, substitute);
  return substitute;
}

/**
 * Returns the part of `text` a single standard font can encode: symbols (drawn with the symbol fonts by
 * `standardFontRuns`) and characters without any glyph are dropped. WinAnsi text is returned as is
 * (same string), so the common case costs one scan of its code units. A dropped symbol that starts a
 * word also drops the space after it ("✔ Validé" becomes "Validé", not " Validé").
 */
export function toWinAnsi(text: string): string {
  if (isEncodable(text)) return text;

  let result = '';
  let skipNextSpace = false;
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) as number;
    if (isWinAnsi(code)) {
      if (skipNextSpace && WHITESPACE_REGEX.test(char)) {
        skipNextSpace = false;
        continue;
      }
      result += char;
      skipNextSpace = false;
      continue;
    }
    const substitute = substituteFor(char, code);
    if (substitute !== null) {
      result += substitute;
      if (substitute) skipNextSpace = false;
    } else if (result === '' || WHITESPACE_REGEX.test(result.at(-1) as string)) {
      skipNextSpace = true;
    }
  }
  return result;
}

const MICRO_SIGN = String.fromCharCode(0xb5);
const CSS_ESCAPE_REGEX = /\\([0-9a-fA-F]{1,6})/g;

/**
 * Whether drawing `text` with a standard font needs the Unicode layer of `useWinAnsiStandardFonts`:
 * characters outside WinAnsi, or the micro sign, which `text-transform: uppercase` turns into a Greek Μ.
 */
export function needsUnicodeTextLayer(text: string): boolean {
  return !isEncodable(text) || text.includes(MICRO_SIGN);
}

/** `needsUnicodeTextLayer` for a style sheet, whose `content` strings may use escapes such as `\2714`. */
export function cssNeedsUnicodeTextLayer(css: string): boolean {
  if (needsUnicodeTextLayer(css)) return true;
  for (const match of css.matchAll(CSS_ESCAPE_REGEX)) {
    const code = parseInt(match[1] as string, 16);
    if (code === 0xb5 || !isWinAnsi(code)) return true;
  }
  return false;
}

/** `needsUnicodeTextLayer` for an HTML template, whose character references (`&#x2714;`) count too. */
export function markupNeedsUnicodeTextLayer(html: string): boolean {
  return needsUnicodeTextLayer(html) || /&[#a-z]/i.test(html);
}

/** A piece of a text line drawn with one font: WinAnsi text, or bytes of a symbol font. */
export interface GlyphRun {
  readonly font: 'text' | SymbolFontName;
  readonly text: string;
  /** Advance width of a symbol run, in 1/1000 em. */
  readonly width: number;
}

/**
 * Splits text drawn with a standard font into runs of WinAnsi text (mapped as `toWinAnsi` does) and of
 * Symbol / ZapfDingbats glyphs. Returns null when no symbol font is needed.
 */
export function standardFontRuns(text: string): readonly GlyphRun[] | null {
  if (isEncodable(text)) return null;

  const runs: GlyphRun[] = [];
  let font: GlyphRun['font'] = 'text';
  let runText = '';
  let runWidth = 0;
  let hasSymbols = false;
  let skipNextSpace = false;
  const append = (runFont: GlyphRun['font'], chars: string, width: number): void => {
    if (runFont !== font && runText) {
      runs.push({ font, text: runText, width: runWidth });
      runText = '';
      runWidth = 0;
    }
    font = runFont;
    runText += chars;
    runWidth += width;
  };

  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) as number;
    if (isWinAnsi(code)) {
      if (skipNextSpace && WHITESPACE_REGEX.test(char)) {
        skipNextSpace = false;
        continue;
      }
      append('text', char, 0);
      skipNextSpace = false;
      continue;
    }
    const glyph = symbolGlyph(code);
    if (glyph !== undefined) {
      append(glyph.font, String.fromCharCode(glyph.code), glyph.width);
      hasSymbols = true;
      skipNextSpace = false;
      continue;
    }
    const substitute = substituteFor(char, code);
    if (substitute !== null) {
      if (substitute) {
        append('text', substitute, 0);
        skipNextSpace = false;
      }
    } else if (WHITESPACE_REGEX.test(runText.at(-1) ?? ' ')) {
      // Dropped at the start of a word: its following space goes too.
      skipNextSpace = true;
    }
  }
  if (runText) runs.push({ font, text: runText, width: runWidth });
  return hasSymbols ? runs : null;
}

/** Decodes the bytes of a WinAnsi string (as drawn with a standard font) back to Unicode. */
export function decodeWinAnsi(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_C1[byte - 0x80] || byte : byte);
  }
  return text;
}

const WRAPPED: unique symbol = Symbol('pdfLiteWinAnsi');

interface StandardFontInstance {
  readonly font?: { readonly encodeText?: unknown };
  readonly name: string;
  readonly ascender: number;
  readonly descender: number;
  readonly xHeight: number;
  dictionary: { data: Record<string, unknown>; end(): unknown };
  encode(text: unknown, features?: unknown): unknown;
  widthOfString(text: unknown, size: number, features?: unknown): number;
  embed(): unknown;
  [WRAPPED]?: true;
}

interface FragmentOptions {
  readonly align?: string;
  readonly width?: number;
  readonly lineWidth?: number;
  readonly textWidth?: number;
  readonly wordSpacing?: number;
  readonly characterSpacing?: number;
  readonly baseline?: number | string;
  readonly features?: unknown;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly [option: string]: unknown;
}

type Fragment = (this: DocumentInternals, text: string, x: number, y: number, options: FragmentOptions) => unknown;

interface DocumentInternals {
  _font: unknown;
  _fontSize: number;
  font(...args: unknown[]): unknown;
  widthOfString(text: string, options?: FragmentOptions): number;
  _fragment: Fragment;
}

function isWrappedFont(font: unknown): font is StandardFontInstance {
  return typeof font === 'object' && font !== null && (font as StandardFontInstance)[WRAPPED] === true;
}

/** Wraps one document's standard font object (own properties: shared prototypes are left intact). */
function wrapStandardFont(candidate: unknown): void {
  if (candidate === null || typeof candidate !== 'object') return;
  const font = candidate as StandardFontInstance;
  if (font[WRAPPED] || typeof font.font?.encodeText !== 'function') return;
  const { encode, widthOfString } = font;
  font.encode = function (this: StandardFontInstance, text: unknown, features?: unknown) {
    return encode.call(this, typeof text === 'string' ? toWinAnsi(text) : text, features);
  };
  font.widthOfString = function (this: StandardFontInstance, text: unknown, size: number, features?: unknown) {
    // WinAnsi text (the common case) costs one scan of its code units.
    if (typeof text !== 'string' || isEncodable(text)) return widthOfString.call(this, text, size, features);
    const runs = standardFontRuns(text);
    if (runs === null) return widthOfString.call(this, toWinAnsi(text), size, features);
    let width = 0;
    for (const run of runs) {
      width += run.font === 'text' ? widthOfString.call(this, run.text, size, features) : (run.width * size) / 1000;
    }
    return width;
  };
  font[WRAPPED] = true;
}

const symbolFonts = new WeakMap<object, Map<SymbolFontName, StandardFontInstance>>();

/** The document's Symbol or ZapfDingbats font, declared with its built-in encoding. */
function symbolFont(doc: DocumentInternals, name: SymbolFontName): StandardFontInstance {
  let fonts = symbolFonts.get(doc);
  if (fonts === undefined) {
    fonts = new Map();
    symbolFonts.set(doc, fonts);
  }
  let font = fonts.get(name);
  if (font === undefined) {
    const current = doc._font;
    doc.font(name);
    font = doc._font as StandardFontInstance;
    doc._font = current;
    // PDFKit declares WinAnsiEncoding for every standard font, which maps the symbol bytes to glyph
    // names these fonts do not have: symbolic fonts must keep their built-in encoding.
    font.embed = function (this: StandardFontInstance) {
      this.dictionary.data = { Type: 'Font', BaseFont: this.name, Subtype: 'Type1' };
      return this.dictionary.end();
    };
    fonts.set(name, font);
  }
  return font;
}

/** Baseline offset of `_fragment` (points below the top of the line), from the main font's metrics. */
function baselineOffset(font: StandardFontInstance, size: number, baseline: FragmentOptions['baseline']): number {
  if (typeof baseline === 'number') return -baseline;
  let dy: number;
  switch (baseline) {
    case 'svg-middle':
      dy = 0.5 * font.xHeight;
      break;
    case 'middle':
    case 'svg-central':
      dy = 0.5 * (font.descender + font.ascender);
      break;
    case 'bottom':
    case 'ideographic':
      dy = font.descender;
      break;
    case 'alphabetic':
      dy = 0;
      break;
    case 'mathematical':
      dy = 0.5 * font.ascender;
      break;
    case 'hanging':
      dy = 0.8 * font.ascender;
      break;
    default:
      dy = font.ascender;
  }
  return (dy / 1000) * size;
}

/**
 * Draws one line fragment whose text needs symbol fonts, as PDFKit's `_fragment` would draw it with a
 * single font: the alignment is resolved for the whole line, then each run is drawn left-aligned at its
 * position, on the baseline of the main font. A justified line is drawn word by word.
 */
function drawRuns(
  doc: DocumentInternals,
  fragment: Fragment,
  mainFont: StandardFontInstance,
  runs: readonly GlyphRun[],
  text: string,
  x: number,
  y: number,
  options: FragmentOptions,
): void {
  const size = doc._fontSize;
  const characterSpacing = options.characterSpacing ?? 0;
  const spaceWidth = mainFont.widthOfString(' ', size, options.features);
  let wordSpacing = options.wordSpacing ?? 0;
  let cursor = x;
  if (options.width) {
    if (options.align === 'right') {
      cursor += (options.lineWidth ?? 0) - doc.widthOfString(text.replace(/\s+$/, ''), options);
    } else if (options.align === 'center') {
      cursor += (options.lineWidth ?? 0) / 2 - (options.textWidth ?? 0) / 2;
    } else if (options.align === 'justify') {
      const words = text.trim().split(/\s+/);
      const textWidth = doc.widthOfString(text.replace(/\s+/g, ''), options);
      wordSpacing = Math.max(
        0,
        ((options.lineWidth ?? 0) - textWidth) / Math.max(1, words.length - 1) - (spaceWidth + characterSpacing),
      );
    }
  }

  const common: FragmentOptions = {
    ...options,
    align: 'left',
    wordSpacing: 0,
    baseline: -baselineOffset(mainFont, size, options.baseline),
  };
  const draw = (font: StandardFontInstance, chars: string, width: number, decorated: boolean): void => {
    doc._font = font;
    fragment.call(doc, chars, cursor, y, {
      ...common,
      textWidth: width,
      wordCount: 1,
      underline: decorated && options.underline,
      strike: decorated && options.strike,
    });
    cursor += width + characterSpacing * chars.length;
  };

  try {
    for (const run of runs) {
      if (run.font !== 'text') {
        draw(symbolFont(doc, run.font), run.text, (run.width * size) / 1000, false);
      } else if (wordSpacing === 0) {
        draw(mainFont, run.text, mainFont.widthOfString(run.text, size, options.features), true);
      } else {
        for (const token of run.text.split(/(\s+)/)) {
          if (!token) continue;
          if (/^\s/.test(token)) cursor += spaceWidth + characterSpacing + wordSpacing;
          else draw(mainFont, token, mainFont.widthOfString(token, size, options.features), true);
        }
      }
    }
  } finally {
    doc._font = mainFont;
  }
}

/**
 * Makes every standard font selected on `doc` encode Unicode text safely (see the module comment).
 * Measurement and drawing go through the same mapping, so line breaking and alignment stay exact.
 */
export function useWinAnsiStandardFonts(pdfDocument: PDFKit.PDFDocument): void {
  const doc = pdfDocument as unknown as DocumentInternals;
  wrapStandardFont(doc._font);
  const selectFont = doc.font;
  doc.font = function (this: DocumentInternals, ...args: unknown[]) {
    const result = selectFont.apply(this, args);
    wrapStandardFont(this._font);
    return result;
  };
  const fragment = doc._fragment;
  doc._fragment = function (this: DocumentInternals, text, x, y, options) {
    const mainFont = this._font;
    if (typeof text !== 'string' || isEncodable(text) || !isWrappedFont(mainFont)) {
      return fragment.call(this, text, x, y, options);
    }
    const line = text.replace(/\n/g, '');
    const runs = standardFontRuns(line);
    if (runs === null) return fragment.call(this, text, x, y, options);
    drawRuns(this, fragment, mainFont, runs, line, x, y, options);
    return undefined;
  };
}
