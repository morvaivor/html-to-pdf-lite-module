const PT_PER_INCH = 72;
const PT_PER_CM = PT_PER_INCH / 2.54;
const PT_PER_MM = PT_PER_INCH / 25.4;
const PT_PER_PC = 12;

const UNIT_FACTORS: Record<string, number> = {
  px: 1,
  pt: 1,
  cm: PT_PER_CM,
  mm: PT_PER_MM,
  in: PT_PER_INCH,
  pc: PT_PER_PC,
};

const LENGTH_REGEX = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/**
 * Parses a CSS length into points.
 * Supports px, pt, cm, mm, in, pc and unitless numbers (treated as px/pt).
 * Returns null for unsupported units (vw, vh, em, rem, %) or invalid values.
 */
export function parseLengthPt(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const match = String(value).trim().match(LENGTH_REGEX);
  if (!match) return null;
  const num = parseFloat(match[1] ?? '');
  if (Number.isNaN(num)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (
    unit === '' ||
    unit === 'px' ||
    unit === 'pt' ||
    unit === 'cm' ||
    unit === 'mm' ||
    unit === 'in' ||
    unit === 'pc'
  ) {
    return num * (UNIT_FACTORS[unit] ?? 1);
  }
  return null;
}

/**
 * Parses a numeric value that may carry a % suffix (e.g. line-height: 100%).
 * Returns the raw number (percent divided by 100), or null if unparseable.
 */
export function parseRatio(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str);
    return Number.isNaN(num) ? null : num / 100;
  }
  const num = parseFloat(str);
  return Number.isNaN(num) ? null : num;
}
