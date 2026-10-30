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
  /** Модель не уверена или считала без рамок — хозяину стоит взглянуть самому. */
  needs_review?: boolean
}

/** Что Muse Spark велел искать SAM на этом фото и сколько рамок дало каждое слово. */
export interface Concept {
  query: string
  label: string
  boxes: number
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
  /** Откуда штуки: рамки SAM, подсчёт Spark без рамок или ничего не найдено. */
  evidence?: 'boxes' | 'model_count' | 'none'
  concepts?: Concept[]
  price_tags?: Box[]
  seconds?: number
  /** Когда снято (из EXIF); обход датируется съёмкой, а не загрузкой. */
  taken_at?: string | null
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
  /** Точка на карте; нет — магазин на карте не показывается. */
  lat?: number | null
  lng?: number | null
}

export interface GeoPoint {
  lat: number
  lng: number
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
  /** Скорость ещё не измерена: потери и заказ — оценка (выкладка расходится за неделю). */
  estimated?: boolean
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
  /** Между обходами меньше шести часов: статусы есть, скорость не меряется, потери — оценка. */
  too_soon?: boolean
  /** Хоть одна позиция посчитана по допущению, а не по измеренной скорости. */
  estimated?: boolean
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
  agent_steps_today?: number
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
  /** Голос работает только с ключом моделей: без него кнопка микрофона использует распознавание браузера. */
  voice_enabled?: boolean
  models?: { vision: string; reader: string; agent: string; voice: string }
}

// ---- заказы, поставщики, правила, агент (заходы 3–4). Схемы: backend/app/domain/schemas.py

export type Category = 'drinks' | 'dairy' | 'snacks' | 'bread' | 'grocery'

export interface Discount {
  min_units: number
  pct: number
}

export interface Supplier {
  id: string
  name: string
  /** Название для нерусского интерфейса (английское). */
  name_en?: string
  categories: Category[]
  contact: string
  phone: string
  /** 0 — понедельник … 6 — воскресенье. */
  delivery_days: number[]
  min_order_kgs: number
  pack_size: number
  discounts: Discount[]
  out_of_stock: string[]
}

export interface Rules {
  max_order_total_kgs: number
  max_stock_days: number
  max_line_units: number
  no_dairy_on: number[]
  banned_suppliers: string[]
  min_discount_for_upsize_pct: number
}

export type RuleName = 'banned_supplier' | 'max_line_units' | 'max_stock_days' | 'min_discount_for_upsize' | 'no_dairy_on' | 'max_order_total'

export interface Violation {
  rule: RuleName
  message: string
  sku: string | null
  limit: number | null
  actual: number | null
  fix: string
}

export interface DraftLine {
  sku: string
  name: string
  qty: number
  unit_price: number | null
  suggested: number
  on_hand: number
  velocity_per_day: number
  category: Category
}

export interface SupplierDraft {
  supplier_id: string
  supplier_name: string
  supplier_name_en?: string
  lines: DraftLine[]
  total: number
  delivery_day: number | null
  discount_pct: number
  notes: string[]
}

export interface DraftsResponse {
  walk_id: string
  shop_id: string | null
  drafts: SupplierDraft[]
  total: number
  rules: Rules
}

export type AgentEventKind = 'start' | 'thought' | 'tool_call' | 'verifier_ok' | 'verifier_block' | 'supplier_reply' | 'fix' | 'skip' | 'final' | 'error'

export interface DraftPayload {
  supplier_id: string
  supplier_name: string
  supplier_name_en?: string
  delivery_day: number | null
  delivery_day_name: string | null
  discount_pct: number
  total: number
  lines: { sku: string; name: string; qty: number; unit_price: number | null; sum: number }[]
}

export interface SupplierReplyPayload {
  message: string
  accepted: { sku: string; name: string; qty: number }[]
  rejected: { sku: string; name: string }[]
  discount_pct: number
  delivery_day: number | null
  min_order_ok: boolean
  offers: Discount[]
}

export interface AgentEvent {
  step: number
  kind: AgentEventKind
  at: string
  text: string
  supplier_id: string | null
  data: {
    tool?: string
    args?: Record<string, unknown>
    status?: string
    violations?: Violation[]
    draft?: DraftPayload
    order?: DraftPayload
    reply?: SupplierReplyPayload
    error?: string
    sku?: string
    name?: string
    [key: string]: unknown
  }
}

export interface AgentResult {
  orders: SupplierDraft[]
  skipped: { sku: string; name: string; reason: string }[]
  total: number
  summary: string
  blocks: number
  fixes: number
}

export type RunSource = 'live' | 'demo' | 'mock'
export type RunStatus = 'running' | 'done' | 'failed'

export interface AgentRun {
  id: string
  created_at: string
  walk_id: string
  shop_id: string | null
  source: RunSource
  status: RunStatus
  model: string
  steps: number
  events: AgentEvent[]
  result: AgentResult | null
  error: string | null
}

export interface Order {
  id: string
  created_at: string
  shop_id: string | null
  walk_id: string
  run_id: string | null
  supplier_id: string
  supplier_name: string
  supplier_name_en?: string
  lines: DraftLine[]
  total: number
  delivery_day: number | null
  status: 'approved' | 'sent'
  message: string
  whatsapp_url: string
}

export type ChatAction = { type: 'update_rules'; rules?: Rules; patch?: Partial<Rules> } | { type: 'start_run' }

export interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  at: string
  action?: ChatAction | null
  /** Язык ответа — язык вопроса, а не интерфейса; им же озвучиваем. */
  lang?: string | null
}

export interface ChatOut {
  reply: ChatMessage
  rules: Rules | null
}

export interface Transcript {
  text: string
  duration_ms: number
  model: string
  at: string
}
