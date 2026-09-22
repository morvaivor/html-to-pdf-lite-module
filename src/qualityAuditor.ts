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
    sequenceAlignmentRate: number; // 0.0 to 1.0 via ROUGE-L / LCS
    lcsLength: number;
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
    multiColumnExpected: boolean;
    multiColumnDetected: boolean;
    distinctXPositionsCount: number;
    collisionsCount: number;
    marginViolationsCount: number;
  };
  /** Spatial & Sequence Quality Index (SSQI) components */
  ssqi: {
    sequenceScore: number;
    spatialScore: number;
    typoScore: number;
    structScore: number;
    criticalGatingFactor: number;
  };
  /** Warnings and improvement opportunities */
  warnings: string[];
  /** Execution duration in milliseconds */
  durationMs: number;
}

interface PdfTextItem {
  streamIndex: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
}

interface PdfExtractedData {
  pageCount: number;
  fullRawText: string;
  orderedWords: string[];
  textItems: PdfTextItem[];
  hasImages: boolean;
  rectCount: number;
  lineCount: number;
  curveCount: number;
  hasColorOperators: boolean;
  distinctXPositions: number[];
}

/**
 * Computes the Longest Common Subsequence length between two word arrays using O(min(M, N)) memory.
 */
export function computeLcsLength(seq1: readonly string[], seq2: readonly string[]): number {
  const m = seq1.length;
  const n = seq2.length;
  if (m === 0 || n === 0) return 0;

  // Bound maximum tokens for LCS to prevent quadratic memory/time spikes
  const maxTokens = 1500;
  const s1 = m > maxTokens ? seq1.slice(0, maxTokens) : seq1;
  const s2 = n > maxTokens ? seq2.slice(0, maxTokens) : seq2;

  const [short, long] = s1.length < s2.length ? [s1, s2] : [s2, s1];
  const sLen = short.length;
  const lLen = long.length;

  let prev = new Uint32Array(sLen + 1);
  let curr = new Uint32Array(sLen + 1);

  for (let i = 1; i <= lLen; i++) {
    const item = long[i - 1];
    for (let j = 1; j <= sLen; j++) {
      if (item === short[j - 1]) {
        curr[j] = prev[j - 1]! + 1;
      } else {
        const up = prev[j]!;
        const left = curr[j - 1]!;
        curr[j] = up > left ? up : left;
      }
    }
    const temp = prev;
    prev = curr;
    curr = temp;
    curr.fill(0);
  }

  const factor = m > maxTokens ? m / maxTokens : 1;
  return Math.min(m, Math.round(prev[sLen]! * factor));
}

/**
 * Decompresses and extracts text and vector drawing commands from a PDF buffer safely with zip-bomb protection.
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

  // 3. Decompress all streams with maxOutputLength to prevent decompression bombs (Zip bomb)
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let streamMatch: RegExpExecArray | null;
  const decompressedStreams: string[] = [];

  while ((streamMatch = streamRegex.exec(binaryString)) !== null) {
    const rawStream = streamMatch[1];
    if (!rawStream) continue;
    try {
      const decompressed = zlib
        .inflateSync(Buffer.from(rawStream, 'binary'), { maxOutputLength: 20 * 1024 * 1024 })
        .toString('latin1');
      decompressedStreams.push(decompressed);
    } catch {
      // In case stream is uncompressed or uses another filter
      decompressedStreams.push(rawStream);
    }
  }

  // 4. Extract text items, positions, and vector commands
  let fullRawText = '';
  const orderedWords: string[] = [];
  const textItems: PdfTextItem[] = [];
  let rectCount = 0;
  let lineCount = 0;
  let curveCount = 0;
  let hasColorOperators = false;
  const distinctXSet = new Set<number>();

  for (let streamIndex = 0; streamIndex < decompressedStreams.length; streamIndex++) {
    const stream = decompressedStreams[streamIndex]!;
    let curFontSize = 12;
    let curX = 0;
    let curY = 0;

    // Single-pass scanner across font, matrix, and text operators
    const opRegex =
      /(?:\/([A-Za-z0-9_-]+)\s+([0-9.]+)\s+Tf)|(?:([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm)|(?:\[([\s\S]*?)\]\s*TJ)|(?:(?:\(([\s\S]*?)\)|<([0-9a-fA-F]+)>)\s*Tj)/g;

    let opMatch: RegExpExecArray | null;
    while ((opMatch = opRegex.exec(stream)) !== null) {
      // 1. Tf operator (Font size)
      if (opMatch[2]) {
        const sizeVal = parseFloat(opMatch[2]);
        if (!isNaN(sizeVal) && sizeVal > 0) curFontSize = sizeVal;
        continue;
      }

      // 2. Tm operator (Text Matrix)
      if (opMatch[7] !== undefined && opMatch[8] !== undefined) {
        const xVal = parseFloat(opMatch[7]);
        const yVal = parseFloat(opMatch[8]);
        if (!isNaN(xVal)) {
          curX = xVal;
          if (xVal > 10) {
            distinctXSet.add(Math.round(xVal / 25) * 25);
          }
        }
        if (!isNaN(yVal)) curY = yVal;
        continue;
      }

      // 3. TJ Array
      if (opMatch[9] !== undefined) {
        const content = opMatch[9];
        let segmentText = '';
        const tokenRegex = /<([0-9a-fA-F]+)>|\(([^)]*)\)/g;
        let tokenMatch: RegExpExecArray | null;
        while ((tokenMatch = tokenRegex.exec(content)) !== null) {
          if (tokenMatch[1]) {
            segmentText += Buffer.from(tokenMatch[1], 'hex').toString('latin1');
          } else if (tokenMatch[2] !== undefined) {
            segmentText += tokenMatch[2];
          }
        }

        if (segmentText.trim()) {
          fullRawText += ' ' + segmentText;
          const words = normalizeWords(segmentText);
          for (const w of words) orderedWords.push(w);
          textItems.push({
            streamIndex,
            text: segmentText,
            x: curX,
            y: curY,
            fontSize: curFontSize,
            width: segmentText.length * curFontSize * 0.52,
            height: curFontSize * 1.15,
          });
        }
        continue;
      }

      // 4. Tj single string
      if (opMatch[10] !== undefined || opMatch[11] !== undefined) {
        let singleText = '';
        if (opMatch[11]) {
          singleText = Buffer.from(opMatch[11], 'hex').toString('latin1');
        } else if (opMatch[10]) {
          singleText = opMatch[10];
        }

        if (singleText.trim()) {
          fullRawText += ' ' + singleText;
          const words = normalizeWords(singleText);
          for (const w of words) orderedWords.push(w);
          textItems.push({
            streamIndex,
            text: singleText,
            x: curX,
            y: curY,
            fontSize: curFontSize,
            width: singleText.length * curFontSize * 0.52,
            height: curFontSize * 1.15,
          });
        }
        continue;
      }
    }

    // Vector commands counts
    const rects = stream.match(/[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+re/g);
    if (rects) rectCount += rects.length;

    const lines = stream.match(/[0-9.-]+\s+[0-9.-]+\s+l\b/g);
    if (lines) lineCount += lines.length;

    const curves = stream.match(/[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+[0-9.-]+\s+c\b/g);
    if (curves) curveCount += curves.length;

    if (stream.includes(' rg') || stream.includes(' RG') || stream.includes(' scn') || stream.includes(' SCN')) {
      hasColorOperators = true;
    }
  }

  return {
    pageCount,
    fullRawText,
    orderedWords,
    textItems,
    hasImages,
    rectCount,
    lineCount,
    curveCount,
    hasColorOperators,
    distinctXPositions: Array.from(distinctXSet),
  };
}

/**
 * Normalizes text for comparison by collapsing whitespaces and removing punctuation.
 */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[«»"'.,;:!?()[\]{}•/\\|—–_-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
}

/**
 * Verifies the rendering quality and fidelity of a generated PDF against the input HTML using SSQI.
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
  const headingWordSet = new Set<string>();
  $('h1, h2, h3, h4, h5, h6').each((_i, el) => {
    const words = normalizeWords($(el).text());
    if (words[0]) {
      headingWords.push(words[0]);
      headingWordSet.add(words[0]);
    }
  });

  // Ensure whitespace between adjacent block/cell elements
  $('td, th, p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, table').after(' ');

  // Strip style and script for clean text analysis
  $('style, script, head, meta, link').remove();

  // Extract all textual content from body in natural DOM order
  const bodyText = $('body').text().trim() || $.root().text().trim();
  const htmlWords = normalizeWords(bodyText);

  // Page zones (@page) in CSS
  const pageZones = parsePageRule(fullCss);
  const hasPageZonesExpected = Boolean(pageZones && Object.keys(pageZones).length > 0);

  // 2. Extract Data from PDF
  const pdfData = extractPdfData(pdfBuffer);
  const pdfTextNormalized = pdfData.fullRawText.toLowerCase();

  // 3. Text Completeness & Sequence Alignment Audit (ROUGE-L / LCS)
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

  // Compute Longest Common Subsequence between HTML tokens and PDF tokens in reading order
  const uniqueHtmlSequence: string[] = [];
  const seenUnique = new Set<string>();
  for (const word of htmlWords) {
    if (!seenUnique.has(word)) {
      seenUnique.add(word);
      uniqueHtmlSequence.push(word);
    }
  }

  const seenPdf = new Set<string>();
  const uniquePdfSequence: string[] = [];
  for (const word of pdfData.orderedWords) {
    if (seenUnique.has(word) && !seenPdf.has(word)) {
      seenPdf.add(word);
      uniquePdfSequence.push(word);
    }
  }

  const lcsLength = computeLcsLength(uniqueHtmlSequence, uniquePdfSequence);
  const sequenceAlignmentRate = uniqueHtmlSequence.length > 0 ? lcsLength / uniqueHtmlSequence.length : 1.0;

  // 4. Spatial Layout, Collisions, and Margin Violations
  let collisionsCount = 0;
  let marginViolationsCount = 0;
  const items = pdfData.textItems;

  for (let i = 0; i < items.length; i++) {
    const itemA = items[i]!;
    if (!itemA.text.trim()) continue;

    // Detect margin clipping (PDF coordinate bounds)
    if (itemA.x < -10 || itemA.x > 750 || itemA.y < -20 || itemA.y > 1000) {
      marginViolationsCount++;
    }

    // Check collision with nearby text items on the same page/stream
    for (let j = i + 1; j < Math.min(i + 15, items.length); j++) {
      const itemB = items[j]!;
      if (!itemB.text.trim()) continue;
      if (itemA.streamIndex !== itemB.streamIndex) continue;

      const yDiff = Math.abs(itemA.y - itemB.y);
      const minFont = Math.min(itemA.fontSize, itemB.fontSize);

      // On same vertical baseline
      if (yDiff < minFont * 0.35) {
        const xOverlap = Math.min(itemA.x + itemA.width, itemB.x + itemB.width) - Math.max(itemA.x, itemB.x);
        if (xOverlap > Math.min(itemA.width, itemB.width) * 0.5 && xOverlap > 25 && itemA.text !== itemB.text) {
          collisionsCount++;
        }
      }
    }
  }

  // 5. Typographic Hierarchy Check
  const headingSizes: number[] = [];
  const bodySizes: number[] = [];

  for (const item of items) {
    const words = normalizeWords(item.text);
    const isHeading = words.some((w) => headingWordSet.has(w));
    if (isHeading) {
      headingSizes.push(item.fontSize);
    } else {
      bodySizes.push(item.fontSize);
    }
  }

  let headingMaxFontSize = 0;
  let bodyMedianFontSize = 12;

  if (headingSizes.length > 0) {
    headingMaxFontSize = Math.max(...headingSizes);
  }
  if (bodySizes.length > 0) {
    bodySizes.sort((a, b) => a - b);
    bodyMedianFontSize = bodySizes[Math.floor(bodySizes.length / 2)] ?? 12;
  }

  const typoHierarchyOk = headingsCount === 0 || headingMaxFontSize >= bodyMedianFontSize * 1.05;

  // 6. Feature Audits
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
  if (!typoHierarchyOk && headingsCount > 0) {
    warnings.push(`Hiérarchie typographique faible : les titres n'ont pas une taille nettement supérieure au texte.`);
  }

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
  const boxesFound = Math.min(boxesCount, pdfData.rectCount);
  const boxesOk = boxesCount === 0 || boxesFound >= Math.ceil(boxesCount * 0.7);
  if (boxesCount > 0 && !boxesOk) {
    warnings.push(
      `${boxesCount} bloc(s) avec style de boîte attendu(s), mais seulement ${pdfData.rectCount} rectangle(s) vectoriel(s) détecté(s).`,
    );
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

  // Multi-column Layout Detection
  let multiColumnExpected = false;
  $('table').each((_i, el) => {
    const cols = $(el).find('tr').first().find('td, th').length;
    if (cols >= 2) multiColumnExpected = true;
  });
  $('*').each((_i, el) => {
    const s = parseInlineStyle(el as any);
    if (
      s.display === 'flex' ||
      s.display === 'grid' ||
      s.gridTemplateColumns ||
      (s.width && String(s.width).includes('%') && parseFloat(String(s.width)) < 100)
    ) {
      multiColumnExpected = true;
    }
  });

  const distinctXCount = pdfData.distinctXPositions.length;
  const multiColumnDetected = distinctXCount >= 2;
  const multiColumnOk = !multiColumnExpected || multiColumnDetected;
  if (!multiColumnOk) {
    warnings.push(
      `Mise en page multi-colonnes attendue (flex/grid/table), mais le texte du PDF semble empilé sur une seule colonne.`,
    );
  }

  if (collisionsCount > 0) {
    warnings.push(`${collisionsCount} collision(s) ou chevauchement(s) de texte détecté(s) dans le PDF.`);
  }
  if (marginViolationsCount > 0) {
    warnings.push(`${marginViolationsCount} bloc(s) de texte hors marges imprimables détecté(s).`);
  }
  if (sequenceAlignmentRate < 0.55) {
    warnings.push(
      `Continuité séquentielle dégradée (${Math.round(sequenceAlignmentRate * 100)}%) : texte tronqué ou ordre de lecture perturbé.`,
    );
  }

  // 7. SSQI Score Calculation (Spatial & Sequence Quality Index)
  // - Sequence Score: 35 points (combination of unique word recall & ordered sequence alignment)
  const combinedTextRecall = textRecallRate * 0.7 + sequenceAlignmentRate * 0.3;
  const sequenceScore = combinedTextRecall * 35;

  // - Spatial Score: 30 points (no collisions, bounds respect, column balance)
  const collisionPenalty = Math.min(1.0, collisionsCount * 0.15);
  const marginPenalty = Math.min(1.0, marginViolationsCount * 0.25);
  const spatialScore = (1 - collisionPenalty) * (1 - marginPenalty) * (multiColumnOk ? 30 : 22);

  // - Typographic & Colors Score: 15 points
  const typoHierarchyRatio = typoHierarchyOk ? 1.0 : 0.7;
  const colorBonus = pdfData.hasColorOperators ? 1.0 : 0.85;
  const typoScore = typoHierarchyRatio * colorBonus * 15;

  // - Structural Features Score: 20 points
  let featureTotal = 0;
  let featureEarned = 0;
  const checkFeatureWeight = (weight: number, isOk: boolean, isPresent: boolean) => {
    if (isPresent) {
      featureTotal += weight;
      if (isOk) featureEarned += weight;
    }
  };

  checkFeatureWeight(5, headingsOk, headingsCount > 0);
  checkFeatureWeight(5, tablesOk, tablesCount > 0);
  checkFeatureWeight(4, listsOk, listsCount > 0);
  checkFeatureWeight(3, imagesOk, imagesCount > 0);
  checkFeatureWeight(3, svgsOk, svgsCount > 0);
  checkFeatureWeight(4, boxesOk, boxesCount > 0);

  const structScore = featureTotal > 0 ? (featureEarned / featureTotal) * 20 : 20;

  // - Critical Gating Factor (Γ)
  let criticalGatingFactor = 1.0;
  if (textRecallRate < 0.65 || sequenceAlignmentRate < 0.4) {
    criticalGatingFactor *= 0.4;
  } else if (textRecallRate < 0.8 || sequenceAlignmentRate < 0.55) {
    criticalGatingFactor *= 0.8;
  }

  if (collisionsCount >= 3) {
    criticalGatingFactor *= 0.7;
  } else if (collisionsCount >= 1) {
    criticalGatingFactor *= 0.9;
  }

  if (marginViolationsCount >= 2) {
    criticalGatingFactor *= 0.85;
  }

  if (pdfData.pageCount < 1) {
    criticalGatingFactor *= 0.2;
    warnings.push(`Aucune page PDF valide générée.`);
  }

  const rawScore = (sequenceScore + spatialScore + typoScore + structScore) * criticalGatingFactor;
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
      sequenceAlignmentRate: Math.round(sequenceAlignmentRate * 1000) / 1000,
      lcsLength,
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
      multiColumnExpected,
      multiColumnDetected,
      distinctXPositionsCount: distinctXCount,
      collisionsCount,
      marginViolationsCount,
    },
    ssqi: {
      sequenceScore: Math.round(sequenceScore * 10) / 10,
      spatialScore: Math.round(spatialScore * 10) / 10,
      typoScore: Math.round(typoScore * 10) / 10,
      structScore: Math.round(structScore * 10) / 10,
      criticalGatingFactor: Math.round(criticalGatingFactor * 100) / 100,
    },
    warnings,
    durationMs,
  };
}
