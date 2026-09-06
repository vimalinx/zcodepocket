import { remoteClient } from './remote-client';
import { parseOfficialLink } from './remote/official-link';

export { isOfficialLink as isOfficialRemoteUrl } from './remote/official-link';

export async function pairFromOfficialUrl(raw: string, actions: {
  pair: (url: string) => Promise<void>;
  onProgress?: (message: string) => void;
}) {
  parseOfficialLink(raw);
  const remove = remoteClient.onDetail(message => actions.onProgress?.(message));
  try { await actions.pair(raw.trim()); } finally { remove(); }
}
