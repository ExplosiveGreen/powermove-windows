/* A project shaped like a real heavy one (~1.5 MB of JSON: ~1.3 MB of layers
   with keyframed properties, an edit log, a few assets), for data-plane cost
   tests. Deterministic, so sizes and timings compare across runs. */
const CHANNELS = ['perspective', 'position.x', 'position.y', 'position.z', 'anchor.x', 'anchor.y', 'anchor.z', 'scale.x', 'scale.y', 'scale.z',
  'rotation', 'rotation.x', 'rotation.y', 'orientation.x', 'orientation.y', 'orientation.z', 'opacity', 'skew'];

export function syntheticProject(layerCount = 540, editCount = 250): Record<string, any> {
  let seed = 1;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const key = (index: number) => ({ t: index * 0.6, v: random() * 1000, i: `k${index}${Math.floor(random() * 1e6)}`, outInterp: 'bezier',
    outEase: { speed: random() * -500, influence: random() * 100 }, inInterp: 'linear', inEase: { speed: 0, influence: 33.333333333333336 }, autoBezier: false, continuous: false });
  const layers = Array.from({ length: layerCount }, (_, index) => ({
    id: `L${index.toString(36).padStart(7, '0')}`, type: index % 3 ? 'shape' : 'text', name: `Layer ${index}`, from: random() * 20, dur: 10 + random() * 60,
    on: true, lock: false, shy: false, collapsed: true, color: '#E8E2CF', blend: 'normal', mblur: false, parent: null,
    p: Object.fromEntries(CHANNELS.map((channel, slot) => [channel, { v: random() * 100, kf: slot < 2 ? [key(0), key(1)] : [], expr: null }])),
    fx: [], transitionIn: null, transitionOut: null, masks: [],
    d: { text: `Line ${index}`, font: 'Inter', size: 48, tracking: 0, fill: '#ffffff' }
  }));
  const edits = Array.from({ length: editCount }, (_, index) => ({
    id: `edit${index}`, revision: 1000 + index, at: 1_789_674_435_208 + index, origin: 'inspector', label: 'Set property',
    summary: [`set_property · L${index} · position.x`],
    operations: Array.from({ length: 6 }, (_, op) => ({ type: 'set_property', target: `L${index}`, path: `p.position.x.${op}`, value: random() * 1000, time: random() * 20, preserveHandEdits: false }))
  }));
  const assets = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`a${index}`, {
    id: `a${index}`, name: `clip-${index}.mp4`, kind: 'video', fingerprint: `v2:${index}`, storageKey: `media:v2:${index}`,
    sourcePath: `/Users/someone/Movies/clip-${index}.mp4`, blob: `blob:app://powermove/${index}`, size: 4_226_012, dur: 188.05
  }]));
  return {
    id: 'Psynthetic', name: 'Synthetic', w: 1920, h: 1080, fps: 30, dur: 90, bg: '#000000', layers, comps: {}, assets, markers: [],
    work: { in: 0, out: 90 }, params: {}, revision: 4, edits, created: 1_789_000_000_000, shutter: 180,
    library: { apiToken: 'secret', items: [] }, notes: 'Notes'
  };
}
