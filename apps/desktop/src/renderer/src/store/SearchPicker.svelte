<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import '../controls/search-picker.css';
  export interface SearchPickerItem { id: string; title: string; meta?: string; current?: boolean }
  let { anchor, items, placeholder, label, emptyNone, onchoose, onclose, closeOnChoose = false }: {
    anchor: HTMLElement; items: SearchPickerItem[];
    placeholder: string; label: string; emptyNone: string;
    onchoose: (id: string) => Promise<void>; onclose: () => void;
    closeOnChoose?: boolean;
  } = $props();
  let query = $state(''), pending = $state(false), error = $state('');
  let popup: HTMLDivElement, search: HTMLInputElement, glider: HTMLDivElement;
  let left = $state(0), top = $state(0), width = $state(248), maxHeight = $state(360);
  let side = $state<'top' | 'bottom'>('bottom');
  let closing = false, gliderOn = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const matches = $derived(items.filter(i => i.title.toLowerCase().includes(query.trim().toLowerCase())));
  function finish() { onclose(); }
  export function dismiss(focus = true) {
    if (closing) return;
    closing = true;
    if (focus) anchor.focus({preventScroll:true});
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    popup.dataset.state = 'closed';
    popup.addEventListener('animationend', finish, {once:true});
    closeTimer = setTimeout(finish, 200);
  }
  async function choose(id: string) {
    if (pending || closing) return;
    pending = true; error = '';
    try {
      if (closeOnChoose) {
        // Hand focus back before the next sheet records its return target.
        closing = true;
        anchor.focus({preventScroll:true});
        finish();
      }
      await onchoose(id);
      if (!closing) dismiss(false);
    }
    catch (e) { if (!closing) error = e instanceof Error ? e.message : 'Could not open this.'; }
    finally { pending = false; }
  }
  function rest() { glider?.classList.remove('on'); gliderOn = false; }
  function glideTo(row: HTMLElement) {
    if (!gliderOn) glider.style.transition = 'none';
    glider.style.transform = `translateY(${row.offsetTop}px)`;
    glider.style.height = `${row.offsetHeight}px`;
    if (!gliderOn) { void glider.offsetHeight; glider.style.transition = ''; }
    gliderOn = true; glider.classList.add('on');
  }
  function step(from: HTMLElement | null, delta: number) {
    const rows = Array.from(popup.querySelectorAll<HTMLElement>('.thread-row'));
    if (!rows.length) return;
    const index = from ? rows.indexOf(from) : -1;
    const next = index < 0 ? (delta > 0 ? 0 : rows.length - 1) : index + delta;
    if (next < 0) { search.focus(); rest(); return; }
    const row = rows[Math.min(next, rows.length - 1)]!;
    row.focus({preventScroll:true}); row.scrollIntoView({block:'nearest'}); glideTo(row);
  }
  function key(event: KeyboardEvent) {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); dismiss(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); step(target.closest('.thread-row'), event.key === 'ArrowDown' ? 1 : -1); }
    if (event.key === 'Enter' && target === search && matches[0]) { event.preventDefault(); void choose(matches[0].id); }
  }
  function place() {
    if (!popup) return;
    const a = anchor.getBoundingClientRect();
    width = Math.min(Math.max(Math.ceil(a.width), 248), window.innerWidth - 16);
    const h = Math.min(popup.offsetHeight || 360,360);
    const below = Math.max(0,window.innerHeight - a.bottom - 14), above = Math.max(0,a.top - 14);
    side = below >= h || below >= above ? 'bottom' : 'top';
    maxHeight = Math.min(360,side === 'bottom' ? below : above);
    top = side === 'bottom' ? a.bottom + 6 : a.top - 6 - Math.min(h,maxHeight);
    left = Math.max(8,Math.min(a.left,window.innerWidth - width - 8));
  }
  onMount(() => {
    void tick().then(() => { if (closing || !popup) return; place(); popup.dataset.state = 'open'; search.focus(); });
    const outside = (e: PointerEvent) => { if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) dismiss(false); };
    const scroll = (e: Event) => { if (!popup.contains(e.target as Node)) dismiss(false); };
    const leave = () => dismiss(false);
    document.addEventListener('pointerdown',outside,true); document.addEventListener('scroll',scroll,true);
    window.addEventListener('resize',leave); window.addEventListener('blur',leave);
    return () => { document.removeEventListener('pointerdown',outside,true); document.removeEventListener('scroll',scroll,true); window.removeEventListener('resize',leave); window.removeEventListener('blur',leave); };
  });
  onDestroy(() => { clearTimeout(closeTimer); popup?.removeEventListener('animationend',finish); });
</script>
<div class="pm-menu thread-popup" bind:this={popup} role="dialog" aria-label={label} tabindex="-1" onkeydown={key} data-side={side} style:left={`${left}px`} style:top={`${top}px`} style:width={`${width}px`} style:max-height={`${maxHeight}px`}>
  <input class="thread-search" bind:this={search} bind:value={query} oninput={rest} {placeholder} aria-label={placeholder} autocomplete="off" spellcheck="false" />
  <div class="thread-list" role="listbox" aria-label={label} tabindex="-1" onpointerleave={rest} onpointermove={(event) => { const row = (event.target as HTMLElement).closest<HTMLElement>('.thread-row'); if (row) glideTo(row); }}>
    <div class="pm-menu-glider thread-glider" bind:this={glider} aria-hidden="true"></div>
    {#each matches as item (item.id)}
      <div class="thread-row" class:current={item.current} role="option" tabindex="-1" aria-selected={item.current === true} aria-disabled={pending} onfocus={(event) => glideTo(event.currentTarget)} onclick={() => void choose(item.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(item.id); } }}>
        <span class="thread-row-text"><span class="thread-row-title">{item.title}</span>{#if item.meta}<span class="thread-row-meta" class:current={item.current}>{item.meta}</span>{/if}</span>
      </div>
    {:else}<p class="thread-empty">{items.length ? `No matches for “${query.trim()}”.` : emptyNone}</p>{/each}
  </div>
  {#if error}<p class="thread-empty" role="alert">{error}</p>{/if}
</div>
