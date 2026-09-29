/** Stable axis colors: changing selection must never change an axis's identity. */
export function graphAxisColor(key: string, index = 0): string {
  if (key.endsWith('.x')) return '#f36870';
  if (key.endsWith('.y')) return '#84cb78';
  if (key.endsWith('.z')) return '#6fa7ec';
  return ['#dddfe3', '#d6ac68', '#ae8cdd', '#65beb5'][index % 4]!;
}

export function graphValueTicks(min: number, max: number, height: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const rough = (max - min) / Math.max(2, Math.floor(height / 44));
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find(n => n * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i <= Math.floor(max / step) && ticks.length < 100; i++) {
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
}

export function graphKeyShape(key: { hold?: boolean; inInterp?: string; outInterp?: string }): 'hold' | 'bezier' | 'linear' {
  if (key.hold || key.outInterp === 'hold') return 'hold';
  return key.inInterp === 'bezier' || key.outInterp === 'bezier' ? 'bezier' : 'linear';
}

export function graphPlotTop(ruler: number, height: number, combined: boolean, ratio = .38): number {
  return combined ? ruler + Math.max(48, (height - ruler) * Math.max(.2, Math.min(.65, ratio))) : ruler;
}
