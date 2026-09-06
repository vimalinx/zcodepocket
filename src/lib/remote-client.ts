import { randomUUID } from 'expo-crypto';
import { OfficialClient } from './remote/client';

export type { EngineEvent, EngineRequest, ConnectionStatus } from './remote/client';
export const remoteClient = new OfficialClient(randomUUID);
