/**
 * CSS lengths in PDF points, with the CSS absolute unit ratios (CSS Values 4: 1in = 96px = 72pt, so a
 * CSS pixel is 0.75pt), exactly as browsers print a page. Before 3.0, every length was read as a raw
 * number of points whatever its unit (12px = 12pt, and even 1em = 1pt).
 */
import type { TextStyle } from '../types.js';

/** Points per CSS pixel. */
export const PT_PER_PX = 0.75;

/** Browsers' default `medium` font size (16px), also the root font size used by `rem`. */
export const DEFAULT_FONT_SIZE_PT = 12;

const PT_PER_UNIT: Readonly<Record<string, number>> = {
  px: PT_PER_PX,
  pt: 1,
  pc: 12,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  q: 72 / 101.6,
};

/** CSS absolute-size keywords, in pixels (as browsers resolve them with `medium` = 16px). */
const FONT_SIZE_KEYWORDS_PX: Readonly<Record<string, number>> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

/**
 * User-agent font sizes, relative to the parent's size (browsers' default style sheet). Every other
 * element inherits the font size of its parent.
 */
export const USER_AGENT_FONT_SCALE: Readonly<Record<string, number>> = {
  h1: 2,
  h2: 1.5,
  h3: 1.17,
  h4: 1,
  h5: 0.83,
  h6: 0.67,
  small: 1 / 1.2,
};

/** Ratio browsers apply for the relative-size keywords `smaller` / `larger`. */
const RELATIVE_FONT_STEP = 1.2;

const LENGTH_REGEX = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*|%)$/i;

interface ParsedNumber {
  readonly value: number;
  readonly unit: string;
}

function parseNumberWithUnit(value: string | undefined): ParsedNumber | undefined {
  if (!value) return undefined;
  const match = LENGTH_REGEX.exec(value.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? { value: number, unit: (match[2] as string).toLowerCase() } : undefined;
}

/**
 * Converts a CSS length to points. `em`, `ex` and `ch` resolve against `emBase` (points), `rem` against
 * the root font size, and a unitless number is a CSS pixel count (HTML attributes, quirks mode).
 * Percentages, keywords (`auto`...) and invalid values return undefined, for the caller to resolve.
 */
export function parseLength(value: string | undefined, emBase: number = DEFAULT_FONT_SIZE_PT): number | undefined {
  const parsed = parseNumberWithUnit(value);
  if (parsed === undefined) return undefined;
  const { value: number, unit } = parsed;
  if (unit === '') return number * PT_PER_PX;
  const ratio = PT_PER_UNIT[unit];
  if (ratio !== undefined) return number * ratio;
  switch (unit) {
    case 'em':
      return number * emBase;
    case 'rem':
      return number * DEFAULT_FONT_SIZE_PT;
    case 'ex':
    case 'ch':
      return number * emBase * 0.5;
    default:
      return undefined;
  }
}

/** `parseLength` for a percentage-capable value: `50%` resolves against `percentBase` (points). */
export function parseLengthOrPercentage(
  value: string | undefined,
  percentBase: number,
  emBase: number = DEFAULT_FONT_SIZE_PT,
): number | undefined {
  const parsed = parseNumberWithUnit(value);
  if (parsed?.unit === '%') return (parsed.value / 100) * percentBase;
  return parseLength(value, emBase);
}

/**
 * Parses a `font-size` declaration: an absolute size in points, or a factor of the parent's size
 * (`em`, `%`, `smaller`, `larger`), resolved during style inheritance by `computedFontSize`.
 */
export function parseFontSize(value: string): { readonly fontSize?: number; readonly fontSizeScale?: number } {
  const keyword = value.trim().toLowerCase();
  const keywordPx = FONT_SIZE_KEYWORDS_PX[keyword];
  if (keywordPx !== undefined) return { fontSize: keywordPx * PT_PER_PX };
  if (keyword === 'smaller') return { fontSizeScale: 1 / RELATIVE_FONT_STEP };
  if (keyword === 'larger') return { fontSizeScale: RELATIVE_FONT_STEP };

  const parsed = parseNumberWithUnit(keyword);
  if (parsed === undefined || parsed.value < 0) return {};
  if (parsed.unit === 'em') return { fontSizeScale: parsed.value };
  if (parsed.unit === '%') return { fontSizeScale: parsed.value / 100 };
  const size = parseLength(keyword);
  return size === undefined ? {} : { fontSize: size };
}

/**
 * Parses `line-height` into the multiplier of the element's font size used by the renderers: a number,
 * `em` and `%` are already relative; an absolute length is divided by `fontSize` (the size declared
 * in the same rule, or the default one). `normal` returns undefined.
 */
export function parseLineHeight(value: string, fontSize: number = DEFAULT_FONT_SIZE_PT): number | undefined {
  const parsed = parseNumberWithUnit(value);
  if (parsed === undefined || parsed.value < 0) return undefined;
  if (parsed.unit === '' || parsed.unit === 'em') return parsed.value;
  if (parsed.unit === '%') return parsed.value / 100;
  const length = parseLength(value, fontSize);
  return length === undefined || fontSize <= 0 ? undefined : length / fontSize;
}

/**
 * Font size of an element: its absolute size, else its relative size applied to the parent's size, else
 * `fallback` (the user-agent size of the element, or the inherited size).
 */
export function computedFontSize(
  style: Pick<Partial<TextStyle>, 'fontSize' | 'fontSizeScale'>,
  parentFontSize: number,
  fallback: number = parentFontSize,
): number {
  if (style.fontSize !== undefined) return style.fontSize;
  if (style.fontSizeScale !== undefined) return parentFontSize * style.fontSizeScale;
  return fallback;
}
