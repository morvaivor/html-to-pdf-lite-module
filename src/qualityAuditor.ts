import * as cheerio from 'cheerio';
import zlib from 'node:zlib';
import { renderHtmlToPdf } from './htmlRenderer.js';
import { parseInlineStyle } from './core/cacheManager.js';
import { parsePageRule, applyCssToElements } from './cssParser.js';
import type { RenderOptions } from './types.js';

export interface QualityCheckOptions {
  /** Optional rendering options passed if generating the PDF on the fly */
  options?: RenderOptions;
  /** Minimum score threshold (0-100) to consider the quality audit passed. Default: 85 */
  minScoreThreshold?: number;
}

export interface QualityAuditResult {
  /** Overall quality and fidelity score from 0 to 100 */
  score: number;
  /** Qualitative letter grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' */
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** True if score >= minScoreThreshold */
  passed: boolean;
  /** Text completeness and preservation audit */
  textCompleteness: {
    totalHtmlWords: number;
    foundInPdfWords: number;
    rate: number; // 0.0 to 1.0
    missingSnippets: string[];
  };
  /** Structural elements audit */
  features: {
    headings: { expected: number; found: number; ok: boolean };
    tables: { expected: number; found: number; ok: boolean };
    lists: { expected: number; found: number; ok: boolean };
    images: { expected: number; found: number; ok: boolean };
    svgs: { expected: number; found: number; ok: boolean };
    boxDecorations: { expected: number; found: number; ok: boolean };
    pageZones: { expected: boolean; found: boolean; ok: boolean };
  };
  /** Layout metrics */
  layout: {
    pageCount: number;
  };
  /** Warnings and improvement opportunities */
  warnings: string[];
  /** Execution duration in milliseconds */
  durationMs: number;
}

interface PdfExtractedData {
  pageCount: number;
  fullRawText: string;
  hasImages: boolean;
  rectCount: number;
  lineCount: number;
  curveCount: number;
  hasColorOperators: boolean;
}

/**
 * Decompresses and extracts text and vector drawing commands from a PDF buffer.
 */
function extractPdfData(pdfBuffer: Buffer): PdfExtractedData {
  const binaryString = pdfBuffer.toString('binary');
  const latinString = pdfBuffer.toString('latin1');

  // 1. Page Count
  const pageMatches = latinString.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  // 2. Image XObjects
  const hasImages =
    latinString.includes('/Subtype /Image') ||
    latinString.includes('/Subtype/Image') ||
    latinString.includes('/XObject');

  // 3. Decompress all streams
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let streamMatch: RegExpExecArray | null;
  const decompressedStreams: string[] = [];

  while ((streamMatch = streamRegex.exec(binaryString)) !== null) {
    const rawStream = streamMatch[1];
    if (!rawStream) continue;
    try {
      const decompressed = zlib.inflateSync(Buffer.from(rawStream, 'binary')).toString('latin1');
      decompressedStreams.push(decompressed);
    } catch {
      // In case stream is uncompressed or uses another filter
      decompressedStreams.push(rawStream);
    }
  }

  // 4. Extract text from TJ arrays and Tj operators
  let fullRawText = '';
  let rectCount = 0;
  let lineCount = 0;
  let curveCount = 0;
  let hasColorOperators = false;

  for (const stream of decompressedStreams) {
    // TJ array extraction
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjArrayRegex.exec(stream)) !== null) {
      const content = tjMatch[1];
      if (!content) continue;

      let segmentText = '';
      // Matches both hex strings <...> and literal strings (...)
      const tokenRegex = /<([0-9a-fA-F]+)>|\(([^)]*)\)/g;
      let tokenMatch: RegExpExecArray | null;
      while ((tokenMatch = tokenRegex.exec(content)) !== null) {
        if (tokenMatch[1]) {
          // Hex string
          segmentText += Buffer.from(tokenMatch[1], 'hex').toString('latin1');
        } else if (tokenMatch[2] !== undefined) {
          // Literal string
          segmentText += tokenMatch[2];
        }
      }
      fullRawText += ' ' + segmentText;
    }

    // Tj single operation extraction
    const tjSingleRegex = /(?:\(([\s\S]*?)\)|<([0-9a-fA-F]+)>)\s*Tj/g;
    let singleMatch: RegExpExecArray | null;
    while ((singleMatch = tjSingleRegex.exec(stream)) !== null) {
      if (singleMatch[2]) {
        fullRawText += ' ' + Buffer.from(singleMatch[2], 'hex').toString('latin1');
      } else if (singleMatch[1]) {
        fullRawText += ' ' + singleMatch[1];
      }
    }

    // Vector commands counts
    const rects = stream.match(/[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+re/g);
    if (rects) rectCount += rects.length;

    const lines = stream.match(/[0-9.-]+\s+[0-9.-]+\s+l\b/g);
    if (lines) lineCount += lines.length;

    const curves = stream.match(/[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+c\b/g);
    if (curves) curveCount += curves.length;

    if (stream.includes(' rg') || stream.includes(' RG') || stream.includes(' scn') || stream.includes(' SCN')) {
      hasColorOperators = true;
    }
  }

  return {
    pageCount,
    fullRawText,
    hasImages,
    rectCount,
    lineCount,
    curveCount,
    hasColorOperators,
  };
}

/**
 * Normalizes text for comparison by collapsing whitespaces and removing punctuation.
 */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[«»"'.,;:!?()[\]{}•/\\|—–_-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
}

/**
 * Verifies the rendering quality and fidelity of a generated PDF against the input HTML.
 *
 * @param html The source HTML document string.
 * @param pdfBufferOrOptions The generated PDF Buffer or quality check options.
 * @param options Additional quality audit options.
 * @returns QualityAuditResult with fidelity score (0-100), letter grade, and component metrics.
 */
export async function verifyRenderingQuality(
  html: string,
  pdfBufferOrOptions?: Buffer | QualityCheckOptions,
  options?: QualityCheckOptions,
): Promise<QualityAuditResult> {
  const startTime = performance.now();

  let pdfBuffer: Buffer;
  let resolvedOptions: QualityCheckOptions;

  if (Buffer.isBuffer(pdfBufferOrOptions)) {
    pdfBuffer = pdfBufferOrOptions;
    resolvedOptions = options ?? {};
  } else {
    resolvedOptions = pdfBufferOrOptions ?? options ?? {};
    pdfBuffer = await renderHtmlToPdf(html, resolvedOptions.options);
  }

  const minScore = resolvedOptions.minScoreThreshold ?? 85;

  // 1. Analyze HTML with Cheerio
  const $ = cheerio.load(html);

  // Extract CSS from style tags
  const styleBlocks: string[] = [];
  $('style').each((_i, el) => {
    styleBlocks.push($(el).text());
  });
  const fullCss = styleBlocks.join('\n') + '\n' + (resolvedOptions.options?.css ?? '');

  if (fullCss.trim()) {
    applyCssToElements($, fullCss);
  }

  // Box Model Decorations in HTML (counted after applying CSS)
  let boxesCount = 0;
  $('*').each((_i, el) => {
    const style = parseInlineStyle(el as any);
    if (
      style.backgroundColor ||
      style.borderWidth ||
      style.borderLeftWidth ||
      style.borderTopWidth ||
      style.borderBottomWidth ||
      style.borderRightWidth ||
      style.border
    ) {
      boxesCount++;
    }
  });

  // Structural Counts in HTML
  const headingsCount = $('h1, h2, h3, h4, h5, h6').length;
  const tablesCount = $('table').length;
  const listsCount = $('ul, ol').length;
  const imagesCount = $('img').length;
  const svgsCount = $('svg').length;

  const headingWords: string[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_i, el) => {
    const words = normalizeWords($(el).text());
    if (words[0]) headingWords.push(words[0]);
  });

  // Ensure whitespace between adjacent block/cell elements
  $('td, th, p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, table').after(' ');

  // Strip style and script for clean text analysis
  $('style, script, head, meta, link').remove();

  // Extract all textual content from body
  const bodyText = $('body').text().trim() || $.root().text().trim();
  const htmlWords = normalizeWords(bodyText);

  // Page zones (@page) in CSS
  const pageZones = parsePageRule(fullCss);
  const hasPageZonesExpected = Boolean(pageZones && Object.keys(pageZones).length > 0);

  // 2. Extract Data from PDF
  const pdfData = extractPdfData(pdfBuffer);
  const pdfTextNormalized = pdfData.fullRawText.toLowerCase();

  // 3. Text Completeness Audit
  let foundWords = 0;
  const missingSnippets: string[] = [];

  const checkedWords = new Set<string>();
  for (const word of htmlWords) {
    if (checkedWords.has(word)) continue;
    checkedWords.add(word);

    if (pdfTextNormalized.includes(word)) {
      foundWords++;
    } else {
      if (missingSnippets.length < 5) {
        missingSnippets.push(word);
      }
    }
  }

  const totalUniqueWords = checkedWords.size;
  const textRecallRate = totalUniqueWords > 0 ? foundWords / totalUniqueWords : 1.0;

  // 4. Feature Audits
  const warnings: string[] = [];

  // Headings
  let headingsFound = 0;
  if (headingsCount > 0) {
    for (const hw of headingWords) {
      if (pdfTextNormalized.includes(hw)) headingsFound++;
    }
  }
  const headingsOk = headingsCount === 0 || headingsFound >= headingsCount * 0.9;
  if (!headingsOk) warnings.push(`Certains titres (h1-h6) semblent manquer ou être tronqués.`);

  // Tables
  let tablesFound = 0;
  if (tablesCount > 0) {
    if (pdfData.lineCount >= tablesCount * 2 || pdfData.rectCount >= tablesCount * 2) {
      tablesFound = tablesCount;
    }
  }
  const tablesOk = tablesCount === 0 || tablesFound >= tablesCount;
  if (tablesCount > 0 && !tablesOk) {
    warnings.push(`${tablesCount} tableau(x) attendu(s), mais peu de lignes/rectangles vectoriels détectés.`);
  }

  // Lists
  let listsFound = 0;
  if (listsCount > 0) {
    const hasBullets =
      pdfData.fullRawText.includes('•') ||
      pdfData.fullRawText.includes('\x95') ||
      /\b1\.\s+/.test(pdfData.fullRawText) ||
      /\b[0-9]+\.\s+/.test(pdfData.fullRawText);
    if (hasBullets || textRecallRate > 0.85) {
      listsFound = listsCount;
    }
  }
  const listsOk = listsCount === 0 || listsFound >= listsCount;
  if (listsCount > 0 && !listsOk) {
    warnings.push(`${listsCount} liste(s) attendue(s), mais les puces de liste n'ont pas été identifiées.`);
  }

  // Images
  const imagesFound = imagesCount > 0 && pdfData.hasImages ? imagesCount : 0;
  const imagesOk = imagesCount === 0 || imagesFound >= imagesCount;
  if (imagesCount > 0 && !imagesOk) {
    warnings.push(`${imagesCount} image(s) attendue(s), mais aucun XObject Image n'a été trouvé.`);
  }

  // SVGs
  let svgsFound = 0;
  if (svgsCount > 0) {
    if (pdfData.curveCount >= svgsCount * 2 || pdfData.lineCount >= svgsCount * 4) {
      svgsFound = svgsCount;
    }
  }
  const svgsOk = svgsCount === 0 || svgsFound >= svgsCount;
  if (svgsCount > 0 && !svgsOk) {
    warnings.push(`${svgsCount} graphique(s) SVG attendu(s), mais les tracés vectoriels semblent incomplets.`);
  }

  // Box Model Decorations
  let boxesFound = 0;
  if (boxesCount > 0) {
    if (pdfData.rectCount >= Math.min(boxesCount, 2)) {
      boxesFound = boxesCount;
    }
  }
  const boxesOk = boxesCount === 0 || boxesFound >= boxesCount;
  if (boxesCount > 0 && !boxesOk) {
    warnings.push(`${boxesCount} bloc(s) avec style de boîte attendu(s), mais les rectangles vectoriels manquent.`);
  }

  // Page Zones
  let pageZonesFound = false;
  if (hasPageZonesExpected) {
    const hasPageNumber = /\bpage\s+\d+/i.test(pdfData.fullRawText) || /\b\d+\s+sur\s+\d+/i.test(pdfData.fullRawText);
    pageZonesFound = hasPageNumber || pdfData.fullRawText.length > bodyText.length * 0.95;
  }
  const pageZonesOk = !hasPageZonesExpected || pageZonesFound;
  if (hasPageZonesExpected && !pageZonesOk) {
    warnings.push(`Règles @page définies mais les en-têtes ou pieds de page n'ont pas été identifiés.`);
  }

  // 5. Score Calculation (Weighted)
  // - Text Completeness: 40 points
  const textScore = textRecallRate * 40;

  // - Structural Features: 25 points
  let featureTotal = 0;
  let featureEarned = 0;

  const checkFeatureWeight = (weight: number, isOk: boolean, isPresent: boolean) => {
    if (isPresent) {
      featureTotal += weight;
      if (isOk) featureEarned += weight;
    }
  };

  checkFeatureWeight(6, headingsOk, headingsCount > 0);
  checkFeatureWeight(6, tablesOk, tablesCount > 0);
  checkFeatureWeight(5, listsOk, listsCount > 0);
  checkFeatureWeight(4, imagesOk, imagesCount > 0);
  checkFeatureWeight(4, svgsOk, svgsCount > 0);

  const featureScore = featureTotal > 0 ? (featureEarned / featureTotal) * 25 : 25;

  // - Box Model & Colors: 20 points
  let boxScore = 20;
  if (boxesCount > 0) {
    boxScore = boxesOk ? 20 : Math.max(5, (pdfData.rectCount / Math.max(1, boxesCount)) * 20);
  }

  // - Layout Integrity: 15 points
  let layoutScore = 15;
  if (pdfData.pageCount < 1) {
    layoutScore -= 10;
    warnings.push(`Aucune page PDF valide générée.`);
  }
  if (hasPageZonesExpected && !pageZonesOk) {
    layoutScore -= 5;
  }

  const rawScore = textScore + featureScore + boxScore + layoutScore;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Grade assignment
  let grade: QualityAuditResult['grade'] = 'F';
  if (score >= 95) grade = 'A+';
  else if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';

  const durationMs = Math.round((performance.now() - startTime) * 10) / 10;

  return {
    score,
    grade,
    passed: score >= minScore,
    textCompleteness: {
      totalHtmlWords: totalUniqueWords,
      foundInPdfWords: foundWords,
      rate: Math.round(textRecallRate * 1000) / 1000,
      missingSnippets,
    },
    features: {
      headings: { expected: headingsCount, found: headingsFound, ok: headingsOk },
      tables: { expected: tablesCount, found: tablesFound, ok: tablesOk },
      lists: { expected: listsCount, found: listsFound, ok: listsOk },
      images: { expected: imagesCount, found: imagesFound, ok: imagesOk },
      svgs: { expected: svgsCount, found: svgsFound, ok: svgsOk },
      boxDecorations: { expected: boxesCount, found: boxesFound, ok: boxesOk },
      pageZones: { expected: hasPageZonesExpected, found: pageZonesFound, ok: pageZonesOk },
    },
    layout: {
      pageCount: pdfData.pageCount,
    },
    warnings,
    durationMs,
  };
}
