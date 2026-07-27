// Hand-drawn line icons for the tab bar. Single stroke, currentColor, no
// external assets.

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.75,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true,
}

export function PlayerIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M7 5.2v13.6l11.3-6.8L7 5.2z" />
    </svg>
  )
}

export function LibraryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 5.4A1.4 1.4 0 0 1 5.4 4H11v16H5.4A1.4 1.4 0 0 1 4 18.6V5.4z" />
      <path d="M13 4h5.6A1.4 1.4 0 0 1 20 5.4v13.2a1.4 1.4 0 0 1-1.4 1.4H13V4z" />
      <path d="M11 4v16" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3v2.6M12 18.4V21M21 12h-2.6M5.6 12H3M18.1 5.9l-1.85 1.85M7.75 16.4l-1.85 1.85M18.1 18.1l-1.85-1.85M7.75 7.6 5.9 5.75" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="M15.4 15.4 20 20" />
    </svg>
  )
}
