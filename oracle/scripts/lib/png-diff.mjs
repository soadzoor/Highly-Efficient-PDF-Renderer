let canvasModulePromise;

export async function comparePngBytes(expectedBytes, actualBytes, options = {}) {
  const canvasModule = await loadCanvasModule();
  const [expected, actual] = await Promise.all([
    decodePng(canvasModule, expectedBytes),
    decodePng(canvasModule, actualBytes)
  ]);

  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      dimensionsMatch: false,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      actualWidth: actual.width,
      actualHeight: actual.height,
      ssim: 0,
      nonEdgeWithinToleranceFraction: 0,
      nonEdgePixelCount: 0,
      maximumChannelDelta: 255
    };
  }

  const channelTolerance = options.channelTolerance ?? 8;
  const edgeThreshold = options.edgeThreshold ?? 24;
  const expectedData = expected.data;
  const actualData = actual.data;
  const pixelCount = expected.width * expected.height;
  let expectedSum = 0;
  let actualSum = 0;
  let expectedSquaredSum = 0;
  let actualSquaredSum = 0;
  let productSum = 0;
  let nonEdgePixelCount = 0;
  let nonEdgeWithinTolerance = 0;
  let maximumChannelDelta = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const expectedValue = compositeOnWhite(expectedData[offset + channel], expectedData[offset + 3]);
      const actualValue = compositeOnWhite(actualData[offset + channel], actualData[offset + 3]);
      expectedSum += expectedValue;
      actualSum += actualValue;
      expectedSquaredSum += expectedValue * expectedValue;
      actualSquaredSum += actualValue * actualValue;
      productSum += expectedValue * actualValue;
      maximumChannelDelta = Math.max(maximumChannelDelta, Math.abs(expectedValue - actualValue));
    }

    if (!isEdgePixel(expectedData, expected.width, expected.height, pixel, edgeThreshold)) {
      nonEdgePixelCount += 1;
      let withinTolerance = true;
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(expectedData[offset + channel] - actualData[offset + channel]) > channelTolerance) {
          withinTolerance = false;
          break;
        }
      }
      if (withinTolerance) {
        nonEdgeWithinTolerance += 1;
      }
    }
  }

  const sampleCount = pixelCount * 3;
  const expectedMean = expectedSum / sampleCount;
  const actualMean = actualSum / sampleCount;
  const expectedVariance = Math.max(0, expectedSquaredSum / sampleCount - expectedMean ** 2);
  const actualVariance = Math.max(0, actualSquaredSum / sampleCount - actualMean ** 2);
  const covariance = productSum / sampleCount - expectedMean * actualMean;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const denominator =
    (expectedMean ** 2 + actualMean ** 2 + c1) *
    (expectedVariance + actualVariance + c2);
  const ssim = denominator === 0
    ? 1
    : ((2 * expectedMean * actualMean + c1) * (2 * covariance + c2)) / denominator;

  return {
    dimensionsMatch: true,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    actualWidth: actual.width,
    actualHeight: actual.height,
    ssim: clamp(ssim, -1, 1),
    nonEdgeWithinToleranceFraction: nonEdgePixelCount === 0
      ? 1
      : nonEdgeWithinTolerance / nonEdgePixelCount,
    nonEdgePixelCount,
    maximumChannelDelta
  };
}

async function loadCanvasModule() {
  canvasModulePromise ??= import("@napi-rs/canvas");
  return canvasModulePromise;
}

async function decodePng(canvasModule, bytes) {
  const image = await canvasModule.loadImage(Buffer.from(bytes));
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("PNG decoder returned invalid dimensions.");
  }
  const canvas = canvasModule.createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data
  };
}

function compositeOnWhite(channel, alpha) {
  if (alpha === 255) {
    return channel;
  }
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function isEdgePixel(data, width, height, pixel, threshold) {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  const center = luminance(data, pixel);
  const neighbors = [];
  if (x > 0) neighbors.push(pixel - 1);
  if (x + 1 < width) neighbors.push(pixel + 1);
  if (y > 0) neighbors.push(pixel - width);
  if (y + 1 < height) neighbors.push(pixel + width);
  return neighbors.some((neighbor) => Math.abs(center - luminance(data, neighbor)) > threshold);
}

function luminance(data, pixel) {
  const offset = pixel * 4;
  const alpha = data[offset + 3];
  const red = compositeOnWhite(data[offset], alpha);
  const green = compositeOnWhite(data[offset + 1], alpha);
  const blue = compositeOnWhite(data[offset + 2], alpha);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
