import type { PMRegistry } from '../registry';

/** A context can be lost during readback, before its event handler clears GL.gl.
 * Do not deliver the resulting empty/invalid frame to an encoder. */
export function captureFramePixels(PM: PMRegistry, time: number, width: number, height: number,
  options: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const pixels = PM.GL.renderToPixels(time, width, height, options);
  if (!pixels || pixels.length !== width * height * 4 || PM.GL.gl?.isContextLost?.()) {
    throw new Error('The GPU could not capture the export frame');
  }
  return pixels;
}

/** Capture top-down opaque RGBA8, with transparency displayed over black.
 * The GPU capture pass converts orientation and alpha before readback, so the
 * ImageData shares that owned buffer without another allocation or CPU pass. */
export function renderOpaqueFrame(PM: PMRegistry, time: number, width: number, height: number,
  options: { mblur?: boolean; mbSamples?: number } = {}): ImageData {
  const quality = PM.quality;
  try {
    PM.quality = 1;
    const motionBlur = options.mblur !== false;
    const pixels = captureFramePixels(PM, time, width, height, {
      mblur: motionBlur, mbSamples: motionBlur ? Math.max(1, Number(options.mbSamples) || 16) : 1,
      shutter: PM.proj.shutter || .5, opaque: true, topDownOpaque: true,
    });
    return new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height);
  } finally {
    PM.quality = quality;
  }
}
