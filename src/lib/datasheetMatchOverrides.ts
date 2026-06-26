const STORAGE_PREFIX = 'oandm:datasheet-match-overrides:';

export interface DatasheetMatchOverride {
  datasheetId: number;
  productId: number | null;
}

export interface DatasheetMatchOverrideState {
  approved: Record<string, DatasheetMatchOverride>;
  dismissed: string[];
}

function storageKey(projectId: number): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function emptyState(): DatasheetMatchOverrideState {
  return { approved: {}, dismissed: [] };
}

export function loadDatasheetMatchOverrides(projectId: number): DatasheetMatchOverrideState {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<DatasheetMatchOverrideState>;
    return {
      approved: parsed.approved ?? {},
      dismissed: parsed.dismissed ?? [],
    };
  } catch {
    return emptyState();
  }
}

export function saveDatasheetMatchOverrides(
  projectId: number,
  state: DatasheetMatchOverrideState,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(projectId), JSON.stringify(state));
}

export function approveDatasheetMatchOverride(
  projectId: number,
  rowKey: string,
  override: DatasheetMatchOverride,
): DatasheetMatchOverrideState {
  const state = loadDatasheetMatchOverrides(projectId);
  state.approved[rowKey] = override;
  state.dismissed = state.dismissed.filter(key => key !== rowKey);
  saveDatasheetMatchOverrides(projectId, state);
  return state;
}

export function dismissDatasheetMatchSuggestions(
  projectId: number,
  rowKey: string,
): DatasheetMatchOverrideState {
  const state = loadDatasheetMatchOverrides(projectId);
  if (!state.dismissed.includes(rowKey)) {
    state.dismissed.push(rowKey);
  }
  delete state.approved[rowKey];
  saveDatasheetMatchOverrides(projectId, state);
  return state;
}
