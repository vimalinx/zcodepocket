import { remoteClient } from './remote-client';
import { pickPreferredModel } from './models';
import type { ProviderInfo } from '@/store/app';

export async function createSessionInWorkspace(workspacePath: string, providers: ProviderInfo[]) {
  if (!workspacePath.trim()) throw new Error('请选择工作区');
  const params: Record<string, unknown> = { workspacePath };
  const model = pickPreferredModel(providers);
  if (model) params.model = { providerId: model.providerId, modelId: model.modelId };
  // This operation creates remote state. Send once; never retry an unknown result.
  const result = await remoteClient.request<{ session?: { sessionId?: string; title?: string } }>('gw.create', params);
  if (!result.session?.sessionId) throw new Error('未收到新会话标识，请先刷新列表确认是否已经创建');
  return { id: result.session.sessionId, title: result.session.title ?? '新会话', workspacePath };
}
