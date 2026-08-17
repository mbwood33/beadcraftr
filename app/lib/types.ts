/** Stable, UI-independent domain types for BeadCraftr. */
export type Rgb = Readonly<{ r: number; g: number; b: number }>;

export type Bead = Readonly<{
  /** `${normalizedBrand}:${normalizedCode}`; never derived from name or RGB. */
  id: string;
  code: string;
  name: string;
  brand: string;
  notes: string;
  rgb: Rgb | null;
  html: string | null;
}>;

export type BrandSelection = "PERLER" | "ARTKAL" | "BOTH" | string;

export type RgbaRaster = Readonly<{
  width: number;
  height: number;
  /** Row-major RGBA bytes. The conversion API expects one source pixel per peg. */
  data: Uint8ClampedArray;
}>;

export type Background = Readonly<
  | { kind: "empty" }
  | { kind: "bead"; beadId: string }
>;

export type ConversionOptions = Readonly<{
  width: number;
  height: number;
  brand: BrandSelection;
  disabledBeadIds?: ReadonlySet<string>;
  maxColors?: number;
  alphaThreshold?: number;
  background?: Background;
}>;

export type PatternCell = Readonly<{
  x: number;
  y: number;
  beadId: string | null;
  /** Prepared/composited pixel color that was matched, if occupied. */
  sourceRgb: Rgb | null;
}>;

export type ConvertedPattern = Readonly<{
  width: number;
  height: number;
  cells: readonly PatternCell[];
  beadsById: ReadonlyMap<string, Bead>;
  counts: ReadonlyMap<string, number>;
  emptyPegs: number;
}>;
