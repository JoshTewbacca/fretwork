// Minus / value / plus stepper, shared by the track list (capo, transpose),
// the View panel (zoom), the note editor and Settings.
interface StepperProps {
  /** Visible legend above the control. Empty when the surrounding row already
   *  carries a label; pass `ariaLabel` in that case. */
  label: string
  value: number
  min: number
  max: number
  /** Increment size; defaults to 1. */
  step?: number
  onChange: (value: number) => void
  /** Custom rendering for the value, e.g. "+3" or "120%". */
  format?: (value: number) => string
  /** What the buttons announce. Defaults to `label`. */
  ariaLabel?: string
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  ariaLabel,
}: StepperProps) {
  const display = format ? format(value) : String(value)
  const name = ariaLabel || label

  return (
    <div class="stepper">
      <span class="stepper__label">{label}</span>
      <div class="stepper__controls">
        <button
          type="button"
          class="stepper__button"
          disabled={value <= min}
          aria-label={`Decrease ${name}`}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          &minus;
        </button>
        <span class="stepper__value">{display}</span>
        <button
          type="button"
          class="stepper__button"
          disabled={value >= max}
          aria-label={`Increase ${name}`}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  )
}
