/** Accepts 3- or 6-digit hex (with or without a leading `#`) and returns
 *  0-255 channel values. */
export function hexToRgb(hex: string): readonly [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value.padEnd(6, "0");
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
