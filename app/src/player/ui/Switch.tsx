// Accessible on/off toggle shared by ToggleRow and LoopControl. Rendered as a
// <button> with aria-pressed rather than a checkbox so it is operable with a
// single click/Enter/Space and reads correctly to assistive tech.
interface SwitchProps {
  label: string
  on: boolean
  onToggle: () => void
}

export function Switch({ label, on, onToggle }: SwitchProps) {
  return (
    <button type="button" class="switch" aria-pressed={on} onClick={onToggle}>
      <span class="switch__label">{label}</span>
      <span class={on ? 'switch__track is-on' : 'switch__track'}>
        <span class="switch__thumb" />
      </span>
    </button>
  )
}
