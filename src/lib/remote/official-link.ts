import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

export const RELAY_URL = 'wss://zcode.z.ai/ws';
export type OfficialLink = {
  sid: string;
  passHash: string;
  timestamp: number;
  mid?: string;
  name?: string;
  appVersion?: string;
};

// The QR is a credential. Never include it (or parse errors containing it) in logs.
export function parseOfficialLink(raw: string): OfficialLink {
  const invalid = () => new Error('官方配对链接无效，请重新扫描电脑上的 remote/v4 二维码');
  if (raw.length > 4096) throw invalid();
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw invalid(); }
  if (url.origin !== 'https://zcode.z.ai' || !/^\/remote\/v4\/?$/.test(url.pathname) || url.username || url.password) throw invalid();
  const get = (key: string) => {
    if (url.searchParams.getAll(key).length > 1) throw invalid();
    const value = url.searchParams.get(key)?.trim();
    if (value && (value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value))) throw invalid();
    return value || undefined;
  };
  const sid = get('sid'), passHash = get('hash'), time = get('t');
  if (!sid || !passHash || !time || !Number.isFinite(Number(time))) throw invalid();
  return { sid, passHash, timestamp: Number(time), mid: get('mid'), name: get('name'), appVersion: get('app_version') };
}

export function isOfficialLink(raw: string): boolean {
  try { parseOfficialLink(raw); return true; } catch { return false; }
}

export function relayProof(link: OfficialLink, nonce: string): string {
  if (!nonce || nonce.length > 4096) throw new Error('官方中转服务返回了无效的鉴权挑战');
  return Buffer.from(hmac(sha256, Buffer.from(link.passHash, 'utf8'), Buffer.from(`${nonce}|terminal|${link.sid}`, 'utf8')))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
