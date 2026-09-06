export const DEFAULT_MODEL_ID = 'glm-5.3-flash';

type ProviderLike = {
  providerId: string;
  label?: string;
  models: { modelId: string; label?: string }[];
};

export type PreferredModel = { providerId: string; modelId: string; label: string };

export function pickPreferredModel(providers: ProviderLike[]): PreferredModel | null {
  const candidates = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.providerId,
      modelId: model.modelId,
      label: model.label ?? model.modelId,
      providerLabel: provider.label ?? provider.providerId,
    })),
  );
  const exact = candidates
    .filter((item) => item.modelId.toLowerCase() === DEFAULT_MODEL_ID)
    .sort((a, b) => Number(b.providerId.includes('coding-plan')) - Number(a.providerId.includes('coding-plan')))[0];
  const selected = exact ?? candidates[0];
  return selected ? { providerId: selected.providerId, modelId: selected.modelId, label: selected.label } : null;
}
