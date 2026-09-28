import { describe, expect, it, vi } from 'vitest';

import { createKernel } from '../kernel/registries';
import { paletteEntries } from './palette-model';

function model(kernel = createKernel()) {
  return {
    Kernel: kernel,
    commands: {
      undo: { id: 'undo', label: 'Undo', cat: 'Edit', run: () => {} },
      hidden: { id: 'hidden', label: 'Hidden', cat: 'Edit', when: () => false, run: () => {} }
    },
    cmd: vi.fn(),
    proj: { layers: [] },
    WS: { list: () => [] },
    FX: {},
    kernel
  } as any;
}

describe('palette entries with kernel contributions', () => {
  it('skips commands whose when() is false', () => {
    const entries = paletteEntries(model(), '');
    expect(entries.map((entry) => entry.id)).toEqual(['command:undo']);
  });

  it('appends provider entries after the legacy groups', () => {
    const PM = model();
    PM.Kernel.registerPaletteProvider('ext:notes', () => [
      { id: 'note:1', label: 'Open scratchpad', category: 'Notes', kb: '⌘J', run: () => 'opened' }
    ]);

    const entries = paletteEntries(PM, '');

    expect(entries.map((entry) => entry.id)).toEqual(['command:undo', 'note:1']);
    expect(entries[1]).toMatchObject({ label: 'Open scratchpad', cat: 'Notes', kb: '⌘J' });
    expect(entries[1]!.run()).toBe('opened');
  });

  it('passes the raw query through to the provider', () => {
    const PM = model();
    const provider = vi.fn(() => []);
    PM.Kernel.registerPaletteProvider('ext:notes', provider);

    paletteEntries(PM, '  Note ');

    expect(provider).toHaveBeenCalledWith('  Note ');
  });

  it('merges several providers in registration order', () => {
    const PM = model();
    PM.Kernel.registerPaletteProvider('a', () => [{ id: 'a:1', label: 'A', category: 'A', run: () => {} }]);
    PM.Kernel.registerPaletteProvider('b', () => [{ id: 'b:1', label: 'B', category: 'B', run: () => {} }]);

    expect(paletteEntries(PM, '').map((entry) => entry.id)).toEqual(['command:undo', 'a:1', 'b:1']);
  });

  it('ignores a provider that throws or returns something that is not a list', () => {
    const PM = model();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    PM.Kernel.registerPaletteProvider('bad', () => { throw new Error('nope'); });
    PM.Kernel.registerPaletteProvider('worse', (() => null) as never);

    expect(paletteEntries(PM, '').map((entry) => entry.id)).toEqual(['command:undo']);
    error.mockRestore();
  });

  it('keeps provider entries inside the 60-item cap', () => {
    const PM = model();
    PM.commands = Object.fromEntries(
      Array.from({ length: 59 }, (_, index) => [`c${index}`, { id: `c${index}`, label: `C${index}`, cat: 'Command', run: () => {} }])
    );
    PM.Kernel.registerPaletteProvider('many', () => Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, label: `P${index}`, category: 'Ext', run: () => {} })));

    const entries = paletteEntries(PM, '');

    expect(entries).toHaveLength(60);
    expect(entries.filter((entry) => entry.cat === 'Ext')).toHaveLength(1);
  });

  it('lands an asynchronous provider in place, after the rows that answered at once', async () => {
    const PM = model();
    PM.Kernel.registerPaletteProvider('sandboxed', async (query: string) => [{ id: `s:${query}`, label: 'Sandboxed', category: 'Ext', run: () => {} }]);
    PM.Kernel.registerPaletteProvider('trusted', () => [{ id: 't:1', label: 'Trusted', category: 'Ext', run: () => {} }]);
    const late = vi.fn();

    const now = paletteEntries(PM, '', late);

    expect(now.map((entry) => entry.id)).toEqual(['command:undo', 't:1']);
    await vi.waitFor(() => expect(late).toHaveBeenCalledOnce());
    expect(late.mock.calls[0]![0].map((entry: { id: string }) => entry.id)).toEqual(['command:undo', 's:', 't:1']);
  });

  it('keeps a command whose when() answers later at its place, only if it answers true', async () => {
    const PM = model();
    PM.commands = {
      first: { id: 'first', label: 'First', cat: 'A', run: () => {} },
      shown: { id: 'shown', label: 'Shown later', cat: 'A', when: async () => true, run: () => {} },
      hidden: { id: 'hidden', label: 'Hidden later', cat: 'A', when: async () => false, run: () => {} },
      last: { id: 'last', label: 'Last', cat: 'A', run: () => {} }
    };
    const late = vi.fn();

    expect(paletteEntries(PM, '', late).map((entry) => entry.id)).toEqual(['command:first', 'command:last']);
    await vi.waitFor(() => expect(late).toHaveBeenCalledTimes(2));
    expect(late.mock.calls[1]![0].map((entry: { id: string }) => entry.id)).toEqual(['command:first', 'command:shown', 'command:last']);
  });

  it('asks when() only of commands that match the query', () => {
    const PM = model();
    const when = vi.fn(() => true);
    PM.commands = { other: { id: 'other', label: 'Other', cat: 'A', when, run: () => {} } };

    paletteEntries(PM, 'undo');

    expect(when).not.toHaveBeenCalled();
  });

  it('drops provider entries with no run function', () => {
    const PM = model();
    PM.Kernel.registerPaletteProvider('sloppy', () => [{ id: 'x', label: 'X' }] as never);

    expect(paletteEntries(PM, '').map((entry) => entry.id)).toEqual(['command:undo']);
  });
});
