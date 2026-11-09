export function weight(kg: number): string {
  const lb = kg * 2.2046226218;
  return lb > 0 && lb < 1 ? `${(lb * 16).toFixed(1)} oz` : `${lb.toFixed(1)} lb`;
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function change(current: number, previous: number, format: (value: number) => string, period = 'previous'): string {
  const delta = current - previous;
  return `${Math.abs(delta) < 0.000001 ? 'No change' : `${delta > 0 ? 'Up' : 'Down'} ${format(Math.abs(delta))}`} vs ${period}`;
}
