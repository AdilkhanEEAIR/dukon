// Число «набегает» при первом показе. Редкое событие (открыли экран) — можно позволить 600 мс;
// при «меньше движения» сразу конечное значение. Ширина цифр одинаковая, поэтому строка не дёргается.

import { useCountUp } from '../hooks/useCountUp'

export function CountUp({ value, format = (n) => String(Math.round(n)), className, testId }: { value: number; format?: (n: number) => string; className?: string; testId?: string }) {
  const shown = useCountUp(value)
  return (
    <span className={className} data-testid={testId} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  )
}
