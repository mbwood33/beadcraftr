export type ImageAdjustments = Readonly<{
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
}>;

export const defaultImageAdjustments: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  gamma: 1,
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function hueToRgb(low: number, high: number, hue: number): number {
  const normalized = ((hue % 1) + 1) % 1;
  if (normalized < 1 / 6) return low + (high - low) * 6 * normalized;
  if (normalized < 1 / 2) return high;
  if (normalized < 2 / 3) return low + (high - low) * (2 / 3 - normalized) * 6;
  return low;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation === 0) return [lightness, lightness, lightness];
  const high = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const low = 2 * lightness - high;
  return [hueToRgb(low, high, hue + 1 / 3), hueToRgb(low, high, hue), hueToRgb(low, high, hue - 1 / 3)];
}

/** Applies non-destructive, deterministic adjustment settings to RGBA image bytes. */
export function applyImageAdjustments(data: Uint8ClampedArray, settings: ImageAdjustments): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);
  const brightness = 1 + settings.brightness / 100;
  const contrast = 1 + settings.contrast / 100;
  const saturation = 1 + settings.saturation / 100;
  const hueShift = settings.hue / 360;
  const gamma = Math.max(0.1, settings.gamma);
  for (let index = 0; index < output.length; index += 4) {
    if (output[index + 3] === 0) continue;
    let red = clamp(((output[index] / 255 - 0.5) * contrast + 0.5) * brightness);
    let green = clamp(((output[index + 1] / 255 - 0.5) * contrast + 0.5) * brightness);
    let blue = clamp(((output[index + 2] / 255 - 0.5) * contrast + 0.5) * brightness);
    const [hue, originalSaturation, lightness] = rgbToHsl(red, green, blue);
    [red, green, blue] = hslToRgb(hue + hueShift, clamp(originalSaturation * saturation), lightness);
    output[index] = Math.round(clamp(red) ** (1 / gamma) * 255);
    output[index + 1] = Math.round(clamp(green) ** (1 / gamma) * 255);
    output[index + 2] = Math.round(clamp(blue) ** (1 / gamma) * 255);
  }
  return output;
}
