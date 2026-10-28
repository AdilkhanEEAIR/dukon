// Иконки — один набор контурных SVG, те же, что в Figma. Цвет берут из currentColor.

const PATHS: Record<string, string> = {
  home: 'M3 11 12 4l9 7v9h-6v-6H9v6H3z',
  shelf: 'M3 5h18M3 12h18M3 19h18M6 5v7M12 12v7M17 5v7',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
  package: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  chat: 'M4 5h16v11H9l-5 4z',
  back: 'M19 12H5m6-6-6 6 6 6',
  chevron: 'm9 6 6 6-6 6',
  check: 'm5 12 5 5 9-10',
  close: 'M6 6l12 12M18 6 6 18',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17v.5',
  refresh: 'M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2M18 4v4h-4M6 20v-4h4',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 20h16',
  wifiOff: 'M2 9a16 16 0 0 1 20 0M5 13a11 11 0 0 1 14 0M8.5 16.5a6 6 0 0 1 7 0M3 3l18 18',
  tag: 'M3 3h8l10 10-8 8L3 11zM8 8h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1L5.1 6.1l-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 1.7 1l.4 2.6h5l.4-2.6a7 7 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z',
}

export type IconName = keyof typeof PATHS

interface Props {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 20, className, strokeWidth = 1.8 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      data-icon={name}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
