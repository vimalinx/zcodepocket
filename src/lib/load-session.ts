import { remoteClient } from './remote-client';
import { checkCancelled } from './remote/cancellation';
import type { SessionRead } from '@/store/app';

// One focus lifetime, one read for both history and settings. Cancellation never
// pretends to undo a request already sent; it prevents all following operations.
export async function loadSession(sessionId: string, signal: AbortSignal): Promise<SessionRead> {
  const options = { signal };
  checkCancelled(signal);
  await remoteClient.request('session/resume', { sessionId }, options);
  checkCancelled(signal);
  await remoteClient.request('session/subscribe', { sessionId, deliveryKind: 'web-remote-replayable' }, options);
  checkCancelled(signal);
  const detail = await remoteClient.request<SessionRead>('session/read', { sessionId }, options);
  checkCancelled(signal);
  return detail;
}
