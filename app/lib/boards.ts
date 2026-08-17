export type BoardTile = Readonly<{ column: number; row: number; x: number; y: number; width: number; height: number; label: string }>;
export type BoardLayout = Readonly<{ boardWidth: number; boardHeight: number; columns: number; rows: number; count: number; tiles: readonly BoardTile[] }>;

function rowLabel(row: number): string {
  let value = row;
  let label = "";
  do { label = String.fromCharCode(65 + (value % 26)) + label; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return label;
}

/** Splits a logical pattern into physical-board rectangles, labelled A1, A2, B1... */
export function boardLayout(width: number, height: number, boardWidth = 29, boardHeight = 29): BoardLayout {
  for (const [value, label] of [[width, "Pattern width"], [height, "Pattern height"], [boardWidth, "Board width"], [boardHeight, "Board height"]] as const) if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  const columns = Math.ceil(width / boardWidth), rows = Math.ceil(height / boardHeight);
  const tiles: BoardTile[] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = column * boardWidth, y = row * boardHeight;
    tiles.push({ column, row, x, y, width: Math.min(boardWidth, width - x), height: Math.min(boardHeight, height - y), label: `${rowLabel(row)}${column + 1}` });
  }
  return { boardWidth, boardHeight, columns, rows, count: tiles.length, tiles };
}
