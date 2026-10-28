// Иллюстрация полки для лендинга: упаковки — простые формы, SAM-рамки появляются одна за другой,
// на каждой — что прочитал Muse Spark. Это единственная «оркестрованная» анимация на странице.

import { useMemo } from 'react'

interface Pack {
  x: number
  y: number
  w: number
  h: number
  fill: string
  label: string
  price: string
  shelf: number
}

const PACKS: Pack[] = [
  { x: 40, y: 58, w: 46, h: 110, fill: '#b3261e', label: 'Coca-Cola 1 л', price: '95', shelf: 0 },
  { x: 92, y: 58, w: 46, h: 110, fill: '#b3261e', label: 'Coca-Cola 1 л', price: '95', shelf: 0 },
  { x: 144, y: 58, w: 46, h: 110, fill: '#b3261e', label: 'Coca-Cola 1 л', price: '95', shelf: 0 },
  { x: 214, y: 74, w: 34, h: 94, fill: '#3b73c9', label: 'Вода Легенда 0.5', price: '40', shelf: 0 },
  { x: 254, y: 74, w: 34, h: 94, fill: '#3b73c9', label: 'Вода Легенда 0.5', price: '40', shelf: 0 },
  { x: 294, y: 74, w: 34, h: 94, fill: '#3b73c9', label: 'Вода Легенда 0.5', price: '40', shelf: 0 },
  { x: 334, y: 74, w: 34, h: 94, fill: '#3b73c9', label: 'Вода Легенда 0.5', price: '40', shelf: 0 },
  { x: 392, y: 66, w: 50, h: 102, fill: '#e38b1f', label: 'Fanta 1 л', price: '95', shelf: 0 },
  { x: 40, y: 212, w: 54, h: 96, fill: '#eef0ea', label: 'Молоко Эльвест 6%', price: '170', shelf: 1 },
  { x: 100, y: 212, w: 54, h: 96, fill: '#eef0ea', label: 'Молоко Эльвест 6%', price: '170', shelf: 1 },
  { x: 236, y: 232, w: 64, h: 76, fill: '#2d8d4a', label: 'Кефир 2.5%', price: '60', shelf: 1 },
  { x: 306, y: 232, w: 64, h: 76, fill: '#2d8d4a', label: 'Кефир 2.5%', price: '60', shelf: 1 },
  { x: 406, y: 224, w: 72, h: 84, fill: '#d9b33a', label: 'Масло 180 г', price: '82', shelf: 1 },
  { x: 40, y: 360, w: 40, h: 88, fill: '#f0a63a', label: 'Cheetos', price: '50', shelf: 2 },
  { x: 86, y: 360, w: 40, h: 88, fill: '#f0a63a', label: 'Cheetos', price: '50', shelf: 2 },
  { x: 132, y: 360, w: 40, h: 88, fill: '#f0a63a', label: 'Cheetos', price: '50', shelf: 2 },
  { x: 178, y: 360, w: 40, h: 88, fill: '#f0a63a', label: 'Cheetos', price: '50', shelf: 2 },
  { x: 262, y: 402, w: 92, h: 46, fill: '#4f8bd6', label: 'Orbit ×24', price: '15', shelf: 2 },
  { x: 400, y: 380, w: 78, h: 68, fill: '#c9a36a', label: 'Хлеб нарезной', price: '40', shelf: 2 },
]

const SHELVES = [174, 314, 454]

export function ShelfArt({ animate = true }: { animate?: boolean }) {
  const boxes = useMemo(() => PACKS.map((p, i) => ({ ...p, delay: 0.9 + i * 0.09 })), [])
  // Пустое место на второй полке — там, где нет молока: первая «дыра», за которую мы и считаем потери.
  return (
    <svg className="shelf-art" viewBox="0 0 540 500" role="img" aria-label="Shelf with detected products" data-testid="shelf-art">
      <defs>
        <linearGradient id="shelfWood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#d7cdb8" />
          <stop offset="1" stopColor="#bfb39a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="540" height="500" fill="var(--surface)" />
      {SHELVES.map((y) => (
        <g key={y}>
          <rect x="20" y={y} width="500" height="10" rx="2" fill="url(#shelfWood)" />
          <rect x="20" y={y + 10} width="500" height="4" fill="#9a8f78" opacity="0.6" />
        </g>
      ))}
      {PACKS.map((p, i) => (
        <g key={i}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="5" fill={p.fill} />
          <rect x={p.x + 6} y={p.y + p.h * 0.35} width={p.w - 12} height={p.h * 0.22} rx="2" fill="#ffffff" opacity="0.85" />
        </g>
      ))}
      {/* пустое место: пунктирный контур там, где должно стоять молоко */}
      <rect x="160" y="212" width="54" height="96" rx="5" fill="none" stroke="var(--out)" strokeWidth="2" strokeDasharray="6 5" opacity="0.85" />
      <g className="box-group">
        {boxes.map((b, i) => (
          <g key={i} style={animate ? { animationDelay: `${b.delay}s` } : undefined}>
            <rect className="box" x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx="6" style={animate ? { animationDelay: `${b.delay}s` } : undefined} />
            <rect className="box-chip" x={b.x - 3} y={b.y - 16} width={Math.max(26, b.price.length * 8 + 14)} height="14" rx="4" style={animate ? { animationDelay: `${b.delay}s` } : undefined} />
            <text className="box-label" x={b.x + 3} y={b.y - 6} style={animate ? { animationDelay: `${b.delay}s` } : undefined}>
              {b.price} с
            </text>
          </g>
        ))}
      </g>
      {animate && <line className="scanline" x1="-20" x2="-20" y1="30" y2="470" />}
    </svg>
  )
}
