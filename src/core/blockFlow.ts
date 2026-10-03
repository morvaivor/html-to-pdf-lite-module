/**
 * Vertical margins of the block flow. Adjacent block siblings collapse their margins (CSS 2.1 §8.3.1):
 * the gap between a block and the next one is the larger of the bottom and top margins, not their sum.
 * Parent and child margins do not collapse, and anything drawn in between breaks the adjacency.
 * Negative margins are ignored, as before.
 */

interface MarginEdge {
  readonly y: number;
  readonly margin: number;
  readonly page: unknown;
}

/** Bottom margin that ended the last block, per document. */
const bottomEdges = new WeakMap<object, MarginEdge>();

/** Starts a block: advances by its top margin, collapsed with the bottom margin of the block just above. */
export function applyMarginTop(doc: PDFKit.PDFDocument, marginTop: number): void {
  const top = Math.max(0, marginTop);
  const edge = bottomEdges.get(doc);
  bottomEdges.delete(doc);
  if (edge !== undefined && edge.page === doc.page && edge.y === doc.y) {
    doc.y += Math.max(0, top - edge.margin);
  } else if (top > 0) {
    doc.y += top;
  }
}

/** Ends a block: advances by its bottom margin and keeps it for the next sibling to collapse with. */
export function applyMarginBottom(doc: PDFKit.PDFDocument, marginBottom: number): void {
  const bottom = Math.max(0, marginBottom);
  if (bottom > 0) doc.y += bottom;
  bottomEdges.set(doc, { y: doc.y, margin: bottom, page: doc.page });
}

/** Height two adjacent siblings save when their margins collapse (for height estimates). */
export function collapsedMarginOverlap(previousBottom: number, nextTop: number): number {
  return Math.min(Math.max(0, previousBottom), Math.max(0, nextTop));
}
