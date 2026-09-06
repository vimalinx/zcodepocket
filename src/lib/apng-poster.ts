const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// APNG always includes an ordinary PNG default image in IDAT. Removing only
// animation chunks exposes that poster without decompressing or altering pixels.
// It need not be the animation's first frame. Keep all retained chunks and CRCs.
export function apngPoster(bytes: Uint8Array): Uint8Array | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept = [bytes.subarray(0, 8)];
  let animated = false, header = false, data = false, end = false, length = 8;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error('PNG 数据不完整');
    const size = view.getUint32(offset), next = offset + size + 12;
    if (next > bytes.length) throw new Error('PNG 数据不完整');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!header && (type !== 'IHDR' || size !== 13)) throw new Error('PNG 头信息无效');
    header = true;
    if (type === 'acTL') animated = true;
    if (type === 'IDAT') data = true;
    if (!['acTL', 'fcTL', 'fdAT'].includes(type)) { kept.push(bytes.subarray(offset, next)); length += next - offset; }
    if (type === 'IEND') { if (size !== 0) throw new Error('PNG 结束信息无效'); end = true; break; }
    offset = next;
  }
  if (!data || !end) throw new Error('PNG 缺少图像数据');
  if (!animated) return null;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of kept) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
