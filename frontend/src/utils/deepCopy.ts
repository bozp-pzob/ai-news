/**
 * Deep copy utility for config objects.
 * Properly handles nested objects, arrays, null, and undefined values.
 * Avoids JSON.parse/stringify to handle edge cases with undefined values.
 */
export function deepCopy<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item)) as T;
  }

  if (typeof obj === 'object') {
    const copy = {} as Record<string, unknown>;
    for (const key in obj) {
      copy[key] = deepCopy((obj as Record<string, unknown>)[key]);
    }
    return copy as T;
  }

  return obj;
}
