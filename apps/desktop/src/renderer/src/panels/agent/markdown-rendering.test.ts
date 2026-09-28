// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Markdown from './Markdown.svelte';

const openExternal = vi.fn();
vi.mock('../../kernel/bridge', () => ({ bridge: () => ({ openExternal }) }));
let instance: ReturnType<typeof mount>;
let target: HTMLDivElement;
afterEach(() => { if (instance) unmount(instance); target?.remove(); vi.clearAllMocks(); });
function render(text: string, props = {}) {
  target = document.createElement('div'); document.body.append(target);
  instance = mount(Markdown, { target, props: { text, ...props } }); flushSync();
}
it('escapes HTML and keeps unsafe links and images inert', () => {
  render('<script>alert(1)</script> [unsafe](javascript:alert(1)) ![image](https://example.com/image.png)');
  expect(target.querySelector('script, img')).toBeNull();
  expect(target.textContent).toContain('<script>alert(1)</script>');
  expect([...target.querySelectorAll('a')].map(el => el.href)).toEqual(['https://example.com/image.png']);
});
it('opens safe links through the desktop bridge and preserves italic styling', () => {
  render('*[Guide](https://example.com/guide)*');
  const link = target.querySelector('a')!;
  expect(link.classList.contains('is-italic')).toBe(true);
  link.click();
  expect(openExternal).toHaveBeenCalledWith('https://example.com/guide');
});
it('renders option formatting without nesting interactive links inside buttons', () => {
  render('**[Choose](https://example.com)**', { inline: true, links: false });
  expect(target.querySelector('a, p')).toBeNull();
  expect(target.querySelector('.is-bold')?.textContent).toBe('Choose');
});
