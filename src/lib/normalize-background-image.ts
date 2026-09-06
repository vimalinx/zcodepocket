import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, FileMode, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { apngPoster, isPng } from './apng-poster';

// Decode by file contents, not extension. The durable background is a bounded,
// static PNG, preserving transparency and avoiding a second format-specific decode.
export async function normalizeBackgroundImage(uri: string): Promise<string> {
  let poster: File | undefined;
  try {
    const source = new File(uri);
    const handle = source.open(FileMode.ReadOnly);
    let png = false;
    try { png = isPng(handle.readBytes(8)); } finally { handle.close(); }
    if (png) {
      if (source.size > 32 * 1024 * 1024) throw new Error('PNG 超过 32 MB，请缩小后重试');
      const bytes = apngPoster(await source.bytes());
      if (bytes) {
        poster = new File(Paths.cache, `zcpocket-apng-poster-${randomUUID()}.png`);
        poster.write(bytes);
        uri = poster.uri;
      }
    }
    return await normalizeDecodedImage(uri);
  } finally {
    try { if (poster?.exists) poster.delete(); } catch { /* only our temporary poster */ }
  }
}

async function normalizeDecodedImage(uri: string): Promise<string> {
  const decoded = await Image.loadAsync({ uri }, { maxWidth: 2048, maxHeight: 2048 });
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let rendered: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | undefined;
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new Error('图片尺寸无效');
    try {
      context = ImageManipulator.manipulate(decoded);
    } catch {
      // Android's animated Drawables cannot be passed as Bitmap refs. Its URI
      // loader extracts a static frame for formats supported by that decoder.
      context = ImageManipulator.manipulate(uri);
    }
    const scale = Math.min(1, 2048 / Math.max(decoded.width, decoded.height));
    context.resize({ width: Math.max(1, Math.round(decoded.width * scale)), height: Math.max(1, Math.round(decoded.height * scale)) });
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.PNG });
    return result.uri;
  } finally {
    rendered?.release();
    context?.release();
    decoded.release();
  }
}
