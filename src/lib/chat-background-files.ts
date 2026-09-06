import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { normalizeBackgroundImage } from './normalize-background-image';
import { DEFAULT_CHAT_BACKGROUND, useApp } from '@/store/app';

let fileChanges: Promise<void> = Promise.resolve();

function removeOwnedBackground(uri: string | null) {
  if (!uri) return;
  const directory = Paths.document.uri.replace(/\/?$/, '/');
  if (!uri.startsWith(directory) || !/^zcpocket-chat-background(?:-[0-9a-f-]+)?\.[a-z0-9]+$/i.test(uri.slice(directory.length))) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cleanup must not turn an already-saved replacement into a failed operation.
    // Never delete the user's picker source or other documents in this directory.
  }
}

export function changeBackgroundImage(sourceUri: string | null, reset = false): Promise<void> {
  const change = fileChanges.then(async () => {
    const previous = useApp.getState().chatBackground.uri;
    let replacement: string | null = null;
    let normalizedUri: string | null = null;
    try {
      if (sourceUri) {
        try {
          normalizedUri = await normalizeBackgroundImage(sourceUri);
        } catch (error) {
          const detail = error instanceof Error ? error.message.replace(/(?:file|content):\/\/\S+/g, '[本地文件]').slice(0, 300) : '未知错误';
          throw new Error(`图片导入失败，原背景未更改。\n具体原因：${detail}`);
        }
        const source = new File(normalizedUri);
        // A new URI invalidates both the native loaded-source identity and cache.
        // Do not overwrite the currently displayed image, even for the same type.
        const destination = new File(Paths.document, `zcpocket-chat-background-${randomUUID()}.png`);
        replacement = destination.uri;
        await source.copy(destination);
        if (!destination.exists || destination.size <= 0 || (source.size > 0 && destination.size !== source.size)) {
          throw new Error('新照片未完整保存，请重新选择。原背景未更改。');
        }
        // A successful copy does not prove the image decoder can display it.
        // Validate the saved destination, not the temporary picker URI, before commit/cleanup.
        try {
          const decoded = await Image.loadAsync({ uri: replacement }, { maxWidth: 2048, maxHeight: 2048 });
          try {
            if (!(decoded.width > 0 && decoded.height > 0)) throw new Error('empty image');
          } finally {
            decoded.release();
          }
        } catch {
          throw new Error('转换后的背景无法加载，请重新选择图片。原背景未更改。');
        }
      }
      await useApp.getState().setChatBackground(reset ? DEFAULT_CHAT_BACKGROUND : { uri: replacement });
    } catch (error) {
      removeOwnedBackground(replacement);
      throw error;
    } finally {
      // Only remove the converter's cache output, never the selected source.
      if (normalizedUri && normalizedUri !== sourceUri && normalizedUri.startsWith(Paths.cache.uri)) {
        try { const temporary = new File(normalizedUri); if (temporary.exists) temporary.delete(); } catch { /* best-effort cache cleanup */ }
      }
    }
    if (previous !== replacement) removeOwnedBackground(previous);
  });
  fileChanges = change.catch(() => {});
  return change;
}
