import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CustomizeExistingRisk } from '@/components/risk-builder/customize-existing-risk'
import * as api from '@/lib/api'
import { sampleRisk } from '@/lib/risk-utils'
import type { Risk } from '@/types/risk'

vi.mock('@/lib/api', () => ({
  fetchClients: vi.fn(),
  fetchDestinations: vi.fn(),
  fetchRisks: vi.fn(),
  fetchRisk: vi.fn(),
  fetchOverride: vi.fn(),
  saveOverride: vi.fn(),
  deleteOverride: vi.fn(),
  fetchDestinationOverrides: vi.fn(),
  fetchResolvedRisk: vi.fn(),
}))

function baseRisk(): Risk {
  return {
    schema_version: 2,
    risk_id: 'RSK-1',
    industry_slug: 'distribution',
    industry_name: 'Distribution',
    title: 'Base Risk Title',
    severity: 'high',
    severity_label: 'High',
    subtitle: 'Base subtitle',
    summary: 'Base summary',
    sender: { name: 'StratSync', source: 'Monitor', risk_id: 'RSK-1', timestamp: 'Today' },
    entity: { type: 'sku', id: 'SKU-1', name: 'Product' },
    views: {
      notification: { blocks: [{ type: 'text', text: 'Base block' }] },
      details: { title: 'Details', action_label: 'View Details', blocks: [] },
      mitigation: { title: 'Mitigation', action_label: 'Mitigation', blocks: [] },
    },
    metadata: { currency: 'SGD' },
    is_active: true,
    status: 'active',
  }
}

const teamsDestination = {
  destination_id: 'teams-1', client_id: 'client-1', platform: 'teams' as const,
  member_name: 'Asha', team_name: 'Management', channel_name: 'Risk Desk', is_active: true,
}
const slackDestination = {
  destination_id: 'slack-1', client_id: 'client-1', platform: 'slack' as const,
  member_name: 'Ravi', workspace_domain: 'stratsync', channel_name: 'risk-alerts', is_active: true,
}

describe('CustomizeExistingRisk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchClients).mockResolvedValue([{ id: 'client-1', name: 'Acme' }])
    vi.mocked(api.fetchRisks).mockResolvedValue([{ risk_id: 'RSK-1', title: 'Base Risk Title', severity: 'high' }])
    vi.mocked(api.fetchRisk).mockResolvedValue(baseRisk() as unknown as Record<string, unknown>)
    vi.mocked(api.fetchDestinations).mockResolvedValue([teamsDestination, slackDestination])
    vi.mocked(api.fetchOverride).mockResolvedValue(null)
    vi.mocked(api.fetchDestinationOverrides).mockResolvedValue([])
    vi.mocked(api.fetchResolvedRisk).mockResolvedValue({
      risk_id: 'RSK-1', destination_id: 'teams-1', has_override: false,
      risk: { ...baseRisk(), title: 'Backend Resolved Title' },
    })
    vi.mocked(api.saveOverride).mockResolvedValue()
    vi.mocked(api.deleteOverride).mockResolvedValue()
  })

  test('enforces selection order and displays only safe Teams and Slack metadata', async () => {
    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    expect(screen.getByLabelText('Existing Risk')).toBeDisabled()
    expect(screen.getByLabelText('Destination')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Override' })).toBeDisabled()

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await waitFor(() => expect(api.fetchDestinations).toHaveBeenCalledWith('client-1'))
    await waitFor(() => expect(screen.getByLabelText('Existing Risk')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    await waitFor(() => expect(screen.getByLabelText('Destination')).toBeEnabled())

    expect(screen.getByRole('option', { name: /Teams · Asha · Management · Risk Desk/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Slack · Ravi · stratsync · risk-alerts/ })).toBeInTheDocument()
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument()
  })

  test('treats missing override as Save and submits changed arrays as replacements once', async () => {
    let releaseSave: (() => void) | undefined
    vi.mocked(api.saveOverride).mockImplementation(() => new Promise<void>(resolve => { releaseSave = resolve }))
    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    await waitFor(() => expect(screen.getByLabelText('Destination')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Destination'), 'teams-1')

    await screen.findByText('No active override')
    expect(screen.getByText('Backend Resolved Title')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Override JSON' }))
    fireEvent.change(screen.getByLabelText('Override JSON editor'), {
      target: { value: JSON.stringify({ ...baseRisk(), views: { ...baseRisk().views, notification: { blocks: [] } } }) },
    })
    await user.click(screen.getByRole('button', { name: 'Apply Override JSON' }))

    const save = screen.getByRole('button', { name: 'Save Override' })
    await user.click(save)
    await user.click(save)

    expect(api.saveOverride).toHaveBeenCalledTimes(1)
    expect(api.saveOverride).toHaveBeenCalledWith('RSK-1', 'teams-1', {
      overrides: { views: { notification: { blocks: [] } } },
      is_active: true,
    })
    expect(save).toBeDisabled()
    expect(screen.getByLabelText('Client')).toBeDisabled()
    expect(screen.getByLabelText('Existing Risk')).toBeDisabled()
    expect(screen.getByLabelText('Destination')).toBeDisabled()
    releaseSave?.()
    await waitFor(() => expect(api.fetchResolvedRisk).toHaveBeenCalledTimes(2))
  })

  test('ignores a stale risk response after the client changes', async () => {
    let releaseRisk: ((risk: Record<string, unknown>) => void) | undefined
    vi.mocked(api.fetchClients).mockResolvedValue([
      { id: 'client-1', name: 'Acme' },
      { id: 'client-2', name: 'Beta' },
    ])
    vi.mocked(api.fetchRisk).mockImplementation(() => new Promise(resolve => { releaseRisk = resolve }))
    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    await user.selectOptions(screen.getByLabelText('Client'), 'client-2')
    releaseRisk?.(baseRisk() as unknown as Record<string, unknown>)

    await waitFor(() => expect(screen.getByLabelText('Client')).toHaveValue('client-2'))
    expect(screen.getByLabelText('Existing Risk')).toHaveValue('')
    expect(screen.getByLabelText('Destination')).toBeDisabled()
    expect(screen.queryByText('Base Risk')).not.toBeInTheDocument()
  })

  test('loads an existing override for update and resets it after confirmation', async () => {
    vi.mocked(api.fetchOverride)
      .mockResolvedValueOnce({ overrides: { subtitle: 'Destination subtitle' }, is_active: true })
      .mockResolvedValueOnce(null)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    await waitFor(() => expect(screen.getByLabelText('Destination')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Destination'), 'teams-1')

    expect(await screen.findByText('Active override')).toBeInTheDocument()
    expect(screen.getByLabelText('Subtitle')).toHaveValue('Destination subtitle')
    expect(screen.getByRole('button', { name: 'Update Override' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Reset to Base' }))

    expect(confirm).toHaveBeenCalled()
    await waitFor(() => expect(api.deleteOverride).toHaveBeenCalledWith('RSK-1', 'teams-1'))
    await waitFor(() => expect(screen.getByText('No active override')).toBeInTheDocument())
  })

  test('selects an available destination from the active customization list', async () => {
    vi.mocked(api.fetchDestinationOverrides).mockResolvedValue([{
      destination_id: 'slack-1', platform: 'slack', member_name: 'Ravi',
      workspace_domain: 'stratsync', channel_name: 'risk-alerts', is_active: true,
    }])
    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')

    const shortcut = await screen.findByRole('button', { name: /Slack · Ravi · stratsync · risk-alerts/ })
    await user.click(shortcut)

    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveValue('slack-1'))
    expect(api.fetchOverride).toHaveBeenCalledWith('RSK-1', 'slack-1')
  })

  test('loads a builder-created full Risk V2 with empty destination overrides', async () => {
    const builderRisk = structuredClone(sampleRisk)
    builderRisk.risk_id = 'RSK-SPVC-YUXR'
    builderRisk.title = 'INVENTORY REVENUE EXPOSURE'
    builderRisk.views = {
      notification: { blocks: [
        { type: 'callout', text: 'Revenue exposure' },
        { type: 'key_value', items: [{ label: 'SKU', value: '21132' }] },
        { type: 'metrics', items: [{ label: 'Exposure', value: 250000 }] },
        { type: 'text', text: 'Notification text' },
      ] },
      details: { blocks: [
        { type: 'callout', text: 'Details callout' },
        { type: 'key_value', items: [{ label: 'Customer', value: 'Northstar' }] },
        { type: 'table', title: 'Inventory Analysis', columns: ['Metric', 'Current', 'Required', 'Variance'], rows: [['Inventory', '820 units', '610 units', '+210 units']] },
        { type: 'bullet_list', items: ['One', 'Two'] },
      ] },
      mitigation: { blocks: [
        { type: 'callout', text: 'Mitigation callout' },
        { type: 'numbered_list', items: ['One', 'Two'] },
        { type: 'action_list', items: [{ order: 1, title: 'Action' }] },
        { type: 'divider' },
        { type: 'text', text: 'Mitigation text' },
      ] },
    }
    vi.mocked(api.fetchRisks).mockResolvedValue([{ risk_id: builderRisk.risk_id, title: builderRisk.title, severity: builderRisk.severity }])
    vi.mocked(api.fetchRisk).mockResolvedValue(builderRisk as unknown as Record<string, unknown>)
    vi.mocked(api.fetchDestinations).mockResolvedValue([
      { destination_id: 'teams-sarah', client_id: 'client-1', platform: 'teams', member_name: 'Sarah Lim', team_name: 'Northstar Operations', channel_name: 'Executive Risk Review', is_active: true },
      { destination_id: 'teams-alex', client_id: 'client-1', platform: 'teams', member_name: 'Alex Tan', team_name: 'Northstar Operations', channel_name: 'Supply Chain Risk', is_active: true },
    ])
    vi.mocked(api.fetchDestinationOverrides).mockResolvedValue([])

    const user = userEvent.setup()
    render(<CustomizeExistingRisk />)

    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), builderRisk.risk_id)

    await waitFor(() => expect(screen.getByLabelText('Destination')).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Teams · Sarah Lim · Northstar Operations · Executive Risk Review' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Teams · Alex Tan · Northstar Operations · Supply Chain Risk' })).toBeInTheDocument()
    expect(screen.getByText('No active destination customizations.')).toBeInTheDocument()
  })

  test('distinguishes risk fetch failures from risk parsing failures', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchRisk).mockRejectedValueOnce(new Error('network down'))
    render(<CustomizeExistingRisk />)
    await screen.findByRole('option', { name: 'Acme' })
    await user.selectOptions(screen.getByLabelText('Client'), 'client-1')
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to fetch risk RSK-1: network down')

    vi.mocked(api.fetchRisk).mockResolvedValueOnce({ schema_version: 2, views: {} })
    await user.selectOptions(screen.getByLabelText('Existing Risk'), 'RSK-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Risk RSK-1 could not be parsed for customization:')
  })
})
