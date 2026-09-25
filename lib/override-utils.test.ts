import { describe, expect, test } from 'vitest'
import type { Risk } from '@/types/risk'
import {
  buildCompleteOverride,
  buildPartialOverride,
  createBlankCustomizationDraft,
  hydrateOverrideDraft,
} from '@/lib/override-utils'

function baseRisk(): Risk {
  return {
    schema_version: 2,
    risk_id: 'RSK-BASE-001',
    industry_slug: 'distribution',
    industry_name: 'Distribution',
    title: 'Base risk',
    severity: 'high',
    severity_label: 'High',
    subtitle: 'Base subtitle',
    summary: 'Base summary',
    sender: { name: 'StratSync', source: 'Monitor', risk_id: 'RSK-BASE-001', timestamp: 'Today' },
    entity: { type: 'sku', id: 'SKU-1', name: 'Product' },
    views: {
      notification: { blocks: [{ type: 'text', title: 'Notice', text: 'Base notice' }] },
      details: { title: 'Details', action_label: 'View Details', blocks: [{ type: 'bullet_list', items: ['A', 'B'] }] },
      mitigation: { title: 'Plan', action_label: 'Mitigation', blocks: [] },
    },
    metadata: { currency: 'SGD', nested: { threshold: 10, labels: ['base'] } },
    is_active: true,
    status: 'active',
    created_at: 'created',
    updated_at: 'updated',
  }
}

describe('buildPartialOverride', () => {
  test('recurses through plain objects but replaces changed arrays as whole values', () => {
    const base = baseRisk()
    const edited = structuredClone(base)
    edited.views.notification.blocks = [
      { type: 'text', title: 'Destination notice', text: 'Custom notice' },
      { type: 'divider' },
    ]
    edited.metadata = { currency: 'SGD', nested: { threshold: 25, labels: ['custom', 'priority'] } }

    expect(buildPartialOverride(base, edited)).toEqual({
      views: {
        notification: {
          blocks: [
            { type: 'text', title: 'Destination notice', text: 'Custom notice' },
            { type: 'divider' },
          ],
        },
      },
      metadata: {
        nested: {
          threshold: 25,
          labels: ['custom', 'priority'],
        },
      },
    })
  })

  test('keeps empty arrays, empty strings, and false when they intentionally replace base values', () => {
    const base = baseRisk()
    const edited = structuredClone(base)
    edited.subtitle = ''
    edited.views.details.blocks = []
    edited.is_active = false

    expect(buildPartialOverride(base, edited)).toEqual({
      subtitle: '',
      views: { details: { blocks: [] } },
      is_active: false,
    })
  })

  test('never emits protected identity fields', () => {
    const base = baseRisk()
    const edited = structuredClone(base)
    edited.risk_id = 'RSK-CHANGED'
    edited.created_at = 'changed-created'
    edited.updated_at = 'changed-updated'
    edited.sender.risk_id = 'RSK-CHANGED'
    edited.entity.id = 'SKU-CHANGED'
    edited.summary = 'Allowed change'

    expect(buildPartialOverride(base, edited)).toEqual({ summary: 'Allowed change' })
  })
})

describe('complete overrides and editor drafts', () => {
  test('sanitizes protected fields from a complete override', () => {
    const edited = baseRisk()
    ;(edited as Risk & { _id: string })._id = 'mongo-id'

    const complete = buildCompleteOverride(edited)

    expect(complete).not.toHaveProperty('_id')
    expect(complete).not.toHaveProperty('risk_id')
    expect(complete).not.toHaveProperty('created_at')
    expect(complete).not.toHaveProperty('updated_at')
    expect(complete.sender).not.toHaveProperty('risk_id')
    expect(complete.entity).not.toHaveProperty('id')
    expect(complete).toMatchObject({ title: 'Base risk', summary: 'Base summary', schema_version: 2 })
  })

  test('hydrates override objects recursively while replacing arrays for editing', () => {
    const hydrated = hydrateOverrideDraft(baseRisk(), {
      subtitle: 'Destination subtitle',
      views: {
        notification: { blocks: [{ type: 'callout', text: 'Only this destination' }] },
      },
      metadata: { nested: { threshold: 40 } },
    })

    expect(hydrated.subtitle).toBe('Destination subtitle')
    expect(hydrated.views.notification.blocks).toEqual([{ type: 'callout', text: 'Only this destination' }])
    expect(hydrated.views.details.blocks).toEqual([{ type: 'bullet_list', items: ['A', 'B'] }])
    expect(hydrated.metadata).toEqual({ currency: 'SGD', nested: { threshold: 40, labels: ['base'] } })
    expect(hydrated.risk_id).toBe('RSK-BASE-001')
  })

  test('creates a blank editable Risk V2 draft with local identity only', () => {
    const blank = createBlankCustomizationDraft(baseRisk())

    expect(blank).toMatchObject({
      schema_version: 2,
      risk_id: 'RSK-BASE-001',
      title: '',
      subtitle: '',
      summary: '',
      severity: 'high',
      views: {
        notification: { blocks: [] },
        details: { blocks: [] },
        mitigation: { blocks: [] },
      },
      metadata: {},
    })
    expect(buildCompleteOverride(blank)).not.toHaveProperty('risk_id')
  })
})
