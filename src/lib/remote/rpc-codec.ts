import { Buffer } from 'buffer';

const MAX_BYTES = 16 * 1024 * 1024;
const BINARY_TAG = '__zcode_rpc_nested_uint8array_v1';

// Channel RPC wire values: undefined, UTF-8, bytes, VSBuffer, array, JSON, int32.
// This is the channel payload, WITHOUT the desktop's 13-byte socket header.
export function encodeRpc(header: unknown[], body: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (bytes: Uint8Array) => {
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error('RPC 消息过大');
    chunks.push(bytes);
  };
  const number = (value: number) => {
    let rest = value >>> 0;
    const bytes: number[] = [];
    do { const next = rest & 127; rest >>>= 7; bytes.push(next | (rest ? 128 : 0)); } while (rest);
    push(Uint8Array.from(bytes));
  };
  const write = (value: unknown, depth = 0): void => {
    if (depth > 64) throw new Error('RPC 嵌套过深');
    if (value === undefined) { push(Uint8Array.of(0)); return; }
    if (typeof value === 'number' && (value | 0) === value) { push(Uint8Array.of(6)); number(value); return; }
    if (Array.isArray(value)) {
      push(Uint8Array.of(4)); number(value.length);
      for (const item of value) write(item, depth + 1);
      return;
    }
    let tag: number, bytes: Uint8Array;
    if (typeof value === 'string') { tag = 1; bytes = Buffer.from(value, 'utf8'); }
    else if (value instanceof Uint8Array) { tag = 2; bytes = value; }
    else {
      tag = 5;
      bytes = Buffer.from(JSON.stringify(value, (_key, item) => item instanceof Uint8Array
        ? { [BINARY_TAG]: true, base64: Buffer.from(item).toString('base64') } : item), 'utf8');
    }
    push(Uint8Array.of(tag)); number(bytes.length); push(bytes);
  };
  write(header); write(body);
  return Buffer.concat(chunks, total);
}

export function decodeRpc(bytes: Uint8Array): { header: unknown[]; body: unknown } {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('RPC 长度无效');
  let offset = 0, values = 0;
  const take = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('RPC 数据不完整');
    const part = bytes.subarray(offset, offset + length); offset += length; return part;
  };
  const number = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const next = take(1)[0];
      if (shift === 28 && (next & 240)) throw new Error('RPC 整数溢出');
      value |= (next & 127) << shift;
      if (!(next & 128)) return value;
    }
    throw new Error('RPC 整数无效');
  };
  const read = (depth = 0): unknown => {
    if (depth > 64 || ++values > MAX_BYTES) throw new Error('RPC 嵌套过深');
    const tag = take(1)[0];
    if (tag === 0) return undefined;
    if (tag === 6) return number();
    const length = number();
    if (tag === 4) {
      if (length < 0 || length > bytes.length - offset) throw new Error('RPC 数组长度无效');
      return Array.from({ length }, () => read(depth + 1));
    }
    const data = take(length);
    if (tag === 2 || tag === 3) return Uint8Array.from(data);
    const text = Buffer.from(data).toString('utf8');
    if (tag === 1) return text;
    if (tag === 5) return JSON.parse(text, (_key, item) => item && item[BINARY_TAG] === true && typeof item.base64 === 'string' && Object.keys(item).length === 2
      ? Uint8Array.from(Buffer.from(item.base64, 'base64')) : item);
    throw new Error('未知 RPC 类型');
  };
  const header = read(), body = read();
  if (!Array.isArray(header) || offset !== bytes.length) throw new Error('RPC 帧格式无效');
  return { header, body };
}
