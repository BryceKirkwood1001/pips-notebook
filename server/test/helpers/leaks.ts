/** Recursive scan for keys that must never reach a client (SPEC 4.3). Returns the path of each hit. */
export const FORBIDDEN_KEYS = [
  'hidden', 'misconceptionId', 'misconceptionIds', 'correctIndex', 'correctIndexes', 'correctValue',
  'acceptedAnswers', 'wrongAnswers', 'wrongOrders', 'correctOrder', 'wrongMisconceptionId', 'solution',
  'workedSteps', 'rubric', 'modelAnswer', 'targetedMap', 'rngSeed', 'rngState', 'embedding', 'keyPoints',
  'misconceptions', 'materialItems',
] as const;

export function findHiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findHiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...((FORBIDDEN_KEYS as readonly string[]).includes(k) ? [`${path}.${k}`] : []),
      ...findHiddenKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}
