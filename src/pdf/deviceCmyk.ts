/**
 * Convert an uncalibrated PDF DeviceCMYK color to the renderer's sRGB output.
 *
 * PDF leaves DeviceCMYK interpretation device-dependent when no calibrated
 * replacement or output profile is present. This polynomial is the stable
 * fallback used by PDF.js, retained here so native parsing and HEP rendering
 * agree with the migration oracle. Inputs and outputs are normalized.
 * An optional caller-owned output tuple avoids allocation in image loops.
 *
 * Adapted from PDF.js DeviceCmykCS (Apache-2.0).
 */
export function convertDeviceCmykToSrgb(
  cyan: number,
  magenta: number,
  yellow: number,
  black: number,
  output?: [number, number, number]
): readonly [number, number, number] {
  const c = clamp01(cyan);
  const m = clamp01(magenta);
  const y = clamp01(yellow);
  const k = clamp01(black);
  const red = 255 + c * (
    -4.387332384609988 * c + 54.48615194189176 * m +
    18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004
  ) + m * (
    1.7149763477362134 * m - 5.6096736904047315 * y -
    17.873870861415444 * k - 5.497006427196366
  ) + y * (
    -2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813
  ) + k * (-21.86122147463605 * k - 189.48180835922747);
  const green = 255 + c * (
    8.841041422036149 * c + 60.118027045597366 * m +
    6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548
  ) + m * (
    -15.310361306967817 * m + 17.575251261109482 * y +
    131.35250912493976 * k - 190.9453302588951
  ) + y * (
    4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878
  ) + k * (-20.737325471181034 * k - 187.80453709719578);
  const blue = 255 + c * (
    0.8842522430003296 * c + 8.078677503112928 * m +
    30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286
  ) + m * (
    10.49593273432072 * m + 63.02378494754052 * y +
    50.606957656360734 * k - 112.23884253719248
  ) + y * (
    0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505
  ) + k * (-22.33816807309886 * k - 180.12613974708367);
  if (output) {
    output[0] = clampByte(red) / 255;
    output[1] = clampByte(green) / 255;
    output[2] = clampByte(blue) / 255;
    return output;
  }
  return [clampByte(red) / 255, clampByte(green) / 255, clampByte(blue) / 255];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, value));
}
