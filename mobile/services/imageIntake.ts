/**
 * X-ray image intake rules (see .planning/CONTRACT.md §4):
 * reject non-images, originals over 20 MB and images under 512 px on the short
 * side, and re-encode to JPEG with the long edge at most 2048 px before upload.
 */
import { Image as ExpoImage } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_EDGE_PX = 2048;
/**
 * Smaller images (thumbnails, screenshots of a web page) lack the bone detail
 * the models need: bone age is estimated at 384 px and fractures at 640 px.
 */
export const MIN_SHORT_EDGE_PX = 512;
const JPEG_QUALITY = 0.9;

export type ImageIntakeProblem = 'not_image' | 'too_large' | 'too_small' | 'unreadable';

export class ImageIntakeError extends Error {
  problem: ImageIntakeProblem;

  constructor(problem: ImageIntakeProblem, message: string) {
    super(message);
    this.name = 'ImageIntakeError';
    this.problem = problem;
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A message when the image is too small for an accurate analysis, else null. */
export function checkImageSize(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null; // unknown: checked again when decoded
  if (Math.min(width, height) >= MIN_SHORT_EDGE_PX) return null;
  return (
    `This image is only ${Math.round(width)} × ${Math.round(height)} px, too small for an accurate analysis ` +
    `(at least ${MIN_SHORT_EDGE_PX} px on the short side is needed). Use the original X-ray, not a thumbnail or screenshot.`
  );
}

/**
 * Checks picker metadata. Fields the platform did not provide are skipped;
 * an unreadable file is still caught when it is decoded for upload.
 * Returns a user-facing message, or null when the asset is acceptable.
 */
export function checkPickedAsset(asset: {
  type?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}): string | null {
  if (asset.type && asset.type !== 'image') {
    return 'This file is not an image. Please choose a wrist X-ray photo.';
  }
  if (asset.mimeType && !asset.mimeType.toLowerCase().startsWith('image/')) {
    return 'This file is not an image. Please choose a wrist X-ray photo.';
  }
  if (asset.fileSize != null && asset.fileSize > MAX_ORIGINAL_BYTES) {
    return `This image is ${formatMegabytes(asset.fileSize)}. The maximum is ${formatMegabytes(
      MAX_ORIGINAL_BYTES
    )}. Please choose a smaller file.`;
  }
  return checkImageSize(asset.width, asset.height);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Short, path-free description of a native decode error, for dev diagnostics. */
function describeError(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? 'unknown error');
  return raw.replace(/(file|content|https?):\/\/\S+/gi, '<uri>').slice(0, 160);
}

function releaseRef(ref: unknown) {
  try {
    (ref as { release?: () => void })?.release?.();
  } catch {
    // Already released; nothing to free.
  }
}

/**
 * Decodes a local image already downsampled to fit 2048 x 2048, so a 50 MP
 * camera photo never exists in memory at full size. expo-image's loadAsync asks
 * Glide (Android) / SDWebImage (iOS) for the target size while decoding;
 * expo-image-manipulator's own loader always decodes at original size, which
 * fails ("Loading bitmap failed") on large phone photos.
 */
async function decodeForUpload(localUri: string): Promise<{ source: string | object; release: () => void }> {
  try {
    const ref = await ExpoImage.loadAsync(localUri, {
      maxWidth: MAX_UPLOAD_EDGE_PX,
      maxHeight: MAX_UPLOAD_EDGE_PX,
    });
    return { source: ref, release: () => releaseRef(ref) };
  } catch (err) {
    // Fall back to the manipulator's own (full-size) loader; fine for small files.
    if (__DEV__) console.warn(`[imageIntake] expo-image decode failed, falling back: ${describeError(err)}`);
    return { source: localUri, release: () => undefined };
  }
}

/**
 * Decodes a local image with the long edge at most 2048 px and re-encodes it as
 * JPEG. Throws ImageIntakeError('unreadable') when the file cannot be decoded;
 * in dev builds the message includes the underlying native reason.
 */
export async function prepareImageForUpload(
  localUri: string
): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const decoded = await decodeForUpload(localUri);
  let context;
  let rendered;
  try {
    context = ImageManipulator.manipulate(decoded.source as any);
    rendered = await context.renderAsync();
    // Belt and braces: the fallback path is not downsampled.
    if (Math.max(rendered.width, rendered.height) > MAX_UPLOAD_EDGE_PX) {
      const resize =
        rendered.width >= rendered.height
          ? { width: MAX_UPLOAD_EDGE_PX, height: null }
          : { width: null, height: MAX_UPLOAD_EDGE_PX };
      const resized = await context.resize(resize).renderAsync();
      releaseRef(rendered);
      rendered = resized;
    }
  } catch (err) {
    releaseRef(context);
    decoded.release();
    const reason = describeError(err);
    console.warn(`[imageIntake] decode failed: ${reason}`);
    throw new ImageIntakeError(
      'unreadable',
      __DEV__
        ? `This file could not be read as an image (${reason}).`
        : 'This file could not be read as an image. Please choose a different X-ray photo.'
    );
  }

  const tooSmall = checkImageSize(rendered.width, rendered.height);
  if (tooSmall) {
    releaseRef(rendered);
    releaseRef(context);
    decoded.release();
    throw new ImageIntakeError('too_small', tooSmall);
  }

  try {
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: JPEG_QUALITY,
      base64: true,
    });
    if (!saved.base64) {
      throw new ImageIntakeError('unreadable', 'The X-ray image could not be processed for upload.');
    }
    const data = base64ToArrayBuffer(saved.base64);
    if (data.byteLength === 0) {
      throw new ImageIntakeError('unreadable', 'The processed X-ray image is empty.');
    }
    return { data, width: saved.width, height: saved.height };
  } catch (err) {
    if (err instanceof ImageIntakeError) throw err;
    const reason = describeError(err);
    console.warn(`[imageIntake] JPEG encode failed: ${reason}`);
    throw new ImageIntakeError(
      'unreadable',
      __DEV__ ? `The X-ray image could not be processed (${reason}).` : 'The X-ray image could not be processed for upload.'
    );
  } finally {
    // Same order as expo-image-manipulator's manipulateAsync: free after saving.
    releaseRef(rendered);
    releaseRef(context);
    decoded.release();
  }
}
