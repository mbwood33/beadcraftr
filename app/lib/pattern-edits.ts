import type { ConvertedPattern } from "./types";

function recalculate(pattern: ConvertedPattern, cells: ConvertedPattern["cells"]): ConvertedPattern {
  const counts = new Map<string, number>();
  let emptyPegs = 0;
  cells.forEach((cell) => {
    if (cell.beadId) counts.set(cell.beadId, (counts.get(cell.beadId) ?? 0) + 1);
    else emptyPegs += 1;
  });
  return { ...pattern, cells, counts, emptyPegs };
}

export function setPatternCell(pattern: ConvertedPattern, x: number, y: number, beadId: string | null): ConvertedPattern {
  if (x < 0 || x >= pattern.width || y < 0 || y >= pattern.height) return pattern;
  const index = y * pattern.width + x;
  if (index < 0 || index >= pattern.cells.length || (beadId && !pattern.beadsById.has(beadId))) return pattern;
  if (pattern.cells[index].beadId === beadId) return pattern;
  const cells = pattern.cells.map((cell, currentIndex) => currentIndex === index ? { ...cell, beadId, sourceRgb: beadId ? cell.sourceRgb : null } : cell);
  return recalculate(pattern, cells);
}

export function floodPatternCells(pattern: ConvertedPattern, x: number, y: number, beadId: string | null): ConvertedPattern {
  if (x < 0 || x >= pattern.width || y < 0 || y >= pattern.height) return pattern;
  const start = y * pattern.width + x;
  if (start < 0 || start >= pattern.cells.length || (beadId && !pattern.beadsById.has(beadId))) return pattern;
  const target = pattern.cells[start].beadId;
  if (target === beadId) return pattern;
  const queued = [start];
  const visited = new Set<number>();
  const indices = new Set<number>();
  while (queued.length) {
    const index = queued.pop()!;
    if (visited.has(index) || pattern.cells[index].beadId !== target) continue;
    visited.add(index); indices.add(index);
    const px = index % pattern.width; const py = Math.floor(index / pattern.width);
    if (px > 0) queued.push(index - 1);
    if (px < pattern.width - 1) queued.push(index + 1);
    if (py > 0) queued.push(index - pattern.width);
    if (py < pattern.height - 1) queued.push(index + pattern.width);
  }
  return recalculate(pattern, pattern.cells.map((cell, index) => indices.has(index) ? { ...cell, beadId, sourceRgb: beadId ? cell.sourceRgb : null } : cell));
}
