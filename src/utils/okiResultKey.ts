export interface OkiResultKeyParams {
  prefixName: string;
  prefixFrames: number;
  prefixInput?: string;
  moveName: string;
  moveInput: string;
  ourActiveStart: number;
  ourActiveEnd: number;
}

export function buildOkiResultKeyBase(params: OkiResultKeyParams): string {
  return `${params.prefixName}|${params.prefixFrames}|${params.prefixInput ?? ''}|${params.moveName}|${params.moveInput}|${params.ourActiveStart}|${params.ourActiveEnd}`;
}

export function getUniqueOkiResultKey(baseKey: string, keyCounts: Map<string, number>): string {
  const count = keyCounts.get(baseKey) ?? 0;
  keyCounts.set(baseKey, count + 1);
  return count === 0 ? baseKey : `${baseKey}|dup${count + 1}`;
}

