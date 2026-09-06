export const RELEASE_API = 'https://api.github.com/repos/vimalinx/zcodepocket/releases/latest';
export type AppRelease = { version: string; build: number; url: string; notes: string };

function parts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('版本格式无效');
  const result = version.split('.').map(Number);
  if (!result.every(Number.isSafeInteger)) throw new Error('版本格式无效');
  return result;
}

export function compareVersions(left: string, right: string): number {
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

// A single versioned arm64 APK is the release contract. Never follow a URL from release prose.
export function parseRelease(value: unknown): AppRelease {
  const release = value as Record<string, unknown> | null;
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') throw new Error('发布信息无效');
  if (!release.tag_name.startsWith('v')) throw new Error('正式版本标签必须以 v 开头');
  const version = release.tag_name.replace(/^v/, '');
  parts(version);
  if (!Array.isArray(release.assets)) throw new Error('发布尚未包含安装包');
  const matches = release.assets.filter((asset) => {
    if (!asset || typeof asset.name !== 'string') return false;
    const match = /^zcodepocket-(\d+\.\d+\.\d+)-(\d+)-arm64-v8a\.apk$/.exec(asset.name);
    return match && match[1] === version;
  });
  if (matches.length !== 1) throw new Error('发布安装包缺失或不唯一，请稍后重试');
  const asset = matches[0];
  const build = Number(asset.name.split('-')[2]);
  if (!Number.isSafeInteger(build) || build < 1 || build > 2100000000 || asset.state !== 'uploaded' || !(asset.size > 0)) throw new Error('安装包信息无效');
  const expected = `https://github.com/vimalinx/zcodepocket/releases/download/${release.tag_name}/${asset.name}`;
  if (asset.browser_download_url !== expected) throw new Error('安装包来源不符合更新配置');
  return { version, build, url: expected, notes: typeof release.body === 'string' ? release.body.slice(0, 2000) : '' };
}
