'use client'

const getBaseUrl = () => process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')

function requireBaseUrl() {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new Error('Risk API URL is not configured (NEXT_PUBLIC_API_URL)')
  return baseUrl
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function checkedFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options?.headers,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ApiError(response.status, `${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return response
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await checkedFetch(url, options)
  return response.json() as Promise<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrapData<T>(payload: unknown): T {
  if (isRecord(payload) && 'data' in payload) return payload.data as T
  return payload as T
}

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.data)) return payload.data as T[]
  if (Array.isArray(payload.risks)) return payload.risks as T[]
  return []
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export interface Client {
  id: string
  name: string
}

export async function fetchClients(): Promise<Client[]> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/clients`)
  return unwrapList<Record<string, unknown>>(payload).map(client => ({
    id: stringValue(client.id),
    name: stringValue(client.name || client.client_name),
  })).filter(client => client.id)
}

export type Platform = 'teams' | 'slack'

export interface Destination {
  destination_id: string
  client_id: string
  platform: Platform
  member_name: string
  is_active: boolean
  team_name?: string
  channel_name?: string
  workspace_domain?: string
}

export async function fetchDestinations(clientId: string): Promise<Destination[]> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/clients/${encodeURIComponent(clientId)}/destinations`)
  return unwrapList<Record<string, unknown>>(payload).flatMap(destination => {
    const platform = stringValue(destination.platform).toLowerCase()
    if (platform !== 'teams' && platform !== 'slack') return []
    return [{
      destination_id: stringValue(destination.destination_id),
      client_id: stringValue(destination.client_id),
      platform,
      member_name: stringValue(destination.member_name),
      is_active: destination.is_active !== false,
      ...(platform === 'teams' ? { team_name: stringValue(destination.team_name) } : {}),
      channel_name: stringValue(destination.channel_name),
      ...(platform === 'slack' ? { workspace_domain: stringValue(destination.workspace_domain) } : {}),
    } satisfies Destination]
  }).filter(destination => destination.destination_id)
}

export interface RiskListItem {
  risk_id: string
  title: string
  severity: string
  severity_label?: string
  industry_name?: string
  industry_slug?: string
  status?: string
  is_active?: boolean
  sku?: string
  product?: string
  _id?: unknown
  created_at?: unknown
  updated_at?: unknown
}

export async function fetchRisks(): Promise<RiskListItem[]> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/risks`)
  return unwrapList<RiskListItem>(payload).filter(item => isRecord(item))
}

export async function fetchRisk(riskId: string): Promise<Record<string, unknown>> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}`)
  return unwrapData<Record<string, unknown>>(payload)
}

export interface OverrideResponse {
  overrides: Record<string, unknown>
  is_active: boolean
}

export async function fetchOverride(riskId: string, destinationId: string): Promise<OverrideResponse | null> {
  const url = `${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}/destinations/${encodeURIComponent(destinationId)}/override`
  try {
    const payload = await fetchJson<unknown>(url)
    return unwrapData<OverrideResponse>(payload)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export interface SaveOverridePayload {
  overrides: Record<string, unknown>
  is_active: boolean
}

export async function saveOverride(riskId: string, destinationId: string, payload: SaveOverridePayload): Promise<void> {
  await checkedFetch(`${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}/destinations/${encodeURIComponent(destinationId)}/override`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteOverride(riskId: string, destinationId: string): Promise<void> {
  await checkedFetch(`${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}/destinations/${encodeURIComponent(destinationId)}/override`, {
    method: 'DELETE',
  })
}

export interface DestinationOverrideSummary {
  destination_id: string
  platform?: Platform
  member_name: string
  team_name?: string
  channel_name?: string
  workspace_domain?: string
  is_active: boolean
}

export async function fetchDestinationOverrides(riskId: string): Promise<DestinationOverrideSummary[]> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}/destination-overrides`)
  return unwrapList<Record<string, unknown>>(payload).flatMap(summary => {
    const rawPlatform = stringValue(summary.platform).toLowerCase()
    const platform = rawPlatform === 'teams' || rawPlatform === 'slack' ? rawPlatform : undefined
    const safeSummary: DestinationOverrideSummary = {
      destination_id: stringValue(summary.destination_id),
      member_name: stringValue(summary.member_name),
      channel_name: stringValue(summary.channel_name),
      is_active: summary.is_active !== false,
      ...(platform ? { platform } : {}),
      ...(platform === 'teams' ? { team_name: stringValue(summary.team_name) } : {}),
      ...(platform === 'slack' ? { workspace_domain: stringValue(summary.workspace_domain) } : {}),
    }
    return safeSummary.destination_id ? [safeSummary] : []
  })
}

export interface ResolvedRiskResponse {
  risk_id: string
  destination_id: string
  has_override: boolean
  risk: Record<string, unknown>
}

export async function fetchResolvedRisk(riskId: string, destinationId: string): Promise<ResolvedRiskResponse> {
  const payload = await fetchJson<unknown>(`${requireBaseUrl()}/api/risks/${encodeURIComponent(riskId)}/destinations/${encodeURIComponent(destinationId)}/resolved`)
  return unwrapData<ResolvedRiskResponse>(payload)
}
