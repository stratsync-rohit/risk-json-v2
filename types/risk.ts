export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type BlockType = 'text' | 'callout' | 'metrics' | 'key_value' | 'bullet_list' | 'numbered_list' | 'table' | 'action_list' | 'divider'
export type GenericItem = Record<string, unknown>
export interface RiskBlock { type: BlockType; title?: string; text?: string; status?: string; bold?: boolean; subtle?: boolean; columns?: number | string[] | Array<{key:string;label:string}>; items?: GenericItem[] | string[]; rows?: Array<Record<string, unknown> | unknown[]>; uiId?: string; [key:string]: unknown }
export interface RiskView { title?: string; subtitle?: string; action_label?: string; blocks: RiskBlock[] }
export interface RiskViews { notification: RiskView; details: RiskView; mitigation: RiskView }
export interface RiskSender { name: string; source: string; risk_id: string; timestamp: string; time?: string; context?: string }
export interface RiskEntity { type: string; id: string; name: string; secondary?: RiskEntity }
export interface Risk { schema_version: 2; risk_id: string; industry_slug: string; industry_name: string; title: string; severity: Severity; severity_label: string; subtitle: string; summary: string; sender: RiskSender; entity: RiskEntity; views: RiskViews; metadata?: Record<string, unknown>; is_active: boolean; status: string; _id?: string; created_at?: string; updated_at?: string; metrics?: any[]; details?: any; mitigation?: any; actions?: any[]; sku?: string; product?: string; impact?: string[]; alert?: any; assign?: any; detected_time?: string }
export type RiskDraft = Risk
export type RiskMetric = any
export type RiskDetailItem = any
export type MitigationStep = any
export type RiskMitigation = any
