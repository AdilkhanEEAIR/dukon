// Типы повторяют схемы сервера (backend/app/domain/schemas.py). Менять парой.

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
  confidence: number | null
}

export interface ShelfItem {
  sku: string
  name: string
  count: number
  price: number | null
  price_text: string
  boxes: Box[]
  confidence: number
}

export interface Shelf {
  index: number
  items: ShelfItem[]
  empty_slots: number
}

export interface PhotoAnalysis {
  photo_id: string
  width: number
  height: number
  shelves: Shelf[]
  model_calls: number
  notes: string[]
}

export type WalkSource = 'live' | 'demo' | 'upload'

export interface Walk {
  id: string
  created_at: string
  label: string
  source: WalkSource
  shop_id: string | null
  photos: PhotoAnalysis[]
}

export interface Shop {
  id: string
  name: string
  address: string
  created_at: string
  demo: boolean
}

export interface BranchSummary {
  shop: Shop
  walks: number
  last_walk_id: string | null
  last_walk_at: string | null
  total_items: number
  out_of_stock: number
  low_stock: number
  price_mismatch: number
  loss_per_day: number
}

export type Status = 'out_of_stock' | 'low_stock' | 'price_mismatch' | 'new_item' | 'ok'

export interface ItemChange {
  sku: string
  name: string
  before: number | null
  after: number
  status: Status
  sold: number
  velocity_per_day: number
  days_left: number | null
  price_before: number | null
  price_after: number | null
  loss_per_day: number
  suggested_order: number
  reason: string
}

export interface WalkDiff {
  walk_before_id: string | null
  walk_after_id: string
  hours_between: number
  changes: ItemChange[]
  total_items: number
  changed: number
  out_of_stock: number
  low_stock: number
  price_mismatch: number
  loss_per_day: number
  empty_slots: number
}

export type Mode = 'live' | 'demo'
export type ModeReason = 'no_api_key' | 'daily_budget' | 'billing' | 'auth' | 'rate_limited' | 'network' | 'manual' | 'unknown'

export interface Budget {
  calls_today: number
  calls_limit: number
  calls_left: number
  est_spend_usd: number
  errors_today: number
  last_error: string | null
}

export interface Health {
  status: string
  version: string
  provider: string
  live_enabled: boolean
  mode: Mode
  reason: ModeReason | null
  live_calls_today: number
  live_calls_per_day_total: number
  budget: Budget
}
