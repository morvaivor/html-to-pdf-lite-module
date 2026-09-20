/**
 * Standard W3C WGSL Compute Shader for Parallel Table Row Height Reduction.
 * Each compute thread processes one table row independently:
 * scans all columns in the row, computes max(cellHeight), and adds border width.
 */
export const TABLE_ROW_REDUCE_WGSL = /* wgsl */ `
struct Uniforms {
  rowCount: u32,
  maxCols: u32,
  borderWidth: f32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> cellHeights: array<f32>;
@group(0) @binding(2) var<storage, read_write> rowHeights: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let row = global_id.x;
  if (row >= uniforms.rowCount) {
    return;
  }

  var maxHeight: f32 = 0.0;
  let baseIdx = row * uniforms.maxCols;

  for (var c: u32 = 0u; c < uniforms.maxCols; c = c + 1u) {
    let h = cellHeights[baseIdx + c];
    if (h > maxHeight) {
      maxHeight = h;
    }
  }

  rowHeights[row] = maxHeight + uniforms.borderWidth;
}
`;
