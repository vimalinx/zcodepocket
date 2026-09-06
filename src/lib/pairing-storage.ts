import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { parseOfficialLink } from './remote/official-link';

const KEY = 'zcpocket.officialPairing.v1';
const LEGACY_URL = 'zcpocket.officialRemoteUrl';
const LEGACY_GATEWAY = ['zcpocket.host', 'zcpocket.token'];
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function savePairing(raw: string) {
  parseOfficialLink(raw);
  await SecureStore.setItemAsync(KEY, raw.trim(), options);
  await AsyncStorage.multiRemove([...LEGACY_GATEWAY, LEGACY_URL]);
}

export async function loadPairing(): Promise<string | null> {
  // Never revive the removed LAN transport from an older installation.
  await AsyncStorage.multiRemove(LEGACY_GATEWAY);
  const secured = await SecureStore.getItemAsync(KEY, options);
  if (secured) {
    try { parseOfficialLink(secured); }
    catch { await SecureStore.deleteItemAsync(KEY, options); await AsyncStorage.removeItem(LEGACY_URL); return null; }
    await AsyncStorage.removeItem(LEGACY_URL);
    return secured;
  }
  const legacy = await AsyncStorage.getItem(LEGACY_URL);
  if (!legacy) return null;
  try { parseOfficialLink(legacy); }
  catch { await AsyncStorage.removeItem(LEGACY_URL); return null; }
  // Remove the legacy link only after its secure replacement is durable.
  await savePairing(legacy);
  return legacy;
}

export async function deletePairing() {
  await SecureStore.deleteItemAsync(KEY, options);
  await AsyncStorage.multiRemove([...LEGACY_GATEWAY, LEGACY_URL]);
}

export function pairingDeviceName(raw: string) { return parseOfficialLink(raw).name || 'ZCode 电脑'; }
