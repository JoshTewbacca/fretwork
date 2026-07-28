// Accessible on/off toggle. Rendered as a <button> with aria-pressed rather
// than a checkbox so it is operable with a single click/Enter/Space and reads
// correctly to assistive tech.
//
// `hideLabel` is for rows that already carry a visible label next to the
// switch: the text still reaches assistive tech through aria-label, it just is
// not drawn twice.
interface SwitchProps {
  label: string
  on: boolean
  onToggle: () => void
  hideLabel?: boolean
}

export function Switch({ label, on, onToggle, hideLabel }: SwitchProps) {
  return (
    <button
      type="button"
      class={hideLabel ? 'switch switch--bare' : 'switch'}
      aria-pressed={on}
      aria-label={hideLabel ? label : undefined}
      onClick={onToggle}
    >
      {!hideLabel && <span class="switch__label">{label}</span>}
      <span class={on ? 'switch__track is-on' : 'switch__track'}>
        <span class="switch__thumb" />
      </span>
    </button>
  )
}
