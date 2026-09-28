/* A rune module (compiled with compileModule): state every importer shares. */
export const counter = $state({ count: 0 });

export function increment(): void {
  counter.count += 1;
}
