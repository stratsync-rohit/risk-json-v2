// @ts-nocheck
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import Image from 'next/image'
import { ArrowRight, Check, ChevronDown, ChevronUp, CircleAlert, Copy, Database, Download, Eye, GripVertical, Loader2, LogOut, Plus, RefreshCw, RotateCcw, Trash2, Upload, UserRound, X } from 'lucide-react'
import type { User } from 'firebase/auth'
import type { MitigationStep, Risk, RiskDetailItem, RiskMetric, RiskMitigation } from '@/types/risk'
import { normalizeRisk, riskSchema, toJson } from '@/lib/risk-utils'
import { Preview } from '@/components/risk-preview'
import { GenericViewsEditor } from '@/components/risk-builder/generic-views-editor'
import { AuthGate, useAuth } from '@/components/auth/AuthGate'

type SectionProps = { title: string; children: React.ReactNode; open?: boolean; badge?: string }
type ResizeHandleId = 'form-json' | 'json-preview'
type PanelWidths = { form: number; json: number; preview: number }
type BuilderMode = 'form' | 'json' | 'database'
type RiskIdStatus = 'idle' | 'checking' | 'verified' | 'error'
type DatabaseSaveStatus = 'idle' | 'saving' | 'success' | 'duplicate' | 'error'
type ActiveRiskStatus = 'draft' | 'existing-database' | 'none'
type DatabaseRisk = Omit<Partial<Risk>, '_id' | 'sender' | 'metrics' | 'details' | 'mitigation'> & {
  _id?: unknown
  created_at?: unknown
  updated_at?: unknown
  sender?: unknown
  metrics?: unknown
  details?: unknown
  mitigation?: unknown
}
const defaultPanelWidths: PanelWidths = { form: 34, json: 28, preview: 38 }
const severityTone: Record<string, string> = { low: 'bg-emerald-50 text-emerald-700 border-emerald-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', high: 'bg-orange-50 text-orange-700 border-orange-200', critical: 'bg-red-50 text-red-700 border-red-200' }
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
const readOnlyFieldClass = '!cursor-not-allowed !border-slate-200 !bg-slate-100 !text-slate-500 shadow-none placeholder:!text-slate-400 hover:!bg-slate-100 focus:!border-slate-200 focus:!bg-slate-100 focus:outline-none focus:ring-0 disabled:!cursor-not-allowed disabled:!border-slate-200 disabled:!bg-slate-100 disabled:!text-slate-500'
const savedRiskStorageKey = 'risk-json-builder-current-risk'
const savedJsonStorageKey = 'risk-json-builder-current-json'
const savedRiskTimestampKey = 'risk-json-builder-saved-at'
const activeRiskStatusStorageKey = 'risk-json-builder-active-status'
const databaseSavedRiskIdStorageKey = 'risk-json-builder-database-saved-risk-id'
const editingRiskIdStorageKey = 'risk-json-builder-editing-risk-id'
const autosaveDelayMs = 1000
const riskIdCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const riskIdGenerationAttempts = 10
function generateRandomBlock(length = 4) {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, value => riskIdCharacters[value % riskIdCharacters.length]).join('')
}

function generateRiskIdCandidate() {
  return `RSK-${generateRandomBlock()}-${generateRandomBlock()}`
}

async function checkRiskIdExists(riskId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Risk ID API URL is not configured')

  const response = await fetch(`${baseUrl}/api/risks/${encodeURIComponent(riskId)}`)
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`Risk ID check failed with status ${response.status}`)
}

function logRiskRequest(method: 'POST' | 'PUT', body: string) {
  if (process.env.NODE_ENV !== 'development') return
  const payload = JSON.parse(body) as Pick<Risk, 'risk_id' | 'details' | 'mitigation'>
  console.log(`${method} /api/risks payload`, {
    risk_id: payload.risk_id,
    details: payload.details,
    mitigation: payload.mitigation,
  })
}

async function createRisk(risk: Risk) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Risk API URL is not configured')
  const body = toJson(risk)
  logRiskRequest('POST', body)

  return fetch(`${baseUrl}/api/risks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

async function generateUniqueRiskId() {
  for (let attempt = 0; attempt < riskIdGenerationAttempts; attempt += 1) {
    const candidate = generateRiskIdCandidate()
    if (!await checkRiskIdExists(candidate)) return candidate
  }

  throw new Error('Unable to generate a unique Risk ID')
}

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createSenderContext(title: string) {
  const cleanedTitle = title
    .trim()
    .replace(/\s+risk\s+discovered$/i, '')
    .replace(/\s+alert$/i, '')
    .trim()

  return cleanedTitle ? `${cleanedTitle} Alert` : ''
}

function createEntitySubtitle(entity: Risk['entity']) {
  const id = entity.id.trim()
  const prefix = id ? [entity.type.trim().toUpperCase(), id].filter(Boolean).join(' ') : ''
  return [prefix, entity.name.trim()].filter(Boolean).join(' · ')
}

function formatAlertSeverity(value: string) {
  const cleaned = value
    .trim()
    .replace(/\s+severity$/i, '')
    .toLowerCase()

  if (!cleaned) return ''

  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} severity`
}

function syncAlertFromBasic(nextRisk: Risk): Risk {
  return { ...nextRisk, schema_version: 2, sender: { ...nextRisk.sender, risk_id: nextRisk.risk_id } }
}

function createFreshRiskDraft(riskId = ''): Risk {
  return {
    schema_version: 2, risk_id: riskId, card_id: '', industry_slug: '', industry_name: '', title: '', severity: '' as Risk['severity'], severity_label: '', subtitle: '', summary: '',
    sender: { name: 'StratSync RRM', source: 'Risk Monitor', risk_id: riskId, timestamp: '', context: '' },
    entity: { type: 'sku', id: '', name: '' },
    views: {
      notification: { blocks: [] },
      details: { title: 'Risk Details', action_label: 'View Details', blocks: [] },
      mitigation: { title: 'Mitigation Plan', action_label: 'Mitigation Plan', blocks: [] },
    },
    metadata: {}, is_active: true, status: 'active', created_at: '', updated_at: '',
  }
}

function toMetricKey(label: string) {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createUniqueMetricKey(label: string, metrics: RiskMetric[], currentIndex: number) {
  const baseKey = toMetricKey(label)
  if (!baseKey) return ''

  const usedKeys = new Set(metrics.filter((_, index) => index !== currentIndex).map(metric => metric.key))
  if (!usedKeys.has(baseKey)) return baseKey

  let suffix = 2
  while (usedKeys.has(`${baseKey}_${suffix}`)) suffix += 1
  return `${baseKey}_${suffix}`
}

function formatMetricDisplayValue(rawValue: unknown, type: string): string {
  if (rawValue === null || rawValue === undefined || rawValue === '') return ''

  if (type === 'currency') {
    const numberValue = Number(String(rawValue).replace(/[$,\s]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(numberValue)
  }

  if (type === 'number') {
    const numberValue = Number(String(rawValue).replace(/[,\s]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numberValue)
  }

  if (type === 'percentage') {
    const numberValue = Number(String(rawValue).replace(/[%\s,]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numberValue)}%`
  }

  return String(rawValue)
}

function normalizeMetricRawValue(rawValue: string, type: RiskMetric['type']): string | number {
  if (rawValue.trim() === '') return ''
  if (type === 'text') return rawValue

  const cleaned = rawValue.replace(type === 'currency' ? /[$,\s]/g : type === 'percentage' ? /[%\s,]/g : /[,\s]/g, '')
  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : rawValue
}

function metricRawValueError(rawValue: RiskMetric['raw_value'], type: RiskMetric['type']) {
  if (rawValue === '' || type === 'text') return ''
  const cleaned = String(rawValue).replace(type === 'currency' ? /[$,\s]/g : type === 'percentage' ? /[%\s,]/g : /[,\s]/g, '')
  return Number.isFinite(Number(cleaned)) ? '' : `Enter a valid ${type} value.`
}

function Section({ title, children, open = true, badge }: SectionProps) {
  const [expanded, setExpanded] = useState(open)
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50"><span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{title}{badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{badge}</span>}</span>{expanded ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}</button>{expanded && <div className="border-t border-slate-100 p-5">{children}</div>}</section>
}
function Field({ label, value, onChange, type = 'text', inputMode, pattern, placeholder, readOnly = false, autoGenerated = false, fixed = false }: { label: string; value: string | number | boolean; onChange?: (v: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; pattern?: string; placeholder?: string; readOnly?: boolean; autoGenerated?: boolean; fixed?: boolean }) { const isReadOnly = readOnly || autoGenerated || fixed; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}{fixed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">System-defined</span>}</span><input className={`${inputClass} ${isReadOnly ? readOnlyFieldClass : ''}`} type={type} inputMode={inputMode} pattern={pattern} value={String(value)} placeholder={placeholder} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function RiskIdField({ value, status }: { value: string; status: RiskIdStatus }) {
  const statusLabel = status === 'checking' ? 'Generating and verifying Risk ID' : status === 'verified' ? 'Risk ID verified' : status === 'error' ? 'Unable to verify Risk ID' : 'Risk ID is system-controlled'
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Risk ID</span><span className="relative"><input className={`${inputClass} ${readOnlyFieldClass} pr-10`} value={value || (status === 'checking' ? 'Generating Risk ID...' : '')} readOnly aria-readonly="true" aria-describedby="risk-id-status" /><span id="risk-id-status" role="status" aria-label={statusLabel} title={statusLabel} className="pointer-events-none absolute inset-y-0 right-3 flex w-4 items-center justify-center">{status === 'checking' ? <Loader2 className="size-4 animate-spin text-slate-500" /> : status === 'verified' ? <Check className="size-4 text-emerald-600" /> : status === 'error' ? <CircleAlert className="size-4 text-red-600" /> : null}</span></span></label>
}
function SelectField({ label, value, options, onChange, disabled = false, className = '' }: { label: string; value: string; options: string[]; onChange?: (v: string) => void; disabled?: boolean; className?: string }) { return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">{label}</span><select className={`${inputClass} ${disabled ? readOnlyFieldClass : ''} ${className}`} value={value} onChange={disabled || !onChange ? undefined : e => onChange(e.target.value)} disabled={disabled} aria-disabled={disabled ? 'true' : undefined}>{options.map(o => <option key={o || 'empty'} value={o}>{o || 'Select severity'}</option>)}</select></label> }
function TextArea({ label, value, onChange, placeholder, readOnly = false, autoGenerated = false }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean; autoGenerated?: boolean }) { const isReadOnly = readOnly || autoGenerated; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}</span><textarea className={`${inputClass} min-h-24 resize-y ${isReadOnly ? readOnlyFieldClass : ''}`} value={value} placeholder={placeholder} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function Button({ children, onClick, primary = false, danger = false, className = '', disabled = false }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; className?: string; disabled?: boolean }) { return <button disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${primary ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700' : danger ? 'border-red-100 text-red-600 hover:bg-red-50' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}>{children}</button> }

function ProfileMenu({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const signOut = async () => {
    setOpen(false)
    await onSignOut()
  }

  return <div ref={wrapperRef} className="relative">
    <button type="button" aria-label="User menu" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)} className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
      <UserRound className="size-4" />
    </button>
    {open && <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold text-slate-900">{user.displayName || 'User'}</p>
        <p className="truncate text-xs text-slate-500">{user.email || 'No email available'}</p>
      </div>
      <div className="my-1 border-t border-slate-100" />
      <button type="button" role="menuitem" onClick={() => { void signOut() }} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
        <LogOut className="size-3.5" />Sign out
      </button>
    </div>}
  </div>
}

function ResizeHandle({ label, active, onPointerDown, onDoubleClick, onKeyDown }: { label: string; active: boolean; onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void; onDoubleClick: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void }) {
  return <div role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} className={`group relative hidden min-h-[400px] cursor-col-resize touch-none items-stretch justify-center outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-inset xl:flex ${active ? 'bg-violet-50' : ''}`}><span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-violet-500 group-focus-visible:bg-violet-500 ${active ? 'bg-violet-500' : 'bg-slate-300'}`} /></div>
}

function parseRiskText(value: string): { risk: Risk | null; error: string } {
  try {
    return { risk: normalizeRisk(JSON.parse(value)), error: '' }
  } catch (error) {
    return { risk: null, error: error instanceof Error ? error.message : 'Invalid risk JSON' }
  }
}

function withoutDatabaseMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const cleanRisk = { ...(value as Record<string, unknown>) }
  delete cleanRisk._id
  delete cleanRisk.created_at
  delete cleanRisk.updated_at
  return cleanRisk
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function getDatabaseFactValue(facts: unknown[], label: string) {
  const fact = facts.find(item => stringValue(recordValue(item).label).toLowerCase() === label.toLowerCase())
  return stringValue(recordValue(fact).value)
}

function getDatabaseRiskSkuProduct(risk: DatabaseRisk) {
  const details = recordValue(risk.details)
  const facts = Array.isArray(details.facts) ? details.facts : []
  return {
    sku: stringValue(risk.sku) || getDatabaseFactValue(facts, 'SKU'),
    product: stringValue(risk.product) || getDatabaseFactValue(facts, 'Product'),
  }
}

function mapDatabaseMitigation(value: unknown) {
  const mitigation = recordValue(value)
  const source: unknown[] = Array.isArray(value) ? value : Array.isArray(mitigation.steps) ? mitigation.steps as unknown[] : []
  const steps = source.map((step, index) => {
    const mappedStep = recordValue(step)
    return {
      step: index + 1,
      title: typeof step === 'string' ? step : stringValue(mappedStep.title || mappedStep.name) || `Step ${index + 1}`,
      ...('description' in mappedStep ? { description: stringValue(mappedStep.description) } : {}),
      owner: stringValue(mappedStep.owner),
    }
  })
  if (Array.isArray(value)) return steps
  return {
    summary: stringValue(mitigation.summary),
    steps,
    last_updated: stringValue(mitigation.last_updated),
    next_action: stringValue(mitigation.next_action),
  }
}

function mapDatabaseMetrics(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(metric => {
    const source = recordValue(metric)
    const label = stringValue(source.label) || 'Metric'
    const rawValue = source.value ?? ''
    return {
      key: slugify(label),
      label,
      value: stringValue(rawValue),
      raw_value: typeof rawValue === 'string' || typeof rawValue === 'number' ? rawValue : '',
      type: 'text',
      highlight: source.status === 'critical',
    }
  })
}

function mapDatabaseDetails(value: unknown) {
  const source = recordValue(value)
  const hasCommonDetails = typeof source.section_title === 'string' || Array.isArray(source.items) || Array.isArray(source.underlying_exposure) || Array.isArray(source.impact)
  if (hasCommonDetails) {
    const items = Array.isArray(source.items) ? source.items.map(item => {
      const record = recordValue(item)
      return { label: stringValue(record.label), value: stringValue(record.value) }
    }).filter(item => item.label || item.value) : []
    return {
      section_title: stringValue(source.section_title),
      items,
      ...(Array.isArray(source.underlying_exposure) ? { underlying_exposure: source.underlying_exposure.map(stringValue).filter(Boolean) } : {}),
      ...(Array.isArray(source.impact) ? { impact: source.impact.map(stringValue).filter(Boolean) } : {}),
      ...(Array.isArray(source.sections) ? { sections: source.sections } : {}),
    }
  }
  if (Array.isArray(source.sections)) return { section_title: '', items: [], underlying_exposure: [], impact: [], sections: source.sections }

  const facts = Array.isArray(source.facts) ? source.facts : []
  const items = facts.map(fact => {
    const item = recordValue(fact)
    const label = stringValue(item.label)
    const factValue = stringValue(item.value)
    return { label, value: factValue }
  }).filter(item => item.label || item.value)

  return { section_title: items.length > 0 ? 'DATABASE FACTS' : '', items, underlying_exposure: [], impact: [], sections: [] }
}

function mapDatabaseRiskToBuilderRisk(databaseRisk: DatabaseRisk) {
  const source = withoutDatabaseMetadata(databaseRisk) as Record<string, unknown>
  const severity = stringValue(source.severity).toLowerCase()
  const sender = recordValue(source.sender)
  const { sku, product } = getDatabaseRiskSkuProduct(databaseRisk)

  return {
    ...source,
    risk_id: stringValue(source.risk_id) || 'DATABASE-RISK',
    title: stringValue(source.title) || 'Database Risk',
    severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
    severity_label: stringValue(source.severity_label) || severity || 'Medium',
    sku: sku || 'Unknown SKU',
    product: product || 'Unknown Product',
    summary: stringValue(source.summary) || 'No summary provided.',
    sender: { name: stringValue(sender.name) || 'StratSync Risk Monitor' },
    metrics: mapDatabaseMetrics(source.metrics),
    details: mapDatabaseDetails(databaseRisk.details),
    mitigation: mapDatabaseMitigation(source.mitigation),
  }
}

function databaseRiskLabel(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function databaseRiskStatus(risk: DatabaseRisk) {
  return databaseRiskLabel(risk.status || (risk.is_active ? 'active' : ''), '—')
}

function DatabaseRisksView({ risks, selectedRisk, loading, error, deletingRiskId, onRefresh, onView, onEdit, onDelete }: { risks: DatabaseRisk[]; selectedRisk: Risk | null; loading: boolean; error: string; deletingRiskId: string; onRefresh: () => void; onView: (risk: DatabaseRisk | null) => void; onEdit: (risk: DatabaseRisk) => void; onDelete: (risk: DatabaseRisk) => void }) {
  return <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-lg font-bold text-slate-950">Database Risks</h3><p className="mt-1 text-sm text-slate-500">View risks currently stored in MongoDB.</p></div>
      <div className="flex items-center gap-3"><span className="text-sm font-semibold text-slate-500">{risks.length} {risks.length === 1 ? 'Risk' : 'Risks'}</span><Button onClick={onRefresh} className="cursor-pointer" disabled={loading}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div>
    </div>
    {loading && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">Loading database risks...</p>}
    {!loading && error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><span>{error}</span><Button onClick={onRefresh} className="cursor-pointer border-red-200 text-red-700 hover:bg-white">Retry</Button></div>}
    {!loading && !error && risks.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">No risks found in the database.</p>}
    {!loading && !error && risks.length > 0 && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Risk ID</th><th className="px-4 py-3">Title</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Industry</th><th className="px-4 py-3">SKU / Product</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{risks.map((risk, index) => { const { sku, product } = getDatabaseRiskSkuProduct(risk); const riskId = stringValue(risk.risk_id); const deleting = deletingRiskId === riskId; return <tr key={databaseRiskLabel(risk._id, '') || riskId || index} className="align-top hover:bg-slate-50/70"><td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-700">{databaseRiskLabel(risk.risk_id)}</td><td className="max-w-[260px] px-4 py-4 font-semibold text-slate-900">{databaseRiskLabel(risk.title)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${severityTone[String(risk.severity || '').toLowerCase()] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{databaseRiskLabel(risk.severity_label || risk.severity)}</span></td><td className="px-4 py-4 text-slate-600">{databaseRiskLabel(risk.industry_name || risk.industry_slug)}</td><td className="max-w-[280px] whitespace-normal break-words px-4 py-4 text-slate-600">{sku || product ? <>{sku && <span className="font-medium text-slate-700">{sku}</span>}{sku && product ? ' · ' : null}{product && <span>{product}</span>}</> : '—'}</td><td className="px-4 py-4 capitalize text-slate-600">{databaseRiskStatus(risk)}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onView(risk)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><Eye className="size-3.5" />View</button><button type="button" onClick={() => onEdit(risk)} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"><ArrowRight className="size-3.5" />Edit</button><button type="button" disabled={!riskId || deleting} onClick={() => onDelete(risk)} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">{deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}{deleting ? 'Deleting...' : 'Delete'}</button></div></td></tr> })}</tbody></table></div></div>}
    {selectedRisk && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p><h3 className="mt-1 text-sm font-bold text-slate-900">{databaseRiskLabel(selectedRisk.title)}</h3></div><button type="button" onClick={() => onView(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-700">Close</button></div><Preview risk={selectedRisk} /></div>}
  </div>
}

function RiskJsonBuilder() {
  const { register } = useForm()
  const { user, signOut } = useAuth()
  const [risk, setRisk] = useState<Risk>(() => createFreshRiskDraft())
  const [activeRiskStatus, setActiveRiskStatus] = useState<ActiveRiskStatus>('draft')
  const [mode, setMode] = useState<BuilderMode>('form')
  const [devMode, setDevMode] = useState(false)
  const [jsonText, setJsonText] = useState(() => toJson(createFreshRiskDraft()))
  const [jsonError, setJsonError] = useState('')
  const [notice, setNotice] = useState('')
  const [isGeneratingRiskId, setIsGeneratingRiskId] = useState(false)
  const [riskIdStatus, setRiskIdStatus] = useState<RiskIdStatus>('checking')
  const [isInitialized, setIsInitialized] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [databaseRisks, setDatabaseRisks] = useState<DatabaseRisk[]>([])
  const [selectedDatabaseRisk, setSelectedDatabaseRisk] = useState<Risk | null>(null)
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseError, setDatabaseError] = useState('')
  const [databaseLoaded, setDatabaseLoaded] = useState(false)
  const [databaseSaveStatus, setDatabaseSaveStatus] = useState<DatabaseSaveStatus>('idle')
  const [databaseSaveRiskId, setDatabaseSaveRiskId] = useState('')
  const [databaseStoredRiskIds, setDatabaseStoredRiskIds] = useState<Set<string>>(() => new Set())
  const [editingRiskId, setEditingRiskId] = useState('')
  const [isUpdatingRisk, setIsUpdatingRisk] = useState(false)
  const [deletingRiskId, setDeletingRiskId] = useState('')
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(defaultPanelWidths)
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandleId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const riskRef = useRef(risk)
  const riskIdGenerationPromiseRef = useRef<Promise<string> | null>(null)
  const riskIdRequestTokenRef = useRef(0)
  const databaseSaveInFlightRef = useRef(false)
  riskRef.current = risk
  const json = useMemo(() => toJson(risk), [risk])
  const riskValidation = useMemo(() => riskSchema.safeParse(JSON.parse(json)), [json])
  const jsonEditorSynchronized = useMemo(() => {
    if (mode !== 'json') return true
    const parsed = parseRiskText(jsonText)
    return Boolean(parsed.risk && toJson(syncAlertFromBasic(parsed.risk)) === json)
  }, [json, jsonText, mode])
  const riskAlreadyInDatabase = Boolean(risk.risk_id && databaseStoredRiskIds.has(risk.risk_id))
  const canAddToDatabase = Boolean(activeRiskStatus === 'draft' && isInitialized && risk.risk_id && riskValidation.success && jsonEditorSynchronized && riskIdStatus === 'verified' && !isGeneratingRiskId && databaseSaveStatus !== 'saving' && !riskAlreadyInDatabase)
  const canUpdateRisk = Boolean(editingRiskId && !isUpdatingRisk)
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const commitFormRisk = (nextRisk: Risk) => {
    const synchronizedRisk = syncAlertFromBasic(nextRisk)
    setRisk(synchronizedRisk)
    setJsonText(toJson(synchronizedRisk))
    setJsonError('')
    setDirty(true)
    setSaveState('idle')
  }
  const update = (path: string, value: unknown) => {
    const nextRisk = structuredClone(risk)
    const parts = path.split('.')
    let target: Record<string, unknown> = nextRisk as unknown as Record<string, unknown>
    parts.slice(0, -1).forEach(part => { target = target[part] as Record<string, unknown> })
    target[parts.at(-1)!] = value
    commitFormRisk(nextRisk)
  }
  const handleSeverityChange = (value: Risk['severity']) => {
    commitFormRisk({ ...risk, severity: value, severity_label: value })
  }
  const handleIndustryNameChange = (value: string) => {
    commitFormRisk({ ...risk, industry_name: value, industry_slug: slugify(value) })
  }
  const handleTitleChange = (value: string) => {
    commitFormRisk({ ...risk, title: value, card_id: slugify(value), sender: { ...risk.sender, context: createSenderContext(value) } })
  }
  const updateEntity = (field: 'id' | 'name', value: string) => {
    const entity = { ...risk.entity, [field]: value }
    commitFormRisk({ ...risk, entity, subtitle: createEntitySubtitle(entity) })
  }
  const syncJson = (next: Risk) => { const synchronizedRisk = syncAlertFromBasic(next); setRisk(synchronizedRisk); setJsonText(toJson(synchronizedRisk)); setJsonError(''); setDirty(false); setSaveState('idle') }
  const assignUniqueRiskId = async (baseRisk: Risk) => {
    const requestToken = ++riskIdRequestTokenRef.current
    setIsGeneratingRiskId(true)
    setRiskIdStatus('checking')

    const generationPromise = riskIdGenerationPromiseRef.current || generateUniqueRiskId()
    riskIdGenerationPromiseRef.current = generationPromise

    try {
      const riskId = await generationPromise
      if (requestToken !== riskIdRequestTokenRef.current) return
      const currentRisk = riskRef.current.risk_id ? baseRisk : riskRef.current
      syncJson({ ...currentRisk, risk_id: riskId, sender: { ...currentRisk.sender, risk_id: riskId } })
      setDirty(true)
      setRiskIdStatus('verified')
    } catch (generationError) {
      if (requestToken !== riskIdRequestTokenRef.current) return
      if (process.env.NODE_ENV === 'development') console.error('Unable to generate a unique Risk ID', generationError)
      setRiskIdStatus('error')
      flash('Unable to generate a unique Risk ID. Please try again.')
    } finally {
      if (riskIdGenerationPromiseRef.current === generationPromise) riskIdGenerationPromiseRef.current = null
      if (requestToken === riskIdRequestTokenRef.current) setIsGeneratingRiskId(false)
    }
  }
  const cancelRiskIdGeneration = (status: RiskIdStatus = 'idle') => {
    riskIdRequestTokenRef.current += 1
    setIsGeneratingRiskId(false)
    setRiskIdStatus(status)
  }
  const fetchDatabaseRisks = useCallback(async () => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
    setDatabaseLoading(true)
    setDatabaseError('')

    if (!baseUrl) {
      setDatabaseLoading(false)
      setDatabaseLoaded(true)
      setDatabaseError('Unable to load database risks.')
      return
    }

    try {
      const response = await fetch(`${baseUrl}/api/risks`)
      if (!response.ok) throw new Error(`Database risks request failed with status ${response.status}`)
      const payload: unknown = await response.json()
      const source = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray((payload as { risks?: unknown }).risks) ? (payload as { risks: unknown[] }).risks : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
      setDatabaseRisks(source.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as DatabaseRisk[])
      setDatabaseStoredRiskIds(current => {
        const next = new Set(current)
        source.forEach(item => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const riskId = stringValue((item as DatabaseRisk).risk_id).trim()
            if (riskId) next.add(riskId)
          }
        })
        return next
      })
      setDatabaseLoaded(true)
    } catch (fetchError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to load database risks', fetchError)
      setDatabaseError('Unable to load database risks.')
      setDatabaseLoaded(true)
    } finally {
      setDatabaseLoading(false)
    }
  }, [])
  useEffect(() => {
    if (mode === 'database' && !databaseLoaded) void fetchDatabaseRisks()
  }, [databaseLoaded, fetchDatabaseRisks, mode])
  const editDatabaseRisk = (databaseRisk: DatabaseRisk) => {
    try {
      const nextRisk = syncAlertFromBasic(normalizeRisk(mapDatabaseRiskToBuilderRisk(databaseRisk)))
      cancelRiskIdGeneration('verified')
      setRisk(nextRisk)
      setJsonText(toJson(nextRisk))
      setJsonError('')
      setActiveRiskStatus('existing-database')
      setDirty(false)
      setSaveState('idle')
      if (nextRisk.risk_id) setDatabaseStoredRiskIds(current => new Set(current).add(nextRisk.risk_id))
      setDatabaseSaveStatus('idle')
      setDatabaseSaveRiskId('')
      setEditingRiskId(nextRisk.risk_id)
      try {
        window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(nextRisk))
        window.localStorage.setItem(savedJsonStorageKey, toJson(nextRisk))
        window.localStorage.setItem(activeRiskStatusStorageKey, 'existing-database')
        window.localStorage.setItem(editingRiskIdStorageKey, nextRisk.risk_id)
      } catch {
        // Keep the database risk available in memory if storage is unavailable.
      }
      setSelectedDatabaseRisk(null)
      setMode('form')
    } catch (loadError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to load database risk into builder', loadError)
      flash('Unable to load this database risk into the builder.')
    }
  }
  const viewDatabaseRisk = (databaseRisk: DatabaseRisk | null) => {
    if (!databaseRisk) {
      setSelectedDatabaseRisk(null)
      return
    }

    try {
      setSelectedDatabaseRisk(normalizeRisk(mapDatabaseRiskToBuilderRisk(databaseRisk)))
    } catch (viewError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to preview database risk', viewError)
      flash('Unable to load this database risk into the preview.')
    }
  }
  const clearEditSession = () => {
    setEditingRiskId('')
    setIsUpdatingRisk(false)
    setActiveRiskStatus('none')
    setJsonText('')
    setJsonError('')
    setDirty(false)
    setSaveState('idle')
    try {
      window.localStorage.setItem(activeRiskStatusStorageKey, 'none')
      window.localStorage.removeItem(editingRiskIdStorageKey)
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Keep the edit session cleared in memory if storage is unavailable.
    }
  }
  const cancelEdit = () => {
    clearEditSession()
    setMode('database')
    setSelectedDatabaseRisk(null)
  }
  const updateDatabaseRisk = async () => {
    if (!editingRiskId || isUpdatingRisk) return
    if (riskRef.current.risk_id !== editingRiskId) {
      flash('Risk ID cannot be changed.')
      return
    }

    const validation = riskSchema.safeParse(JSON.parse(toJson(riskRef.current)))
    if (!validation.success || !jsonEditorSynchronized || riskIdStatus !== 'verified') {
      flash('Please fix the risk data before updating.')
      return
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
    if (!baseUrl) {
      flash('Unable to connect to the risk API.')
      return
    }

    setIsUpdatingRisk(true)
    try {
      const canonicalRisk = normalizeRisk(validation.data)
      const body = toJson(canonicalRisk)
      logRiskRequest('PUT', body)
      const response = await fetch(`${baseUrl}/api/risks/${encodeURIComponent(editingRiskId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (response.status === 200) {
        clearEditSession()
        setMode('database')
        setDatabaseLoaded(true)
        await fetchDatabaseRisks()
        flash('Risk updated successfully')
        return
      }
      if (response.status === 404) {
        flash('Risk no longer exists in the database.')
        await fetchDatabaseRisks()
        return
      }
      if (response.status === 400) {
        flash('Risk ID cannot be changed.')
        return
      }
      if (response.status === 422) {
        flash('Risk data is invalid. Please review the form.')
        return
      }
      flash('Unable to update risk. Please try again.')
    } catch (updateError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to update database risk', updateError)
      flash('Unable to connect to the risk API.')
    } finally {
      setIsUpdatingRisk(false)
    }
  }
  const deleteDatabaseRisk = async (databaseRisk: DatabaseRisk) => {
    const riskId = stringValue(databaseRisk.risk_id).trim()
    if (!riskId || deletingRiskId) return
    if (!window.confirm(`Delete risk "${riskId}"?\n\nThis action cannot be undone.`)) return

    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
    if (!baseUrl) {
      flash('Unable to connect to the risk API.')
      return
    }

    setDeletingRiskId(riskId)
    try {
      const response = await fetch(`${baseUrl}/api/risks/${encodeURIComponent(riskId)}`, { method: 'DELETE' })
      if (response.ok) {
        setDatabaseStoredRiskIds(current => { const next = new Set(current); next.delete(riskId); return next })
        await fetchDatabaseRisks()
        flash('Risk deleted successfully')
        return
      }
      if (response.status === 404) {
        setDatabaseStoredRiskIds(current => { const next = new Set(current); next.delete(riskId); return next })
        await fetchDatabaseRisks()
        flash('Risk was already deleted or no longer exists.')
        return
      }
      flash('Unable to delete risk. Please try again.')
    } catch (deleteError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to delete database risk', deleteError)
      flash('Unable to delete risk. Please try again.')
    } finally {
      setDeletingRiskId('')
    }
  }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('JSON copied to clipboard') }
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `${risk.risk_id || 'risk'}.json`; a.click(); URL.revokeObjectURL(a.href) }
  const applyJsonToPreview = useCallback((source: string) => {
    const result = parseRiskText(source)

    if (result.risk) {
      if (editingRiskId && result.risk.risk_id !== editingRiskId) {
        setJsonError('Risk ID cannot be changed while editing a database risk.')
        return false
      }
      cancelRiskIdGeneration('verified')
      const synchronizedRisk = syncAlertFromBasic(result.risk)
      const riskChanged = toJson(synchronizedRisk) !== toJson(riskRef.current)
      setRisk(synchronizedRisk)
      setJsonError('')
      if (riskChanged) {
        if (!editingRiskId) setActiveRiskStatus('draft')
        setDirty(true)
        setSaveState('idle')
      }
      return true
    }

    setJsonError(result.error)
    return false
  }, [editingRiskId])

  const parse = () => {
    try {
      const parsedValue = JSON.parse(jsonText) as Record<string, unknown>
      const parsedRiskId = typeof parsedValue?.risk_id === 'string' ? parsedValue.risk_id.trim() : ''

      if (editingRiskId && parsedRiskId !== editingRiskId) {
        setJsonError('Risk ID cannot be changed while editing a database risk.')
        return
      }

      if (!parsedRiskId) {
        const normalizedRisk = normalizeRisk({ ...parsedValue, risk_id: '__PENDING__' })
        const freshRisk = syncAlertFromBasic({ ...normalizedRisk, risk_id: '', sender: { ...normalizedRisk.sender, risk_id: '' } })
        syncJson(freshRisk)
        void assignUniqueRiskId(freshRisk)
        return
      }
    } catch {
      // Let the existing parser provide the validation error.
    }

    if (applyJsonToPreview(jsonText)) flash('Risk JSON parsed successfully')
  }

  const resetRisk = () => {
    try {
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Ignore storage failures and still reset the in-memory risk.
    }

    const freshRisk = createFreshRiskDraft()
    setEditingRiskId('')
    setActiveRiskStatus('draft')
    setDatabaseSaveStatus('idle')
    setDatabaseSaveRiskId('')
    try {
      window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
      window.localStorage.removeItem(editingRiskIdStorageKey)
    } catch {
      // Continue with the in-memory draft if storage is unavailable.
    }
    syncJson(freshRisk)
    void assignUniqueRiskId(freshRisk)
  }

  const startNewRisk = () => {
    const freshRisk = createFreshRiskDraft()
    setEditingRiskId('')
    setActiveRiskStatus('draft')
    setDatabaseSaveStatus('idle')
    setDatabaseSaveRiskId('')
    setMode('form')
    setJsonText(toJson(freshRisk))
    setJsonError('')
    setDirty(true)
    setSaveState('idle')
    setRisk(freshRisk)
    try {
      window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
      window.localStorage.removeItem(editingRiskIdStorageKey)
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Continue with the in-memory draft if storage is unavailable.
    }
    void assignUniqueRiskId(freshRisk)
  }

  const addToDatabase = async () => {
    if (databaseSaveInFlightRef.current || riskAlreadyInDatabase) return

    const validation = riskSchema.safeParse(JSON.parse(toJson(riskRef.current)))
    if (!validation.success || !jsonEditorSynchronized || riskIdStatus !== 'verified' || isGeneratingRiskId) {
      flash('Please fix the risk data before adding it to the database.')
      return
    }

    const canonicalRisk = normalizeRisk(validation.data)
    const submittedRiskId = canonicalRisk.risk_id
    databaseSaveInFlightRef.current = true
    setDatabaseSaveStatus('saving')
    setDatabaseSaveRiskId(submittedRiskId)

    try {
      const response = await createRisk(canonicalRisk)

      if (response.status === 201) {
        setDatabaseStoredRiskIds(current => new Set(current).add(submittedRiskId))
        setDatabaseSaveStatus('success')
        void fetchDatabaseRisks()
        setActiveRiskStatus('none')
        setJsonText('')
        setJsonError('')
        setDirty(false)
        setSaveState('idle')
        try {
          window.localStorage.setItem(databaseSavedRiskIdStorageKey, submittedRiskId)
          window.localStorage.setItem(activeRiskStatusStorageKey, 'none')
          window.localStorage.removeItem(savedRiskStorageKey)
          window.localStorage.removeItem(savedJsonStorageKey)
          window.localStorage.removeItem(savedRiskTimestampKey)
        } catch {
          // The in-memory empty state still prevents accidental resubmission.
        }
        flash('Risk added to database')
        return
      }

      if (response.status === 409) {
        setDatabaseStoredRiskIds(current => new Set(current).add(submittedRiskId))
        setDatabaseSaveStatus('duplicate')
        setActiveRiskStatus('existing-database')
        try {
          window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(canonicalRisk))
          window.localStorage.setItem(savedJsonStorageKey, toJson(canonicalRisk))
          window.localStorage.setItem(activeRiskStatusStorageKey, 'existing-database')
          window.localStorage.setItem(databaseSavedRiskIdStorageKey, submittedRiskId)
        } catch {
          // Keep the duplicate state in memory if storage is unavailable.
        }
        flash('Risk ID already exists in the database.')
        return
      }

      if (response.status === 422) {
        if (process.env.NODE_ENV === 'development') {
          const detail = await response.json().catch(() => null)
          console.error('Risk API validation failed', detail)
        }
        setDatabaseSaveStatus('error')
        flash('Risk data is invalid. Please review the form.')
        return
      }

      setDatabaseSaveStatus('error')
      flash('Unable to add risk to the database. Please try again.')
    } catch (saveError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to connect to the risk API', saveError)
      setDatabaseSaveStatus('error')
      flash('Unable to connect to the risk API.')
    } finally {
      databaseSaveInFlightRef.current = false
    }
  }

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      let freshRisk: Risk | null = null

      try {
        const savedRisk = window.localStorage.getItem(savedRiskStorageKey)
        const storedStatus = window.localStorage.getItem(activeRiskStatusStorageKey) as ActiveRiskStatus | null
        const databaseSavedRiskId = window.localStorage.getItem(databaseSavedRiskIdStorageKey)
        const storedEditingRiskId = window.localStorage.getItem(editingRiskIdStorageKey)

        if (storedStatus === 'none' || (!savedRisk && databaseSavedRiskId && storedStatus !== 'draft')) {
          setActiveRiskStatus('none')
          setJsonText('')
          setJsonError('')
          setDirty(false)
          setSaveState('idle')
          setRiskIdStatus('idle')
          setIsInitialized(true)
          return
        }

        if (!savedRisk) {
          freshRisk = createFreshRiskDraft()
        } else {
          const savedValue = JSON.parse(savedRisk) as Record<string, unknown>
          const savedRiskId = typeof savedValue.risk_id === 'string' ? savedValue.risk_id.trim() : ''

          if (savedRiskId) {
            const loadedRisk = syncAlertFromBasic(normalizeRisk(savedValue))
            if (cancelled) return
            if (databaseSavedRiskId === savedRiskId || storedStatus === 'existing-database') {
              setActiveRiskStatus('existing-database')
              setDatabaseStoredRiskIds(current => new Set(current).add(savedRiskId))
              if (storedEditingRiskId === savedRiskId) setEditingRiskId(savedRiskId)
            } else {
              setActiveRiskStatus('draft')
            }
            setRisk(loadedRisk)
            setJsonText(toJson(loadedRisk))
            setJsonError('')
            setDirty(false)
            setSaveState('saved')
            setRiskIdStatus('verified')
            setIsInitialized(true)
            return
          }

          const normalizedSavedRisk = normalizeRisk({ ...savedValue, risk_id: '__PENDING__' })
          freshRisk = syncAlertFromBasic({ ...normalizedSavedRisk, risk_id: '', sender: { ...normalizedSavedRisk.sender, risk_id: '' } })
        }
      } catch {
        try {
          window.localStorage.removeItem(savedRiskStorageKey)
          window.localStorage.removeItem(savedJsonStorageKey)
          window.localStorage.removeItem(savedRiskTimestampKey)
        } catch {
          // Ignore storage failures and keep the fresh in-memory risk.
        }
        freshRisk = createFreshRiskDraft()
      }

      if (cancelled || !freshRisk) return
      setActiveRiskStatus('draft')
      syncJson(freshRisk)
      await assignUniqueRiskId(freshRisk)
      if (!cancelled) setIsInitialized(true)
    }

    void initialize()

    return () => {
      cancelled = true
      riskIdRequestTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!isInitialized || activeRiskStatus !== 'draft' || !dirty || isGeneratingRiskId) return

    const timeout = window.setTimeout(() => {
      const validation = riskSchema.safeParse(riskRef.current)
      if (!validation.success) return

      setSaveState('saving')
      const normalizedRisk = syncAlertFromBasic(normalizeRisk(validation.data))

      try {
        window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(normalizedRisk))
        window.localStorage.setItem(savedJsonStorageKey, toJson(normalizedRisk))
        window.localStorage.setItem(savedRiskTimestampKey, new Date().toISOString())
        window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
        setRisk(normalizedRisk)
        setJsonText(toJson(normalizedRisk))
        setJsonError('')
        setDirty(false)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, autosaveDelayMs)

    return () => window.clearTimeout(timeout)
  }, [activeRiskStatus, dirty, isGeneratingRiskId, isInitialized, risk])

  useEffect(() => {
    if (mode !== 'json') return

    const source = jsonText.trim()

    if (!source) return

    const timeout = window.setTimeout(() => applyJsonToPreview(source), 400)

    return () => window.clearTimeout(timeout)
  }, [jsonText, mode, applyJsonToPreview])
  const resizePanels = useCallback((clientX: number, handle: ResizeHandleId) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pointerPercent = ((clientX - rect.left) / rect.width) * 100
    setPanelWidths(current => {
      if (handle === 'form-json') {
        const form = Math.min(Math.max(pointerPercent, 24), 100 - 20 - current.preview)
        return { ...current, form, json: 100 - form - current.preview }
      }

      const preview = Math.min(Math.max(100 - current.form - pointerPercent, 28), 100 - current.form - 20)
      return { ...current, preview, json: 100 - current.form - preview }
    })
  }, [])
  useEffect(() => {
    if (!activeResizeHandle) return

    const handlePointerMove = (event: PointerEvent) => resizePanels(event.clientX, activeResizeHandle)
    const stopResizing = () => {
      setActiveResizeHandle(null)
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.userSelect = ''
    }
  }, [activeResizeHandle, resizePanels])
  const startResizing = (handle: ResizeHandleId) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActiveResizeHandle(handle)
  }
  const nudgePanels = (handle: ResizeHandleId, direction: number) => {
    setPanelWidths(current => {
      if (handle === 'form-json') {
        const form = Math.min(Math.max(current.form + direction, 24), 100 - 20 - current.preview)
        return { ...current, form, json: 100 - form - current.preview }
      }

      const json = Math.min(Math.max(current.json + direction, 20), 100 - current.form - 28)
      return { ...current, json, preview: 100 - current.form - json }
    })
  }
  const handleResizeKeyDown = (handle: ResizeHandleId) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      nudgePanels(handle, event.key === 'ArrowRight' ? 1 : -1)
    }
  }
  const resetPanelWidths = () => setPanelWidths(defaultPanelWidths)
  const updateDetailTitle = (sectionTitle: string) => commitFormRisk({ ...risk, details: { ...risk.details, section_title: sectionTitle } })
  const updateDetailItems = (items: RiskDetailItem[]) => commitFormRisk({ ...risk, details: { ...risk.details, items } })
  const patchDetailItem = (index: number, patch: Partial<RiskDetailItem>) => updateDetailItems(risk.details.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const addDetailItem = () => updateDetailItems([...risk.details.items, { label: '', value: '' }])
  const removeDetailItem = (index: number) => updateDetailItems(risk.details.items.filter((_, itemIndex) => itemIndex !== index))
  const commitImpact = (impact: string[]) => commitFormRisk({ ...risk, details: { ...risk.details, impact } })
  const addMetric = () => {
    const newMetric: RiskMetric = { key: '', label: '', value: '', raw_value: '', type: 'text', highlight: false }
    update('metrics', [...risk.metrics, newMetric])
  }
  const patchMetric = (i: number, patch: Partial<RiskMetric>) => update('metrics', risk.metrics.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  const handleMetricLabelChange = (index: number, label: string) => {
    const nextMetrics = risk.metrics.map((metric, metricIndex) => metricIndex === index
      ? { ...metric, label, key: createUniqueMetricKey(label, risk.metrics, index) }
      : metric)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const handleMetricRawValueChange = (index: number, rawValue: string) => {
    const metric = risk.metrics[index]
    const nextMetrics = risk.metrics.map((item, metricIndex) => metricIndex === index
      ? { ...item, raw_value: normalizeMetricRawValue(rawValue, metric.type), value: formatMetricDisplayValue(rawValue, metric.type) }
      : item)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const handleMetricTypeChange = (index: number, type: RiskMetric['type']) => {
    const metric = risk.metrics[index]
    const nextMetrics = risk.metrics.map((item, metricIndex) => metricIndex === index
      ? { ...item, type, value: formatMetricDisplayValue(metric.raw_value, type) }
      : item)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const duplicateMetric = (index: number) => {
    const metric = { ...risk.metrics[index], key: '' }
    const nextMetrics = [...risk.metrics.slice(0, index + 1), metric, ...risk.metrics.slice(index + 1)]
    nextMetrics[index + 1] = { ...metric, key: createUniqueMetricKey(metric.label, nextMetrics, index + 1) }
    update('metrics', nextMetrics)
  }
  const removeMetric = (i: number) => update('metrics', risk.metrics.filter((_, idx) => idx !== i))
  const move = <T,>(items: T[], i: number, direction: number) => { const next = [...items]; const target = i + direction; if (target < 0 || target >= next.length) return next; [next[i], next[target]] = [next[target], next[i]]; return next }
  const mitigationSteps: MitigationStep[] = Array.isArray(risk.mitigation) ? risk.mitigation : risk.mitigation?.steps || []
  const mitigation: RiskMitigation = Array.isArray(risk.mitigation)
    ? { summary: '', steps: mitigationSteps, last_updated: risk.updated_at || '', next_action: '' }
    : risk.mitigation
  const updateMitigation = (patch: Partial<RiskMitigation>) => commitFormRisk({ ...risk, mitigation: { ...mitigation, ...patch } })
  const updateMitigationSteps = (steps: MitigationStep[]) => updateMitigation({ steps: steps.map((step, index) => ({ ...step, step: index + 1 })) })
  const addMitigation = () => updateMitigationSteps([...mitigationSteps, { step: mitigationSteps.length + 1, title: '', owner: '' }])
  const patchMitigation = (i: number, patch: Partial<MitigationStep>) => updateMitigationSteps(mitigationSteps.map((step, index) => index === i ? { ...step, ...patch } : step))
  const actionButton = (label: string, onClick: () => void) => <button aria-label={label} title={label} onClick={onClick} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><GripVertical className="size-3.5" /></button>

  const formPanel = <div className="flex flex-col gap-4">
    <Section title="Risk Information">
      <div>
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Basic Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <RiskIdField value={risk.risk_id} status={riskIdStatus} />
          <Field label="Industry Name" value={risk.industry_name} onChange={handleIndustryNameChange} />
          <Field label="Title" value={risk.title} onChange={handleTitleChange} />
          <SelectField label="Severity" value={risk.severity} options={['', 'low', 'medium', 'high', 'critical']} onChange={v => handleSeverityChange(v as Risk['severity'])} />
          <Field label="Subtitle" value={risk.subtitle} onChange={v => update('subtitle', v)} />
          <Field label="Entity ID / SKU" value={risk.entity.id} onChange={v => updateEntity('id', v)} />
          <Field label="Entity Name / Product" value={risk.entity.name} onChange={v => updateEntity('name', v)} />
          <Field label="Sender / Source" value={risk.sender.source} onChange={v => commitFormRisk({ ...risk, sender: { ...risk.sender, source: v } })} />
          <div className="sm:col-span-2"><TextArea label="Summary" value={risk.summary} onChange={v => update('summary', v)} /></div>
        </div>
      </div>
    </Section>
    <GenericViewsEditor views={risk.views} onChange={views => commitFormRisk({ ...risk, views })} />
  </div>

  const jsonPanel = <div className="min-w-0"><JsonPanel jsonText={jsonText} setJsonText={setJsonText} error={jsonError} onParse={parse} onCopy={() => copy(mode === 'form' ? json : jsonText)} onDownload={download} onFormat={() => {
    try {
      const source = mode === 'form' ? json : jsonText
      setJsonText(JSON.stringify(JSON.parse(source), null, 2))
      setJsonError('')
    } catch {
      setJsonError('Cannot format invalid JSON')
    }
  }} /></div>
  const formColumn = <div className="min-w-0">{formPanel}</div>
  const previewColumn = <div className="min-w-0 xl:sticky xl:top-20 xl:self-start"><Preview risk={risk} /></div>
  const formJsonLayout = devMode ? <>
    <div ref={containerRef} className="hidden min-w-0 items-start xl:grid xl:[grid-template-columns:var(--panel-grid)]" style={{ '--panel-grid': `${panelWidths.form}fr 10px ${panelWidths.json}fr 10px ${panelWidths.preview}fr` } as React.CSSProperties}>
      {formColumn}
      <ResizeHandle label="Resize form and JSON editor panels" active={activeResizeHandle === 'form-json'} onPointerDown={startResizing('form-json')} onDoubleClick={resetPanelWidths} onKeyDown={handleResizeKeyDown('form-json')} />
      {jsonPanel}
      <ResizeHandle label="Resize JSON editor and preview panels" active={activeResizeHandle === 'json-preview'} onPointerDown={startResizing('json-preview')} onDoubleClick={resetPanelWidths} onKeyDown={handleResizeKeyDown('json-preview')} />
      {previewColumn}
    </div>
    <div className="grid items-start gap-4 xl:hidden">{formColumn}{jsonPanel}{previewColumn}</div>
  </> : <div className="grid items-start gap-4 lg:gap-6 lg:grid-cols-[1.1fr_0.9fr]">{formColumn}{jsonPanel}</div>
  const saveStatus = saveState === 'saving'
    ? <span className="text-xs font-medium text-slate-500">Saving...</span>
    : saveState === 'error'
      ? <span className="text-xs font-medium text-red-600">Unable to save locally</span>
      : dirty
        ? <span className="text-xs font-medium text-amber-600">Unsaved changes</span>
        : saveState === 'saved'
          ? <span className="text-xs font-medium text-emerald-600">Saved locally</span>
          : null
  const databaseButtonLabel = databaseSaveStatus === 'saving' && databaseSaveRiskId === risk.risk_id
    ? 'Adding...'
    : riskAlreadyInDatabase
      ? databaseSaveStatus === 'success' && databaseSaveRiskId === risk.risk_id ? 'Added to Database' : 'Already in Database'
      : 'Add to Database'
  const emptyState = <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><div className="max-w-md"><div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-5" /></div><h3 className="mt-4 text-lg font-bold text-slate-950">No active risk</h3><p className="mt-2 text-sm text-slate-500">Your previous risk has been added to the database. Start a new risk when ready.</p><Button primary className="mt-6 cursor-pointer" onClick={startNewRisk}><Plus className="size-3.5" />New Risk</Button></div></div>
  const builderContent = mode === 'database'
    ? <DatabaseRisksView risks={databaseRisks} selectedRisk={selectedDatabaseRisk} loading={databaseLoading} error={databaseError} deletingRiskId={deletingRiskId} onRefresh={() => { void fetchDatabaseRisks() }} onView={viewDatabaseRisk} onEdit={editDatabaseRisk} onDelete={deleteDatabaseRisk} />
    : activeRiskStatus === 'none'
      ? emptyState
      : mode === 'form'
        ? formJsonLayout
        : <div className="grid items-start gap-4 lg:gap-6 lg:grid-cols-[0.8fr_1.2fr]">{jsonPanel}<Preview risk={risk} /></div>
  const headerActions = activeRiskStatus === 'none'
    ? <Button primary className="cursor-pointer" onClick={startNewRisk}><Plus className="size-3.5" />New Risk</Button>
    : editingRiskId
      ? <><Button primary className="cursor-pointer disabled:cursor-not-allowed" disabled={!canUpdateRisk} onClick={() => { void updateDatabaseRisk() }}>{isUpdatingRisk && <Loader2 className="size-3.5 animate-spin" />}{isUpdatingRisk ? 'Updating...' : 'Update Risk'}</Button><Button className="cursor-pointer" disabled={isUpdatingRisk} onClick={cancelEdit}><X className="size-3.5" />Cancel Edit</Button></>
      : <><Button className="cursor-pointer disabled:cursor-not-allowed" disabled={!canAddToDatabase} onClick={() => { void addToDatabase() }}>{databaseSaveStatus === 'saving' && databaseSaveRiskId === risk.risk_id ? <Loader2 className="size-3.5 animate-spin" /> : riskAlreadyInDatabase ? <Check className="size-3.5" /> : <Database className="size-3.5" />}{databaseButtonLabel}</Button><Button className="cursor-pointer disabled:cursor-not-allowed" disabled={isGeneratingRiskId} onClick={resetRisk}>{isGeneratingRiskId ? <RefreshCw className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{isGeneratingRiskId ? 'Generating ID…' : 'Reset'}</Button></>

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center overflow-hidden rounded-lg "><Image src="/image.png" alt="StratSync logo" width={36} height={36} className="size-9 object-contain" /></div><div><h1 className="text-lg font-bold tracking-tight">Risk JSON Builder</h1><p className="hidden text-xs text-slate-500 sm:block">By Stratsync.ai</p></div></div><div className="flex items-center gap-2"><label className="hidden cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 md:flex"><input type="checkbox" checked={devMode} onChange={e => setDevMode(e.target.checked)} className="size-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed" />Developer Mode</label>{headerActions}<ProfileMenu user={user} onSignOut={signOut} /></div></div></header><div className="mx-auto max-w-[1500px] px-5 pb-5 pt-4 lg:px-8 lg:pt-5"><div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-1 flex items-center gap-2">{saveStatus}</div><h2 className="text-3xl font-bold tracking-tight text-slate-950">Risk JSON Builder</h2></div><div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm"><button onClick={() => setMode('form')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'form' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>Form → JSON</button><button onClick={() => setMode('json')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'json' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>JSON → UI</button><button onClick={() => setMode('database')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'database' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>Database Risks</button></div></div>{builderContent}</div>{notice && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl"><Check className="size-4 text-emerald-400" />{notice}</div>}</main>
}

export default function Page() {
  return <AuthGate><RiskJsonBuilder /></AuthGate>
}

function DetailItemsEditor({ items, sectionTitle, onTitleChange, onItemChange, onAdd, onRemove }: { items: RiskDetailItem[]; sectionTitle: string; onTitleChange: (title: string) => void; onItemChange: (index: number, patch: Partial<RiskDetailItem>) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="flex flex-col gap-4">
    <Field label="Section Title" value={sectionTitle} placeholder="ITEM-LEVEL DETAILS" onChange={onTitleChange} />
    <div className="flex flex-col gap-3">{items.map((item, index) => <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Detail {index + 1}</span><button type="button" aria-label={`Delete detail ${index + 1}`} onClick={() => onRemove(index)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div><div className="flex flex-col gap-3"><Field label="Label" value={item.label} placeholder="Demand signal" onChange={label => onItemChange(index, { label })} /><TextArea label="Value" value={item.value} placeholder="Enter detail value" onChange={value => onItemChange(index, { value })} /></div></div>)}</div>
    {items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No risk details added.</p>}
    <Button onClick={onAdd}><Plus className="size-3.5" />Add Detail</Button>
  </div>
}
function JsonPanel({ jsonText, setJsonText, error, onParse, onCopy, onDownload, onFormat }: { jsonText: string; setJsonText: (v: string) => void; error: string; onParse: () => void; onCopy: () => void; onDownload: () => void; onFormat: () => void }) {
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const resizeEditor = () => {
      const editor = jsonEditorRef.current
      if (!editor) return
      editor.style.height = 'auto'
      const borderHeight = editor.offsetHeight - editor.clientHeight
      editor.style.height = `${editor.scrollHeight + borderHeight}px`
    }

    resizeEditor()
    window.addEventListener('resize', resizeEditor)
    return () => window.removeEventListener('resize', resizeEditor)
  }, [jsonText])

  return <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 pb-4 pt-3.5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">JSON Editor</h3><p className="mt-0.5 text-xs text-slate-500">Edit the payload directly or use the form.</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span className={`size-1.5 rounded-full ${error ? 'bg-red-500' : 'bg-emerald-500'}`} />{error ? 'Invalid JSON' : 'Valid JSON'}</span></div><div className="relative"><textarea ref={jsonEditorRef} aria-label="Risk JSON editor" value={jsonText} onChange={e => setJsonText(e.target.value)} className="min-h-[500px] w-full overflow-y-hidden resize-none rounded-lg border border-slate-800 bg-[#17202b] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:ring-2 focus:ring-slate-300" spellCheck={false} />{error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}</div><div className="flex flex-wrap gap-2"><Button primary className="cursor-pointer" onClick={onParse}><Upload className="size-3.5" />Parse JSON</Button><Button className="cursor-pointer" onClick={onFormat}><Check className="size-3.5" />Format</Button><Button className="cursor-pointer" onClick={onCopy}><Copy className="size-3.5" />Copy</Button><Button className="cursor-pointer" onClick={onDownload}><Download className="size-3.5" />Download</Button></div></div>
}
