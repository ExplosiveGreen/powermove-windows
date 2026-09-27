<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import '../controls/search-picker.css';
  import { relativeOpened } from '../panels/agent/threads';
  let { anchor, projects, currentId, onchoose, onclose }: {
    anchor: HTMLElement; projects: Array<{ id: string; name: string; updatedAt?: number }>;
    currentId?: string; onchoose: (id: string) => Promise<void>; onclose: () => void;
  } = $props();
  let query = $state(''), pending = $state(false), error = $state('');
  let popup: HTMLDivElement, search: HTMLInputElement, glider: HTMLDivElement;
  let left = $state(0), top = $state(0), width = $state(248), maxHeight = $state(360);
  let side = $state<'top' | 'bottom'>('bottom');
  let closing = false, gliderOn = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const openedAt = Date.now();
  const matches = $derived(projects.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase())));
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
    try { await onchoose(id); dismiss(false); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not open this project.'; }
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
    void tick().then(() => { if (closing) return; place(); popup.dataset.state = 'open'; search.focus(); });
    const outside = (e: PointerEvent) => { if (!popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) dismiss(false); };
    const scroll = (e: Event) => { if (!popup.contains(e.target as Node)) dismiss(false); };
    const leave = () => dismiss(false);
    document.addEventListener('pointerdown',outside,true); document.addEventListener('scroll',scroll,true);
    window.addEventListener('resize',leave); window.addEventListener('blur',leave);
    return () => { document.removeEventListener('pointerdown',outside,true); document.removeEventListener('scroll',scroll,true); window.removeEventListener('resize',leave); window.removeEventListener('blur',leave); };
  });
  onDestroy(() => { clearTimeout(closeTimer); popup?.removeEventListener('animationend',finish); });
</script>
<div class="pm-menu thread-popup" bind:this={popup} role="dialog" aria-label="Open in project" tabindex="-1" onkeydown={key} data-side={side} style:left={`${left}px`} style:top={`${top}px`} style:width={`${width}px`} style:max-height={`${maxHeight}px`}>
  <input class="thread-search" bind:this={search} bind:value={query} oninput={rest} placeholder="Search projects…" aria-label="Search projects" autocomplete="off" spellcheck="false" />
  <div class="thread-list" role="listbox" aria-label="Projects" tabindex="-1" onpointerleave={rest} onpointermove={(event) => { const row = (event.target as HTMLElement).closest<HTMLElement>('.thread-row'); if (row) glideTo(row); }}>
    <div class="pm-menu-glider thread-glider" bind:this={glider} aria-hidden="true"></div>
    {#each matches as project (project.id)}
      <div class="thread-row" class:current={project.id === currentId} role="option" tabindex="-1" aria-selected={project.id === currentId} aria-disabled={pending} onfocus={(event) => glideTo(event.currentTarget)} onclick={() => void choose(project.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(project.id); } }}>
        <span class="thread-row-text"><span class="thread-row-title">{project.name}</span><span class="thread-row-meta" class:current={project.id === currentId}>{project.id === currentId ? 'Current' : project.updatedAt ? relativeOpened(project.updatedAt,openedAt) : 'Saved project'}</span></span>
      </div>
    {:else}<p class="thread-empty">{projects.length ? `No projects match “${query.trim()}”.` : 'Create a project first to use this extension.'}</p>{/each}
  </div>
  {#if error}<p class="thread-empty" role="alert">{error}</p>{/if}
</div>
