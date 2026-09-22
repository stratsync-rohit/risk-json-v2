import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import Page from '@/app/page'

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} />,
}))

vi.mock('@/components/auth/AuthGate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: { displayName: 'Test User', email: 'test@stratsync.ai' }, signOut: vi.fn() }),
}))

function response(status: number, payload: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function jsonEditorValue() {
  return JSON.parse((screen.getByLabelText('Risk JSON editor') as HTMLTextAreaElement).value)
}

function riskContext() {
  return screen.getByRole('button', { name: 'Risk Context' }).closest('section') as HTMLElement
}

function mitigationPlan() {
  return screen.getAllByRole('button', { name: 'Mitigation Plan' })[0].closest('section') as HTMLElement
}

function populatedDatabaseRisk(riskId = 'RSK-EXISTING-0001') {
  return {
    risk_id: riskId,
    card_id: 'cover-risk',
    industry_slug: '',
    industry_name: '',
    title: 'Cover Risk',
    severity: 'high',
    severity_label: 'high',
    subtitle: 'SKU 21132',
    summary: 'Pending demand exceeds cover.',
    sender: { name: 'StratSync Risk Monitor', source: 'Cover Risk Alert', risk_id: riskId, timestamp: '' },
    entity: { type: 'sku', id: '21132', name: '' },
    metrics: [],
    details: {
      section_title: 'ITEM-LEVEL DETAILS',
      items: [
        { label: 'Demand signal', value: 'Pending sales orders have increased.' },
        { label: 'Cover position', value: 'Current stock is insufficient.' },
        { label: 'Supplier signal', value: 'Expedited replenishment is available.' },
      ],
      impact: ['Revenue at risk.', 'Customer service may be affected.', 'Priority allocation may be required.'],
    },
    mitigation: {
      summary: 'Cover gap detected.',
      steps: [
        { step: 1, title: 'Confirm cover gap', owner: 'Procurement' },
        { step: 2, title: 'Check supplier availability', owner: 'Category Manager' },
        { step: 3, title: 'Protect priority orders', owner: 'Customer Service' },
      ],
      last_updated: 'Today',
      next_action: 'Open in Command Center',
    },
    actions: [],
    detected_time: '',
    is_active: true,
    status: 'active',
  }
}

async function fillPopulatedForm(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Cover Risk' } })
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } })
  fireEvent.change(screen.getByLabelText('SKU'), { target: { value: '21132' } })
  fireEvent.change(screen.getAllByLabelText('Summary')[0], { target: { value: 'Pending demand exceeds cover.' } })

  const context = within(riskContext())
  fireEvent.change(context.getByLabelText('Label'), { target: { value: 'Demand signal' } })
  fireEvent.change(context.getByLabelText('Value'), { target: { value: 'Pending sales orders have increased.' } })
  await user.click(context.getByRole('button', { name: 'Add Detail' }))
  fireEvent.change(context.getAllByLabelText('Label')[1], { target: { value: 'Cover position' } })
  fireEvent.change(context.getAllByLabelText('Value')[1], { target: { value: 'Current stock is insufficient.' } })
  await user.click(context.getByRole('button', { name: 'Add Detail' }))
  fireEvent.change(context.getAllByLabelText('Label')[2], { target: { value: 'Supplier signal' } })
  fireEvent.change(context.getAllByLabelText('Value')[2], { target: { value: 'Expedited replenishment is available.' } })
  fireEvent.change(context.getByLabelText('Impact 1'), { target: { value: 'Revenue at risk.' } })
  await user.click(context.getByRole('button', { name: 'Add Impact' }))
  fireEvent.change(context.getByLabelText('Impact 2'), { target: { value: 'Customer service may be affected.' } })
  await user.click(context.getByRole('button', { name: 'Add Impact' }))
  fireEvent.change(context.getByLabelText('Impact 3'), { target: { value: 'Priority allocation may be required.' } })

  const mitigation = within(mitigationPlan())
  fireEvent.change(mitigation.getByLabelText('Summary'), { target: { value: 'Cover gap detected.' } })
  await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
  await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
  await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
  fireEvent.change(mitigation.getAllByLabelText('Title / Action')[0], { target: { value: 'Confirm cover gap' } })
  fireEvent.change(mitigation.getAllByLabelText('Owner')[0], { target: { value: 'Procurement' } })
  fireEvent.change(mitigation.getAllByLabelText('Title / Action')[1], { target: { value: 'Check supplier availability' } })
  fireEvent.change(mitigation.getAllByLabelText('Owner')[1], { target: { value: 'Category Manager' } })
  fireEvent.change(mitigation.getAllByLabelText('Title / Action')[2], { target: { value: 'Protect priority orders' } })
  fireEvent.change(mitigation.getAllByLabelText('Owner')[2], { target: { value: 'Customer Service' } })
}

function requestBody(method: 'POST' | 'PUT') {
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === method)
  expect(call, `${method} request was not sent`).toBeDefined()
  return { url: String(call?.[0]), body: JSON.parse(String(call?.[1]?.body)) }
}

function expectPopulatedCanonicalData(body: Record<string, unknown>, lastUpdated = 'Today', nextAction = 'Open in Command Center') {
  expect(body.details).toEqual({
    section_title: 'ITEM-LEVEL DETAILS',
    items: [
      { label: 'Demand signal', value: 'Pending sales orders have increased.' },
      { label: 'Cover position', value: 'Current stock is insufficient.' },
      { label: 'Supplier signal', value: 'Expedited replenishment is available.' },
    ],
    impact: ['Revenue at risk.', 'Customer service may be affected.', 'Priority allocation may be required.'],
  })
  expect(body.mitigation).toEqual({
    summary: 'Cover gap detected.',
    steps: [
      { step: 1, title: 'Confirm cover gap', owner: 'Procurement' },
      { step: 2, title: 'Check supplier availability', owner: 'Category Manager' },
      { step: 3, title: 'Protect priority orders', owner: 'Customer Service' },
    ],
    last_updated: lastUpdated,
    next_action: nextAction,
  })
}

describe('Risk JSON Builder canonical form', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return response(201)
      if (url.endsWith('/api/risks')) return response(200, [])
      return response(404)
    }))
  })

  test('fresh drafts initialize canonical details and edit repeatable detail rows', async () => {
    const user = userEvent.setup()
    render(<Page />)

    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))
    expect(jsonEditorValue().details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [],
      impact: [],
    })
    expect(jsonEditorValue().mitigation).toEqual({
      summary: '',
      steps: [],
      last_updated: '',
      next_action: '',
    })

    const context = within(riskContext())
    expect(context.queryByText('Bullet Items')).not.toBeInTheDocument()
    expect(context.queryByRole('button', { name: 'Add Section' })).not.toBeInTheDocument()
    expect(context.getByRole('heading', { name: 'Impact' })).toBeInTheDocument()

    await user.clear(context.getByLabelText('Section Title'))
    await user.type(context.getByLabelText('Section Title'), 'ITEM-LEVEL DETAILS')
    await user.type(context.getByLabelText('Label'), 'Demand signal')
    await user.type(context.getByLabelText('Value'), 'Pending sales orders increased.')
    await user.click(context.getByRole('button', { name: 'Add Detail' }))

    const labels = context.getAllByLabelText('Label')
    const values = context.getAllByLabelText('Value')
    await user.type(labels[1], 'Cover position')
    await user.type(values[1], 'Confirmed cover is insufficient.')

    expect(jsonEditorValue().details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [
        { label: 'Demand signal', value: 'Pending sales orders increased.' },
        { label: 'Cover position', value: 'Confirmed cover is insufficient.' },
      ],
      impact: [],
    })

    await user.click(context.getByRole('button', { name: 'Delete detail 1' }))
    expect(jsonEditorValue().details.items).toEqual([
      { label: 'Cover position', value: 'Confirmed cover is insufficient.' },
    ])
  })

  test('adds, edits, and removes multiple Impact entries in the live JSON', async () => {
    const user = userEvent.setup()
    render(<Page />)

    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))
    const context = within(riskContext())

    await user.type(context.getByLabelText('Impact 1'), '  Revenue exposure may increase.  ')
    await user.click(context.getByRole('button', { name: 'Add Impact' }))
    await user.type(context.getByLabelText('Impact 2'), '  Tier 1 customers may be affected.  ')

    expect(jsonEditorValue().details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [],
      impact: [
        'Revenue exposure may increase.',
        'Tier 1 customers may be affected.',
      ],
    })

    await user.clear(context.getByLabelText('Impact 2'))
    await user.type(context.getByLabelText('Impact 2'), 'Priority allocation may be required.')
    expect(jsonEditorValue().details.impact).toEqual([
      'Revenue exposure may increase.',
      'Priority allocation may be required.',
    ])

    await user.click(context.getByRole('button', { name: 'Delete impact 1' }))
    expect(jsonEditorValue().details.impact).toEqual(['Priority allocation may be required.'])
    expect(context.getByLabelText('Impact 1')).toHaveValue('Priority allocation may be required.')
  })

  test('mitigation inputs update JSON and deletion recalculates step numbers', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))

    const mitigation = within(mitigationPlan())
    await user.type(mitigation.getByLabelText('Summary'), 'Cover gap detected.')
    expect(mitigation.queryByLabelText('Last Updated')).not.toBeInTheDocument()
    expect(mitigation.queryByLabelText('Next Action')).not.toBeInTheDocument()

    await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
    await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
    await user.click(mitigation.getByRole('button', { name: 'Add Step' }))

    const titles = mitigation.getAllByLabelText('Title / Action')
    const owners = mitigation.getAllByLabelText('Owner')
    await user.type(titles[0], 'Confirm cover gap')
    await user.type(owners[0], 'Procurement')
    await user.type(titles[1], 'Temporary action')
    await user.type(owners[1], 'Temporary owner')
    await user.type(titles[2], 'Check supplier availability')
    await user.type(owners[2], 'Category team')

    expect(mitigation.queryByLabelText('Description')).not.toBeInTheDocument()
    await user.click(mitigation.getByRole('button', { name: 'Delete step 2' }))

    expect(jsonEditorValue().mitigation).toEqual({
      summary: 'Cover gap detected.',
      steps: [
        { step: 1, title: 'Confirm cover gap', owner: 'Procurement' },
        { step: 2, title: 'Check supplier availability', owner: 'Category team' },
      ],
      last_updated: '',
      next_action: '',
    })
    expect(mitigation.getByText('Step 1')).toBeInTheDocument()
    expect(mitigation.getByText('Step 2')).toBeInTheDocument()
    expect(mitigation.queryByText('Step 3')).not.toBeInTheDocument()
  })

  test('POSTs every populated canonical nested field to the risk API', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))

    await fillPopulatedForm(user)

    const liveJson = jsonEditorValue()

    const submit = screen.getByRole('button', { name: 'Add to Database' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => {
      const { url, body } = requestBody('POST')
      expect(url).toBe('https://api.example.test/api/risks')
      expectPopulatedCanonicalData(body, '', '')
      expect(body).toEqual(liveJson)
      expect(log).toHaveBeenCalledWith('POST /api/risks payload', {
        risk_id: body.risk_id,
        details: body.details,
        mitigation: body.mitigation,
      })
    })
  })

  test('POSTs one detail and one step while omitting only truly blank rows', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Single-entry risk' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: '21132' } })
    fireEvent.change(screen.getAllByLabelText('Summary')[0], { target: { value: 'Single-entry summary.' } })

    const context = within(riskContext())
    fireEvent.change(context.getByLabelText('Label'), { target: { value: 'Only detail' } })
    fireEvent.change(context.getByLabelText('Value'), { target: { value: 'Only detail value.' } })
    await user.click(context.getByRole('button', { name: 'Add Detail' }))
    fireEvent.change(context.getByLabelText('Impact 1'), { target: { value: 'Only impact.' } })
    await user.click(context.getByRole('button', { name: 'Add Impact' }))

    const mitigation = within(mitigationPlan())
    fireEvent.change(mitigation.getByLabelText('Summary'), { target: { value: 'Only mitigation summary.' } })
    await user.click(mitigation.getByRole('button', { name: 'Add Step' }))
    fireEvent.change(mitigation.getByLabelText('Title / Action'), { target: { value: 'Only step' } })
    fireEvent.change(mitigation.getByLabelText('Owner'), { target: { value: 'Only owner' } })
    await user.click(mitigation.getByRole('button', { name: 'Add Step' }))

    const liveJson = jsonEditorValue()
    expect(liveJson.details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [{ label: 'Only detail', value: 'Only detail value.' }],
      impact: ['Only impact.'],
    })
    expect(liveJson.mitigation).toEqual({
      summary: 'Only mitigation summary.',
      steps: [{ step: 1, title: 'Only step', owner: 'Only owner' }],
      last_updated: '',
      next_action: '',
    })

    const submit = screen.getByRole('button', { name: 'Add to Database' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => expect(requestBody('POST').body).toEqual(liveJson))
  })

  test('Database Edit sends a populated canonical PUT body', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const existingRisk = populatedDatabaseRisk()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') return response(200)
      if (url === 'https://api.example.test/api/risks') return response(200, [existingRisk])
      if (url.includes('/api/risks/')) return response(404)
      return response(404)
    }))

    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))
    await user.click(screen.getByRole('button', { name: 'Database Risks' }))
    await waitFor(() => expect(screen.getByText('RSK-EXISTING-0001')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Update Risk' }))

    await waitFor(() => {
      const { url, body } = requestBody('PUT')
      expect(url).toBe('https://api.example.test/api/risks/RSK-EXISTING-0001')
      expectPopulatedCanonicalData(body)
      expect(log).toHaveBeenCalledWith('PUT /api/risks payload', {
        risk_id: body.risk_id,
        details: body.details,
        mitigation: body.mitigation,
      })
    })
  })

  test('populated nested state survives POST, database reload, Edit, and PUT', async () => {
    let storedRisk: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        storedRisk = JSON.parse(String(init.body))
        return response(201)
      }
      if (init?.method === 'PUT') {
        storedRisk = JSON.parse(String(init.body))
        return response(200)
      }
      if (url === 'https://api.example.test/api/risks') return response(200, storedRisk ? [storedRisk] : [])
      if (url.includes('/api/risks/')) return response(404)
      return response(404)
    }))

    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))
    await fillPopulatedForm(user)
    await user.click(screen.getByRole('button', { name: 'Add to Database' }))

    await waitFor(() => expect(screen.getByText('No active risk')).toBeInTheDocument())
    const post = requestBody('POST')
    expectPopulatedCanonicalData(post.body, '', '')

    await user.click(screen.getByRole('button', { name: 'Database Risks' }))
    await waitFor(() => expect(screen.getByText(String(post.body.risk_id))).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Update Risk' }))

    await waitFor(() => {
      const put = requestBody('PUT')
      expect(put.url).toBe(`https://api.example.test/api/risks/${post.body.risk_id}`)
      expectPopulatedCanonicalData(put.body, '', '')
    })
  })

  test('parsed canonical JSON becomes the PUT source of truth', async () => {
    const riskId = 'RSK-JSON-0001'
    const existingRisk = populatedDatabaseRisk(riskId)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') return response(200)
      if (url === 'https://api.example.test/api/risks') return response(200, [existingRisk])
      if (url.includes('/api/risks/')) return response(404)
      return response(404)
    }))

    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))
    await user.click(screen.getByRole('button', { name: 'Database Risks' }))
    await waitFor(() => expect(screen.getByText(riskId)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'JSON → UI' }))

    const editedJson = {
      ...existingRisk,
      details: {
        section_title: 'ITEM-LEVEL DETAILS',
        items: [
          { label: 'JSON demand signal', value: 'JSON demand remains elevated.' },
          { label: 'JSON cover position', value: 'JSON cover remains insufficient.' },
        ],
        impact: ['JSON revenue impact.', 'JSON customer impact.'],
      },
      mitigation: {
        summary: 'JSON mitigation summary.',
        steps: [
          { step: 1, title: 'JSON confirm cover', owner: 'JSON Procurement' },
          { step: 2, title: 'JSON check supplier', owner: 'JSON Category Manager' },
        ],
        last_updated: 'JSON Today',
        next_action: 'JSON next action',
      },
    }
    fireEvent.change(screen.getByLabelText('Risk JSON editor'), { target: { value: JSON.stringify(editedJson, null, 2) } })
    await user.click(screen.getByRole('button', { name: 'Parse JSON' }))
    await user.click(screen.getByRole('button', { name: 'Update Risk' }))

    await waitFor(() => {
      const { body } = requestBody('PUT')
      expect(body.details).toEqual({
        section_title: 'ITEM-LEVEL DETAILS',
        items: [
          { label: 'JSON demand signal', value: 'JSON demand remains elevated.' },
          { label: 'JSON cover position', value: 'JSON cover remains insufficient.' },
        ],
        impact: ['JSON revenue impact.', 'JSON customer impact.'],
      })
      expect(body.mitigation).toEqual({
        summary: 'JSON mitigation summary.',
        steps: [
          { step: 1, title: 'JSON confirm cover', owner: 'JSON Procurement' },
          { step: 2, title: 'JSON check supplier', owner: 'JSON Category Manager' },
        ],
        last_updated: 'JSON Today',
        next_action: 'JSON next action',
      })
    })
  })

  test('keeps the current create draft isolated while visiting destination customization', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await waitFor(() => expect(jsonEditorValue().risk_id).toMatch(/^RSK-/))

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft that must survive' } })
    expect(screen.getByRole('button', { name: 'Database Risks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Database' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Customize Existing Risk' }))
    expect(screen.getByRole('heading', { name: 'Customize an existing risk' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Database' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create New Risk' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Draft that must survive')
    expect(screen.getByRole('button', { name: 'Database Risks' })).toBeInTheDocument()
  })
})
