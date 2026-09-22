import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GenericViewsEditor } from '@/components/risk-builder/generic-views-editor'
import { Preview } from '@/components/risk-preview'
import { sampleRisk } from '@/lib/risk-utils'

const tableBlock = {
  type: 'table' as const,
  title: 'Inventory Analysis',
  columns: ['Metric', 'Current', 'Required', 'Variance'],
  rows: [['Inventory', '820 units', '610 units', '+210 units']],
}

function riskWithTable() {
  const risk = structuredClone(sampleRisk)
  risk.views = {
    notification: { blocks: [tableBlock] },
    details: { title: 'Details', action_label: 'View Details', blocks: [] },
    mitigation: { title: 'Mitigation', action_label: 'Mitigation Plan', blocks: [] },
  }
  return risk
}

function keyWarnings(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(([message]) => String(message).includes('Each child in a list should have a unique "key" prop.'))
}

describe('array-shaped Risk V2 tables', () => {
  afterEach(() => vi.restoreAllMocks())

  test('Preview renders string columns without React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Preview risk={riskWithTable()} />)

    expect(keyWarnings(consoleError)).toEqual([])
  })

  test('GenericViewsEditor renders string columns without React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<GenericViewsEditor views={riskWithTable().views} onChange={() => {}} />)

    expect(keyWarnings(consoleError)).toEqual([])
  })
})
