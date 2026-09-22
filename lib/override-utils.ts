import type { Risk } from '@/types/risk'

const protectedKeys = new Set(['_id', 'id', 'risk_id', 'card_id', 'created_at', 'updated_at'])
const unchanged = Symbol('unchanged')

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => valuesEqual(item, right[index]))
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]))
  }
  return false
}

function diffValue(base: unknown, edited: unknown): unknown | typeof unchanged {
  if (Array.isArray(edited)) {
    return Array.isArray(base) && valuesEqual(base, edited) ? unchanged : cloneValue(edited)
  }

  if (isPlainObject(edited)) {
    if (!isPlainObject(base)) return cloneValue(edited)
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(edited)) {
      const child = diffValue(base[key], value)
      if (child !== unchanged) result[key] = child
    }
    return Object.keys(result).length ? result : unchanged
  }

  return valuesEqual(base, edited) ? unchanged : cloneValue(edited)
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item))
  if (!isPlainObject(value)) return cloneValue(value)

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (protectedKeys.has(key)) continue
    result[key] = sanitizeValue(child)
  }
  return result
}

function pruneEmptyObjects(value: unknown): unknown | typeof unchanged {
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const pruned = pruneEmptyObjects(child)
    if (pruned !== unchanged) result[key] = pruned
  }
  return Object.keys(result).length ? result : unchanged
}

function mergeForEditor(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return cloneValue(override)
  const result: Record<string, unknown> = cloneValue(base)
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeForEditor(result[key], value)
      : cloneValue(value)
  }
  return result
}

export function buildPartialOverride(base: Risk, edited: Risk): Record<string, unknown> {
  const difference = diffValue(base, edited)
  if (difference === unchanged) return {}
  const sanitized = sanitizeValue(difference)
  const pruned = pruneEmptyObjects(sanitized)
  return pruned === unchanged || !isPlainObject(pruned) ? {} : pruned
}

export function buildCompleteOverride(edited: Risk): Record<string, unknown> {
  return sanitizeValue(edited) as Record<string, unknown>
}

export function hydrateOverrideDraft(base: Risk, overrides: Record<string, unknown>): Risk {
  const safeOverrides = sanitizeValue(overrides) as Record<string, unknown>
  const hydrated = mergeForEditor(base, safeOverrides) as Risk
  hydrated.risk_id = base.risk_id
  hydrated.card_id = base.card_id
  hydrated.created_at = base.created_at
  hydrated.updated_at = base.updated_at
  hydrated.sender = { ...hydrated.sender, risk_id: base.risk_id }
  return hydrated
}

export function createBlankCustomizationDraft(base: Risk): Risk {
  return {
    schema_version: 2,
    risk_id: base.risk_id,
    card_id: base.card_id,
    industry_slug: '',
    industry_name: '',
    title: '',
    severity: base.severity || 'medium',
    severity_label: base.severity_label || base.severity || 'Medium',
    subtitle: '',
    summary: '',
    sender: { name: '', source: '', risk_id: base.risk_id, timestamp: '' },
    entity: { type: '', id: '', name: '' },
    views: {
      notification: { blocks: [] },
      details: { title: '', subtitle: '', action_label: '', blocks: [] },
      mitigation: { title: '', subtitle: '', action_label: '', blocks: [] },
    },
    metadata: {},
    is_active: true,
    status: 'active',
    created_at: base.created_at,
    updated_at: base.updated_at,
  }
}
