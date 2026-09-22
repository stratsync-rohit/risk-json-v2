import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  deleteOverride,
  fetchClients,
  fetchDestinationOverrides,
  fetchDestinations,
  fetchOverride,
  fetchResolvedRisk,
  fetchRisk,
  fetchRisks,
  saveOverride,
} from '@/lib/api'

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : status >= 400 ? 'Error' : 'OK',
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response
}

describe('destination customization API', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/')
  })

  test('normalizes wrapped client and risk list responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        success: true,
        data: [
          { id: '6ab0df48a298078cf9cfd78c', name: 'ROHIT Test', code: 'ROH-001', is_active: true },
          { id: '6ab0973c1e1ceec9758150cc', name: 'Stratsync Risk', code: 'STR-001', is_active: true },
          { id: '6aacdb50f4171f80589ac25e', name: '18/9 test', code: '189-001', is_active: true },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ risk_id: 'R-1', title: 'Risk', severity: 'high' }] })))

    await expect(fetchClients()).resolves.toEqual([
      { id: '6ab0df48a298078cf9cfd78c', name: 'ROHIT Test' },
      { id: '6ab0973c1e1ceec9758150cc', name: 'Stratsync Risk' },
      { id: '6aacdb50f4171f80589ac25e', name: '18/9 test' },
    ])
    await expect(fetchRisks()).resolves.toEqual([{ risk_id: 'R-1', title: 'Risk', severity: 'high' }])
  })

  test('unwraps a single risk data envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true,
      data: { risk_id: 'RSK/ONE', title: 'Wrapped risk' },
    })))

    await expect(fetchRisk('RSK/ONE')).resolves.toEqual({ risk_id: 'RSK/ONE', title: 'Wrapped risk' })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.example.test/api/risks/RSK%2FONE')
  })

  test('returns only safe destination metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{
        destination_id: 'd-1', client_id: 'c-1', platform: 'teams', member_name: 'Owner',
        team_name: 'Management', channel_name: 'Risk', is_active: true,
        webhook_url: 'https://secret.example.test/hook',
      }],
    })))

    await expect(fetchDestinations('c-1')).resolves.toEqual([{
      destination_id: 'd-1', client_id: 'c-1', platform: 'teams', member_name: 'Owner',
      team_name: 'Management', channel_name: 'Risk', is_active: true,
    }])
  })

  test('strips unexpected fields from active override summaries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{
        destination_id: 'd-1', platform: 'slack', member_name: 'Owner',
        workspace_domain: 'stratsync', channel_name: 'risk', is_active: true,
        webhook_url: 'https://secret.example.test/hook', client_id: 'c-1',
      }],
    })))

    await expect(fetchDestinationOverrides('R-1')).resolves.toEqual([{
      destination_id: 'd-1', platform: 'slack', member_name: 'Owner',
      workspace_domain: 'stratsync', channel_name: 'risk', is_active: true,
    }])
  })

  test('treats an empty destination override envelope as a valid empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true,
      data: [],
      count: 0,
    })))

    await expect(fetchDestinationOverrides('RSK-SPVC-YUXR')).resolves.toEqual([])
  })

  test('keeps an override summary when destination metadata is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{ destination_id: 'd-unknown', is_active: true, webhook_url: 'https://secret.example.test/hook' }],
    })))

    await expect(fetchDestinationOverrides('R-1')).resolves.toEqual([{
      destination_id: 'd-unknown', member_name: '', channel_name: '', is_active: true,
    }])
  })

  test('treats only override 404 as no existing override', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(404, { detail: 'missing' })))
    await expect(fetchOverride('R-1', 'D-1')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(500, { detail: 'down' })))
    await expect(fetchOverride('R-1', 'D-1')).rejects.toMatchObject({ status: 500 })
  })

  test('unwraps override and resolved data envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: { overrides: { summary: 'Custom' }, is_active: true } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        success: true,
        data: { risk_id: 'R-1', destination_id: 'D-1', has_override: true, risk: { risk_id: 'R-1', title: 'Resolved' } },
      })))

    await expect(fetchOverride('R-1', 'D-1')).resolves.toEqual({ overrides: { summary: 'Custom' }, is_active: true })
    await expect(fetchResolvedRisk('R-1', 'D-1')).resolves.toEqual({
      risk_id: 'R-1', destination_id: 'D-1', has_override: true, risk: { risk_id: 'R-1', title: 'Resolved' },
    })
  })

  test('encodes IDs and rejects unsuccessful save and reset requests', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(422, { detail: 'invalid' }))
      .mockResolvedValueOnce(jsonResponse(500, { detail: 'down' })))

    await expect(saveOverride('R/1', 'D 1', { overrides: { summary: 'Custom' }, is_active: true }))
      .rejects.toMatchObject({ status: 422 })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.example.test/api/risks/R%2F1/destinations/D%201/override')

    await expect(deleteOverride('R/1', 'D 1')).rejects.toMatchObject({ status: 500 })
  })
})
