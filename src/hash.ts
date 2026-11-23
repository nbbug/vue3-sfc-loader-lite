/**
 * Small deterministic string hashing helpers. They are used for scope IDs and
 * compiled-cache keys; cryptographic strength is not required.
 */

/** FNV-1a 32-bit. */
function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Hash any number of values into a 16-character hex string.
 */
export function hash(...values: any[]): string {
  const input = values.map((value) => String(value)).join('\u0000')
  return fnv1a32(input, 0x811c9dc5) + fnv1a32(input, 0x9e3779b9)
}

const scopeIds = new Map<string, string>()

/**
 * Build a stable `data-v-xxxxxxxx` scope ID for a filename. Collisions are
 * extremely unlikely but handled by extending the hash.
 */
export function buildScopeId(filename: string): string {
  let scopeId = `data-v-${hash(filename).slice(0, 8)}`
  let salt = 0
  while (scopeIds.has(scopeId) && scopeIds.get(scopeId) !== filename) {
    salt++
    scopeId = `data-v-${hash(filename, salt).slice(0, 8)}`
  }
  scopeIds.set(scopeId, filename)
  return scopeId
}
