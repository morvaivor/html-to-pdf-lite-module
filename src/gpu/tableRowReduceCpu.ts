/**
 * High-performance CPU fallback and reference implementation for table row height reduction.
 * Computes max(cellHeight) for each row in a single contiguous loop.
 */
export function tableRowReduceCpu(
  cellHeights: Float32Array,
  rowCount: number,
  maxCols: number,
  borderWidth: number,
): Float32Array {
  const rowHeights = new Float32Array(rowCount);
  for (let r = 0; r < rowCount; r++) {
    let maxHeight = 0;
    const base = r * maxCols;
    for (let c = 0; c < maxCols; c++) {
      const h = cellHeights[base + c]!;
      if (h > maxHeight) {
        maxHeight = h;
      }
    }
    rowHeights[r] = maxHeight + borderWidth;
  }
  return rowHeights;
}
