'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { GenericViewsEditor } from '@/components/risk-builder/generic-views-editor'
import { Preview } from '@/components/risk-preview'
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
  type Client,
  type Destination,
  type DestinationOverrideSummary,
  type RiskListItem,
} from '@/lib/api'
import {
  buildCompleteOverride,
  buildPartialOverride,
  createBlankCustomizationDraft,
  hydrateOverrideDraft,
} from '@/lib/override-utils'
import { normalizeRisk } from '@/lib/risk-utils'
import type { Risk } from '@/types/risk'

type CustomizationType = 'partial' | 'complete'
type EditorMode = 'form' | 'json'

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60'

function destinationLabel(destination: Pick<Destination, 'platform' | 'member_name' | 'team_name' | 'workspace_domain' | 'channel_name'>) {
  const platform = destination.platform === 'teams' ? 'Teams' : 'Slack'
  const location = destination.platform === 'teams' ? destination.team_name : destination.workspace_domain
  return [platform, destination.member_name, location, destination.channel_name].filter(Boolean).join(' · ')
}

function riskLabel(risk: RiskListItem) {
  return [risk.title || 'Untitled risk', risk.risk_id, risk.severity_label || risk.severity].filter(Boolean).join(' · ')
}

function cloneRisk(risk: Risk) {
  return structuredClone(risk)
}

type CustomizationLoadStage = 'risk-api' | 'risk-parse' | 'destination-overrides-api' | 'destination-api' | 'override-hydration' | 'resolved-parse'

class CustomizationLoadError extends Error {
  constructor(
    public readonly stage: CustomizationLoadStage,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'CustomizationLoadError'
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatRiskLoadError(error: unknown, riskId: string) {
  if (!(error instanceof CustomizationLoadError)) return `Unable to load risk ${riskId}: ${errorMessage(error)}`
  switch (error.stage) {
    case 'risk-api': return `Unable to fetch risk ${riskId}: ${errorMessage(error.cause)}`
    case 'risk-parse': return `Risk ${riskId} could not be parsed for customization: ${errorMessage(error.cause)}`
    case 'destination-overrides-api': return `Unable to fetch destination customizations for risk ${riskId}: ${errorMessage(error.cause)}`
    case 'destination-api': return `Unable to fetch the destination override or resolved risk: ${errorMessage(error.cause)}`
    case 'override-hydration': return `Destination override data for risk ${riskId} could not be hydrated: ${errorMessage(error.cause)}`
    case 'resolved-parse': return `Resolved risk ${riskId} could not be parsed: ${errorMessage(error.cause)}`
  }
}

export function CustomizeExistingRisk() {
  const [clients, setClients] = useState<Client[]>([])
  const [risks, setRisks] = useState<RiskListItem[]>([])
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [overrideSummaries, setOverrideSummaries] = useState<DestinationOverrideSummary[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedRiskId, setSelectedRiskId] = useState('')
  const [selectedDestinationId, setSelectedDestinationId] = useState('')
  const [baseRisk, setBaseRisk] = useState<Risk | null>(null)
  const [draft, setDraft] = useState<Risk | null>(null)
  const [resolvedRisk, setResolvedRisk] = useState<Risk | null>(null)
  const [hasOverride, setHasOverride] = useState(false)
  const [customizationType, setCustomizationType] = useState<CustomizationType>('partial')
  const [editorMode, setEditorMode] = useState<EditorMode>('form')
  const [draftJson, setDraftJson] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [metadataText, setMetadataText] = useState('{}')
  const [metadataError, setMetadataError] = useState('')
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingDestinations, setLoadingDestinations] = useState(false)
  const [loadingRisk, setLoadingRisk] = useState(false)
  const [loadingOverride, setLoadingOverride] = useState(false)
  const [loadingResolved, setLoadingResolved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestTokens = useRef({ initial: 0, destinations: 0, risk: 0, selection: 0 })
  const saveInFlight = useRef(false)

  const selectedDestination = useMemo(
    () => destinations.find(destination => destination.destination_id === selectedDestinationId) || null,
    [destinations, selectedDestinationId],
  )

  const payloadPreview = useMemo(() => {
    if (!baseRisk || !draft) return {}
    return customizationType === 'partial'
      ? buildPartialOverride(baseRisk, draft)
      : buildCompleteOverride(draft)
  }, [baseRisk, customizationType, draft])

  useEffect(() => {
    const token = ++requestTokens.current.initial
    setLoadingInitial(true)
    setError('')
    Promise.all([fetchClients(), fetchRisks()])
      .then(([nextClients, nextRisks]) => {
        if (token !== requestTokens.current.initial) return
        setClients(nextClients)
        setRisks(nextRisks)
      })
      .catch(() => {
        if (token === requestTokens.current.initial) setError('Unable to load clients and risks. Please try again.')
      })
      .finally(() => {
        if (token === requestTokens.current.initial) setLoadingInitial(false)
      })
    return () => { requestTokens.current.initial += 1 }
  }, [])

  const updateDraft = (nextDraft: Risk) => {
    setDraft(nextDraft)
    setDraftJson(JSON.stringify(nextDraft, null, 2))
    setMetadataText(JSON.stringify(nextDraft.metadata || {}, null, 2))
    setJsonError('')
    setMetadataError('')
  }

  const clearDestinationState = () => {
    requestTokens.current.selection += 1
    setSelectedDestinationId('')
    setDraft(null)
    setDraftJson('')
    setResolvedRisk(null)
    setHasOverride(false)
    setLoadingOverride(false)
    setLoadingResolved(false)
    setJsonError('')
    setMetadataError('')
  }

  const handleClientChange = async (clientId: string) => {
    const token = ++requestTokens.current.destinations
    requestTokens.current.risk += 1
    setSelectedClientId(clientId)
    setDestinations([])
    setSelectedRiskId('')
    setBaseRisk(null)
    setOverrideSummaries([])
    setLoadingRisk(false)
    clearDestinationState()
    setError('')
    if (!clientId) return

    setLoadingDestinations(true)
    try {
      const nextDestinations = await fetchDestinations(clientId)
      if (token === requestTokens.current.destinations) setDestinations(nextDestinations)
    } catch {
      if (token === requestTokens.current.destinations) setError('Unable to load destinations for this client.')
    } finally {
      if (token === requestTokens.current.destinations) setLoadingDestinations(false)
    }
  }

  const handleRiskChange = async (riskId: string) => {
    const token = ++requestTokens.current.risk
    setSelectedRiskId(riskId)
    setBaseRisk(null)
    setOverrideSummaries([])
    clearDestinationState()
    setError('')
    if (!riskId) return

    setLoadingRisk(true)
    try {
      const [riskResult, summariesResult] = await Promise.allSettled([
        fetchRisk(riskId),
        fetchDestinationOverrides(riskId),
      ])
      if (riskResult.status === 'rejected') throw new CustomizationLoadError('risk-api', riskResult.reason)
      let nextRisk: Risk
      try {
        nextRisk = normalizeRisk(riskResult.value)
      } catch (parseError) {
        throw new CustomizationLoadError('risk-parse', parseError)
      }
      if (summariesResult.status === 'rejected') throw new CustomizationLoadError('destination-overrides-api', summariesResult.reason)
      if (token !== requestTokens.current.risk) return
      setBaseRisk(nextRisk)
      setOverrideSummaries(summariesResult.value.filter(summary => summary.is_active !== false))
    } catch (loadError) {
      if (token === requestTokens.current.risk) setError(formatRiskLoadError(loadError, riskId))
    } finally {
      if (token === requestTokens.current.risk) setLoadingRisk(false)
    }
  }

  const loadDestinationState = async (risk: Risk, destinationId: string) => {
    const token = ++requestTokens.current.selection
    setLoadingOverride(true)
    setLoadingResolved(true)
    setError('')
    setResolvedRisk(null)
    try {
      const [overrideFetch, resolvedFetch] = await Promise.allSettled([
        fetchOverride(risk.risk_id, destinationId),
        fetchResolvedRisk(risk.risk_id, destinationId),
      ])
      if (overrideFetch.status === 'rejected') throw new CustomizationLoadError('destination-api', overrideFetch.reason)
      if (resolvedFetch.status === 'rejected') throw new CustomizationLoadError('destination-api', resolvedFetch.reason)
      const overrideResult = overrideFetch.value
      const nextHasOverride = Boolean(overrideResult?.is_active)
      let nextDraft: Risk
      try {
        nextDraft = nextHasOverride && overrideResult
          ? hydrateOverrideDraft(risk, overrideResult.overrides)
          : cloneRisk(risk)
      } catch (hydrationError) {
        throw new CustomizationLoadError('override-hydration', hydrationError)
      }
      let nextResolved: Risk
      try {
        nextResolved = normalizeRisk(resolvedFetch.value.risk)
      } catch (parseError) {
        throw new CustomizationLoadError('resolved-parse', parseError)
      }
      if (token !== requestTokens.current.selection) return
      setHasOverride(nextHasOverride)
      updateDraft(nextDraft)
      setResolvedRisk(nextResolved)
    } catch (loadError) {
      if (token === requestTokens.current.selection) setError(formatRiskLoadError(loadError, risk.risk_id))
    } finally {
      if (token === requestTokens.current.selection) {
        setLoadingOverride(false)
        setLoadingResolved(false)
      }
    }
  }

  const handleDestinationChange = (destinationId: string) => {
    setSelectedDestinationId(destinationId)
    setDraft(null)
    setDraftJson('')
    setResolvedRisk(null)
    setHasOverride(false)
    setJsonError('')
    setMetadataError('')
    if (baseRisk && destinationId) void loadDestinationState(baseRisk, destinationId)
    else requestTokens.current.selection += 1
  }

  const refreshAfterMutation = async () => {
    if (!baseRisk || !selectedDestinationId) return
    await loadDestinationState(baseRisk, selectedDestinationId)
    try {
      const summaries = await fetchDestinationOverrides(baseRisk.risk_id)
      setOverrideSummaries(summaries.filter(summary => summary.is_active !== false))
    } catch {
      setError('Override saved, but the destination customization list could not be refreshed.')
    }
  }

  const handleSave = async () => {
    if (saveInFlight.current || !baseRisk || !draft || !selectedDestinationId) return
    saveInFlight.current = true
    setSaving(true)
    setError('')
    try {
      const overrides = customizationType === 'partial'
        ? buildPartialOverride(baseRisk, draft)
        : buildCompleteOverride(draft)
      await saveOverride(baseRisk.risk_id, selectedDestinationId, { overrides, is_active: true })
      setNotice(hasOverride ? 'Override updated successfully.' : 'Override saved successfully.')
      await refreshAfterMutation()
    } catch {
      setError('Unable to save this destination override. Please try again.')
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!baseRisk || !selectedDestinationId || resetting) return
    if (!window.confirm('Reset this destination to the base risk?')) return
    setResetting(true)
    setError('')
    try {
      await deleteOverride(baseRisk.risk_id, selectedDestinationId)
      setNotice('Destination reset to the base risk.')
      await refreshAfterMutation()
    } catch {
      setError('Unable to reset this destination to the base risk. Please try again.')
    } finally {
      setResetting(false)
    }
  }

  const applyDraftJson = () => {
    if (!baseRisk) return
    try {
      const parsed = normalizeRisk(JSON.parse(draftJson))
      updateDraft(hydrateOverrideDraft(baseRisk, buildCompleteOverride(parsed)))
      setNotice('Override JSON applied.')
    } catch (applyError) {
      setJsonError(applyError instanceof Error ? applyError.message : 'Invalid override JSON.')
    }
  }

  const applyMetadata = () => {
    if (!draft) return
    try {
      const parsed = JSON.parse(metadataText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Metadata must be a JSON object.')
      updateDraft({ ...draft, metadata: parsed })
    } catch (metadataParseError) {
      setMetadataError(metadataParseError instanceof Error ? metadataParseError.message : 'Invalid metadata JSON.')
    }
  }

  const selectCompleteStart = (source: 'base' | 'blank') => {
    if (!baseRisk) return
    updateDraft(source === 'base' ? cloneRisk(baseRisk) : createBlankCustomizationDraft(baseRisk))
  }

  const canSave = Boolean(baseRisk && draft && selectedDestinationId && !loadingOverride && !saving && !resetting && !jsonError && !metadataError)

  return <div className="space-y-5">
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Destination setup</p>
        <h3 className="mt-1 text-lg font-bold text-slate-950">Customize an existing risk</h3>
        <p className="mt-1 text-sm text-slate-500">Choose the client, base risk, and Teams or Slack destination in order.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Client</span><select aria-label="Client" className={inputClass} value={selectedClientId} disabled={loadingInitial || saving || resetting} onChange={event => { void handleClientChange(event.target.value) }}><option value="">Select client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Existing Risk</span><select aria-label="Existing Risk" className={inputClass} value={selectedRiskId} disabled={!selectedClientId || loadingInitial || loadingRisk || saving || resetting} onChange={event => { void handleRiskChange(event.target.value) }}><option value="">Select risk</option>{risks.map(risk => <option key={risk.risk_id} value={risk.risk_id}>{riskLabel(risk)}</option>)}</select></label>
        <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Destination</span><select aria-label="Destination" className={inputClass} value={selectedDestinationId} disabled={!selectedClientId || !baseRisk || loadingDestinations || loadingRisk || saving || resetting} onChange={event => handleDestinationChange(event.target.value)}><option value="">Select destination</option>{destinations.map(destination => <option key={destination.destination_id} value={destination.destination_id}>{destinationLabel(destination)}</option>)}</select></label>
      </div>
      {selectedDestination && <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600"><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-bold">{selectedDestination.platform === 'teams' ? 'Teams' : 'Slack'}</span><span>{destinationLabel(selectedDestination)}</span></div>}
      {(!baseRisk || !selectedDestinationId) && <div className="mt-4 flex justify-end"><button type="button" className={primaryButtonClass} disabled>Save Override</button></div>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
    </section>

    {selectedRiskId && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Destination Customizations</p><h3 className="mt-1 text-sm font-bold text-slate-900">Active overrides for this risk</h3></div>{loadingRisk && <Loader2 className="size-4 animate-spin text-slate-400" />}</div>
      {!loadingRisk && overrideSummaries.length === 0 && <p className="mt-3 text-sm text-slate-500">No active destination customizations.</p>}
      {overrideSummaries.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{overrideSummaries.map(summary => {
        const matchingDestination = destinations.find(destination => destination.destination_id === summary.destination_id)
        const label = matchingDestination
          ? destinationLabel(matchingDestination)
          : summary.platform
            ? destinationLabel({ ...summary, platform: summary.platform })
            : `Destination · ${summary.destination_id}`
        return <button key={summary.destination_id} type="button" className={buttonClass} disabled={!matchingDestination} aria-label={label} onClick={() => handleDestinationChange(summary.destination_id)}>{label}</button>
      })}</div>}
    </section>}

    {baseRisk && selectedDestinationId && <>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Customization</p><div className="mt-1 flex items-center gap-2"><h3 className="text-lg font-bold text-slate-950">Override editor</h3>{loadingOverride ? <Loader2 className="size-4 animate-spin text-slate-400" /> : <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${hasOverride ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{hasOverride ? 'Active override' : 'No active override'}</span>}</div></div><div className="flex flex-wrap gap-2"><button type="button" className={editorMode === 'form' ? primaryButtonClass : buttonClass} onClick={() => setEditorMode('form')}>Override Form</button><button type="button" className={editorMode === 'json' ? primaryButtonClass : buttonClass} onClick={() => { if (draft) setDraftJson(JSON.stringify(draft, null, 2)); setEditorMode('json') }}>Override JSON</button></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Customization Type</span><select aria-label="Customization Type" className={inputClass} value={customizationType} onChange={event => setCustomizationType(event.target.value as CustomizationType)}><option value="partial">Partial Override</option><option value="complete">Complete Override</option></select></label>
          {customizationType === 'complete' && <div className="flex items-end gap-2"><button type="button" className={buttonClass} onClick={() => selectCompleteStart('base')}>Start from Base</button><button type="button" className={buttonClass} onClick={() => selectCompleteStart('blank')}>Start Blank</button></div>}
        </div>
      </section>

      {draft && editorMode === 'form' && <div className="grid items-start gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Title</span><input aria-label="Title" className={inputClass} value={draft.title} onChange={event => updateDraft({ ...draft, title: event.target.value })} /></label><label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Severity</span><select aria-label="Severity" className={inputClass} value={draft.severity} onChange={event => updateDraft({ ...draft, severity: event.target.value as Risk['severity'], severity_label: event.target.value })}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option></select></label><label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-slate-500">Subtitle</span><input aria-label="Subtitle" className={inputClass} value={draft.subtitle} onChange={event => updateDraft({ ...draft, subtitle: event.target.value })} /></label><label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-slate-500">Summary</span><textarea aria-label="Summary" className={`${inputClass} min-h-24 resize-y`} value={draft.summary} onChange={event => updateDraft({ ...draft, summary: event.target.value })} /></label><label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-slate-500">Metadata JSON</span><textarea aria-label="Metadata JSON" className={`${inputClass} min-h-32 font-mono text-xs`} value={metadataText} onChange={event => setMetadataText(event.target.value)} onBlur={applyMetadata} />{metadataError && <span className="text-xs text-red-600">{metadataError}</span>}</label></div></section>
          <GenericViewsEditor views={draft.views} onChange={views => updateDraft({ ...draft, views })} />
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-20"><p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Override editor preview</p><Preview risk={draft} /></section>
      </div>}

      {draft && editorMode === 'json' && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Override JSON</h3><p className="mt-1 text-xs text-slate-500">Protected identity fields are removed from the saved override payload.</p></div><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${jsonError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{jsonError ? 'Invalid JSON' : 'Valid JSON'}</span></div><textarea aria-label="Override JSON editor" className="mt-4 min-h-[480px] w-full rounded-lg border border-slate-800 bg-[#17202b] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:ring-2 focus:ring-slate-300" value={draftJson} onChange={event => setDraftJson(event.target.value)} spellCheck={false} />{jsonError && <p className="mt-2 text-xs text-red-600">{jsonError}</p>}<button type="button" className={`${primaryButtonClass} mt-3`} onClick={applyDraftJson}>Apply Override JSON</button></section>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-slate-900">Override payload</h3><p className="mt-1 text-xs text-slate-500">Arrays are sent as complete replacement values. The backend performs final resolution.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={primaryButtonClass} disabled={!canSave} onClick={() => { void handleSave() }}>{saving && <Loader2 className="size-3.5 animate-spin" />}{saving ? 'Saving...' : hasOverride ? 'Update Override' : 'Save Override'}</button>{hasOverride && <button type="button" className={`${buttonClass} border-red-200 text-red-600 hover:bg-red-50`} disabled={resetting || saving} onClick={() => { void handleReset() }}>{resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{resetting ? 'Resetting...' : 'Reset to Base'}</button>}</div></div><pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-200">{JSON.stringify({ overrides: payloadPreview, is_active: true }, null, 2)}</pre></section>

      <div className="grid items-start gap-5 lg:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Base Risk</p><Preview risk={baseRisk} /></section><section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Resolved Risk</p>{loadingResolved && <Loader2 className="size-3.5 animate-spin text-slate-400" />}</div>{resolvedRisk ? <Preview risk={resolvedRisk} /> : <div className="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-sm text-slate-500">{loadingResolved ? 'Loading backend resolved risk...' : 'Select a destination to load its resolved risk.'}</div>}</section></div>
    </>}

    {!baseRisk && !loadingRisk && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">Select a client and existing risk to begin customization.</div>}
    {loadingRisk && <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-12 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Loading base risk...</div>}
  </div>
}
