// Minus / value / plus stepper shared by TrackMixer (capo, transpose) and
// DisplayControls (zoom).
interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  /** Increment size; defaults to 1. */
  step?: number
  onChange: (value: number) => void
  /** Custom rendering for the value, e.g. "+3" or "120%". */
  format?: (value: number) => string
}

export function Stepper({ label, value, min, max, step = 1, onChange, format }: StepperProps) {
  const display = format ? format(value) : String(value)

  return (
    <div class="stepper">
      <span class="stepper__label">{label}</span>
      <div class="stepper__controls">
        <button
          type="button"
          class="stepper__button"
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          &minus;
        </button>
        <span class="stepper__value">{display}</span>
        <button
          type="button"
          class="stepper__button"
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  )
}
