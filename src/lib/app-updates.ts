import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { compareVersions, parseRelease, RELEASE_API, type AppRelease } from './app-update-release';

export const installedVersion = Application.nativeApplicationVersion;
export const installedBuild = Number(Application.nativeBuildVersion);
const KEY = 'zcpocket.app-updates.v1';
const INTERVAL = 6 * 60 * 60 * 1000;
type State = { automatic: boolean; checking: boolean; message: string; release: AppRelease | null; checkedAt: number };
export const useAppUpdates = create<State>(() => ({ automatic: true, checking: false, message: '尚未检查更新', release: null, checkedAt: 0 }));
let nextCheck = 0;
let pending: Promise<void> | null = null;
let hydration: Promise<void> | null = null;
let writes = Promise.resolve();
function persist() {
  const { automatic, checkedAt, release } = useAppUpdates.getState();
  const value = JSON.stringify({ automatic, checkedAt, nextCheck, release });
  writes = writes.then(() => AsyncStorage.setItem(KEY, value)).catch(() => {
    useAppUpdates.setState({ message: '更新偏好保存失败，重启后可能恢复默认设置' });
  });
}
function hydrate() {
  return hydration ??= AsyncStorage.getItem(KEY).then((raw) => {
    if (!raw) return;
    const value = JSON.parse(raw);
    const now = Date.now();
    nextCheck = Number.isFinite(value.nextCheck) ? Math.min(Math.max(0, value.nextCheck), now + INTERVAL) : 0;
    useAppUpdates.setState({ automatic: value.automatic !== false, checkedAt: Number.isFinite(value.checkedAt) ? Math.min(value.checkedAt, now) : 0 });
    if (value.release && installedVersion) {
      const cached = value.release;
      const name = `zcodepocket-${cached.version}-${cached.build}-arm64-v8a.apk`;
      const release = parseRelease({ draft: false, prerelease: false, tag_name: `v${cached.version}`, body: cached.notes, assets: [{ name, state: 'uploaded', size: 1, browser_download_url: cached.url }] });
      if (compareVersions(release.version, installedVersion) >= 0 && release.build > installedBuild) useAppUpdates.setState({ release, message: `发现新版本 ${release.version} (${release.build}) · 上次检查结果` });
    }
  }).catch(() => {});
}
export async function setAutomaticUpdates(automatic: boolean) {
  await hydrate();
  useAppUpdates.setState({ automatic });
  persist();
  if (automatic) void checkAppUpdate();
}
export function checkAppUpdate(manual = false): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    await hydrate();
    if (Platform.OS !== 'android' || !installedVersion || !installedBuild) {
      useAppUpdates.setState({ message: '请在已安装的 Android 应用中检查更新' });
      return;
    }
    if (!manual && (!useAppUpdates.getState().automatic || Date.now() < nextCheck)) return;
    useAppUpdates.setState({ checking: true, message: '正在检查 GitHub Releases…' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    // Persist the attempt too: failures must not trigger a request on every foreground event.
    nextCheck = Date.now() + INTERVAL;
    persist();
    try {
      const response = await fetch(RELEASE_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
      if (response.status === 404) throw new Error('尚无可访问的公开正式版本，请稍后重试');
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时限制访问，请稍后重试');
      if (!response.ok) throw new Error(`更新服务暂不可用（${response.status}），请稍后重试`);
      const release = parseRelease(await response.json());
      const comparison = compareVersions(release.version, installedVersion);
      const newer = comparison >= 0 && release.build > installedBuild;
      if (comparison > 0 && !newer) throw new Error('新版构建号未递增，暂不能覆盖安装');
      useAppUpdates.setState({ release: newer ? release : null, checkedAt: Date.now(), message: newer ? `发现新版本 ${release.version} (${release.build})` : '当前已是最新版本' });
    } catch (error) {
      useAppUpdates.setState({ message: error instanceof Error && error.name !== 'AbortError' ? error.message : '检查超时，请检查网络后重试' });
    } finally {
      clearTimeout(timer);
      useAppUpdates.setState({ checking: false });
      persist();
    }
  })().finally(() => { pending = null; });
  return pending;
}
export function initializeAppUpdates() {
  void checkAppUpdate();
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void checkAppUpdate(); });
  return () => subscription.remove();
}
