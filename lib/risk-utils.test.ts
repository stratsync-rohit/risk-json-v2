import { describe, expect, test } from 'vitest'
import type { Risk } from '@/types/risk'
import { normalizeRisk, sampleRisk, toJson } from '@/lib/risk-utils'

function canonicalRisk(): Risk {
  return {
    ...structuredClone(sampleRisk),
    details: {
      section_title: ' ITEM-LEVEL DETAILS ',
      items: [
        { label: ' Demand signal ', value: ' Pending sales orders increased. ' },
        { label: '   ', value: '   ' },
        { label: ' Cover position ', value: ' Confirmed cover is insufficient. ' },
      ],
      impact: [' Revenue exposure may increase. ', '   ', ' Tier 1 customers may be affected. '],
    },
    mitigation: {
      summary: ' Cover gap detected. ',
      steps: [
        { step: 8, title: ' Confirm cover gap ', owner: ' Procurement ' },
        { step: 20, title: '   ', owner: '   ' },
        { step: 99, title: ' Check supplier availability ', owner: ' Category team ' },
      ],
      last_updated: ' Today, 9:58 AM IST ',
      next_action: ' Open in Command Center ',
    },
  }
}

describe('canonical risk serialization', () => {
  test('does not add legacy detail fields while normalizing canonical drafts', () => {
    const normalized = normalizeRisk({
      ...canonicalRisk(),
      impact: [],
      details: {
        section_title: 'ITEM-LEVEL DETAILS',
        items: [{ label: 'Demand signal', value: 'Pending sales orders increased.' }],
      },
    })

    expect(normalized.details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [{ label: 'Demand signal', value: 'Pending sales orders increased.' }],
      impact: [],
    })
  })

  test('emits trimmed canonical details and mitigation without retired builder fields', () => {
    const json = JSON.parse(toJson(canonicalRisk()))

    expect(json.details).toEqual({
      section_title: 'ITEM-LEVEL DETAILS',
      items: [
        { label: 'Demand signal', value: 'Pending sales orders increased.' },
        { label: 'Cover position', value: 'Confirmed cover is insufficient.' },
      ],
      impact: [
        'Revenue exposure may increase.',
        'Tier 1 customers may be affected.',
      ],
    })
    expect(json.details).not.toHaveProperty('sections')
    expect(json.details).not.toHaveProperty('underlying_exposure')
    expect(json.mitigation).toEqual({
      summary: 'Cover gap detected.',
      steps: [
        { step: 1, title: 'Confirm cover gap', owner: 'Procurement' },
        { step: 2, title: 'Check supplier availability', owner: 'Category team' },
      ],
      last_updated: 'Today, 9:58 AM IST',
      next_action: 'Open in Command Center',
    })
  })

  test('keeps legacy detail fields and mitigation descriptions readable when importing', () => {
    const normalized = normalizeRisk({
      ...structuredClone(sampleRisk),
      details: {
        section_title: 'LEGACY DETAILS',
        underlying_exposure: ['Legacy exposure'],
        impact: ['Legacy impact'],
      },
      mitigation: {
        summary: 'Legacy plan',
        steps: [{ step: 1, title: 'Legacy action', description: 'Legacy explanation', owner: 'Legacy owner' }],
        last_updated: 'Yesterday',
        next_action: 'Follow up',
      },
    })

    expect(normalized.details.underlying_exposure).toEqual(['Legacy exposure'])
    expect(normalized.details.impact).toEqual(['Legacy impact'])
    expect(Array.isArray(normalized.mitigation)).toBe(false)
    if (Array.isArray(normalized.mitigation)) throw new Error('Expected normalized mitigation object')
    expect(normalized.mitigation.steps[0]).toMatchObject({
      step: 1,
      title: 'Legacy action',
      description: 'Legacy explanation',
      owner: 'Legacy owner',
    })
  })
})
