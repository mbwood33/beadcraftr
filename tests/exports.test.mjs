import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

const exports = await import("../app/lib/exports.ts");

const black = { id: "perler:80", brand: "Perler", code: "80", name: "Black", hex: "#000000", symbol: "A" };
const white = { id: "perler:1", brand: "Perler", code: "1", name: "White", hex: "#FFFFFF", symbol: "B" };
const pattern = {
  width: 2,
  height: 2,
  cells: [[black, null], [white, black]],
  metadata: {
    maxColorDepth: 16,
    boardWidth: 29,
    boardHeight: 29,
    inventoryByBeadId: { "perler:80": 1 },
    symbolsByBeadId: { "perler:80": "K" },
  },
};

test("materials exports include symbols, inventory, and calculated shortages", () => {
  const rows = exports.buildMaterialsRows(pattern, 10);
  assert.deepEqual(rows.map(({ id, symbol, requiredQuantity, recommendedQuantity, onHandQuantity, quantityToBuy }) => ({ id, symbol, requiredQuantity, recommendedQuantity, onHandQuantity, quantityToBuy })), [
    { id: "perler:1", symbol: "B", requiredQuantity: 1, recommendedQuantity: 2, onHandQuantity: 0, quantityToBuy: 2 },
    { id: "perler:80", symbol: "K", requiredQuantity: 2, recommendedQuantity: 3, onHandQuantity: 1, quantityToBuy: 2 },
  ]);
  const csv = exports.materialsToCsv(rows);
  assert.match(csv, /^\uFEFFSymbol,Brand,Code,Color/m);
  assert.match(csv, /K,Perler,80,Black,#000000,2,10,3,1,2/);
});

test("grid CSV serializes all pegs with human-facing coordinates and metadata symbols", () => {
  const csv = exports.patternGridToCsv(pattern);
  assert.match(csv, /Column \(x\),Row \(y\),Occupied,Symbol,Bead ID/);
  assert.match(csv, /1,1,Yes,K,perler:80,Perler,80,Black,#000000/);
  assert.match(csv, /2,1,No,,,,,,/);
  assert.match(csv, /1,2,Yes,B,perler:1,Perler,1,White,#FFFFFF/);
});

async function workbookFiles(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50, "XLSX begins with ZIP signature P");
  assert.equal(bytes[1], 0x4b, "XLSX begins with ZIP signature K");
  return unzipSync(bytes);
}

test("XLSX exports are OpenXML ZIP workbooks containing expected worksheets", async () => {
  const materialFiles = await workbookFiles(exports.createMaterialsXlsxBlob(exports.buildMaterialsRows(pattern)));
  assert.ok(materialFiles["[Content_Types].xml"]);
  assert.ok(materialFiles["xl/workbook.xml"]);
  assert.match(strFromU8(materialFiles["xl/worksheets/sheet1.xml"]), /Required quantity/);
  assert.match(strFromU8(materialFiles["xl/worksheets/sheet1.xml"]), /Quantity to buy/);

  const patternFiles = await workbookFiles(exports.createPatternGridXlsxBlob(pattern));
  const workbook = strFromU8(patternFiles["xl/workbook.xml"]);
  assert.match(workbook, /Pattern grid/);
  assert.match(workbook, /Peg data/);
  assert.match(workbook, /Pattern info/);
  assert.match(strFromU8(patternFiles["xl/worksheets/sheet3.xml"]), /Generation color limit/);
});
