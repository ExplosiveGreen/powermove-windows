<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { StoreBridge } from '../../../shared/store-ipc';
  import {
    PUBLISH_LIMITS,
    PUBLISH_TERMS,
    findingKey,
    type PublishPlanDto,
    type PublishProgress,
    type StorePublishResult
  } from '../../../shared/publish';
  import { KINDS, KIND_PLURAL, publishErrorText } from './data';
  import {
    canPublish,
    draftFor,
    findingLabel,
    formFor,
    problemsOf,
    progressText,
    type PublishDraft
  } from './publish-form';
  import { ICON_INPUT_MAX_BYTES, ICON_INPUT_TYPES, prepareIcon, type IconCrop } from './icon-image';
  import IconCropper from './IconCropper.svelte';
  import SandboxCheckStatus from './SandboxCheckStatus.svelte';
  import { SANDBOX_UNAVAILABLE, type SandboxCheckReport, type SandboxCheckState } from './sandbox-check';

  let { plan, bridge, check, onclose, onpublished, onfix }: {
    plan: PublishPlanDto;
    bridge: StoreBridge;
    /** Runs the sandbox check for this extension as it is built now (kernel/sandbox-check.ts). */
    check: () => Promise<SandboxCheckReport>;
    onclose: () => void;
    onfix?: (report: SandboxCheckReport) => Promise<boolean>;
    onpublished: (result: Extract<StorePublishResult, { published: true }>) => void;
  } = $props();

  /* The Export sheet's shape: a fixed title, Settings sections that scroll
     under it (the release, the listing on a first publish, the sandbox check,
     anything the scanner found), the terms, and a pinned footer. Publish
     opens main's native confirmation, which names the exact snapshot; this
     sheet never sees the bytes. Every listing is MIT (PUBLISH_LICENCES). */
  const uid = `publish-${Math.random().toString(36).slice(2, 8)}`;
  const initial = untrack(() => plan);
  let draft = $state<PublishDraft>(draftFor(initial));
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);
  let busy = $state(false);
  let progress = $state<PublishProgress | null>(null);
  let error = $state<string | null>(null);
  let published = $state<Extract<StorePublishResult, { published: true }> | null>(null);
  let iconUrl = $state<string | null>(null);
  let iconError = $state<string | null>(null);
  let iconInput = $state<HTMLInputElement | null>(null);

  /* Required step: the check runs as the sheet opens, and only a clean (or
     full-access, skipped) result lets Publish through. */
  let sandbox = $state<SandboxCheckState>({ status: 'running' });
  let fixing = $state(false);
  async function fixSandbox(): Promise<void> {
    if (!onfix || fixing || busy || sandbox.status !== 'done' || sandbox.report.ok || sandbox.report.skipped) return;
    fixing = true;
    try {
      if (await onfix(sandbox.report)) onclose();
      else error = 'The agent couldn’t start the repair. Try again.';
    } catch { error = 'The agent couldn’t start the repair. Try again.'; }
    finally { fixing = false; }
  }
  let checkRun = 0;
  async function runCheck(): Promise<void> {
    const run = ++checkRun;
    sandbox = { status: 'running' };
    let next: SandboxCheckState;
    try {
      next = { status: 'done', report: await check() };
    } catch {
      next = { status: 'error', message: SANDBOX_UNAVAILABLE };
    }
    if (run === checkRun) sandbox = next;
  }
  $effect(() => { untrack(() => void runCheck()); });

  const problems = $derived(problemsOf(draft, plan));
  const sandboxPassed = $derived(sandbox.status === 'done' && sandbox.report.ok);
  const ready = $derived(canPublish(problems) && sandboxPassed);
  const title = $derived(plan.isFork && plan.firstPublish ? `Publish your version of ${plan.manifest.name}` : plan.firstPublish ? `Publish ${plan.manifest.name}` : `Publish an update to ${plan.listing.name}`);
  const show = (field: string): boolean => attempted || !!touched[field];

  $effect(() => bridge.onPublishProgress((next) => {
    if (next.localId === plan.localId) progress = next;
  }));
  onDestroy(() => {
    if (iconUrl) URL.revokeObjectURL(iconUrl);
  });

  let iconBusy = $state(false);
  /* Any image: prepareIcon crops, resizes and compresses it, and the
     preview shows exactly what will be uploaded. */
  async function chooseIcon(event: Event): Promise<void> {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
    const file = input?.files?.[0];
    if (!input || !file) return;
    input.value = '';
    await useIcon(file);
  }

  /* The drop target is the whole well. Drops are handled here and never
     reach the editor's own file import underneath the sheet. */
  let iconDragDepth = $state(0);
  const hasFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');
  function iconDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    iconDragDepth += 1;
  }
  function iconDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy || iconBusy ? 'none' : 'copy';
  }
  function iconDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.stopPropagation();
    iconDragDepth = Math.max(0, iconDragDepth - 1);
  }
  function iconDrop(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation();
    iconDragDepth = 0;
    if (busy || iconBusy) return;
    const file = [...(event.dataTransfer?.files ?? [])][0];
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) { iconError = 'Drop an image file.'; return; }
    void useIcon(file);
  }

  /* A new image opens the cropper; the icon is made only once it is framed.
     The source and its framing are kept so Crop… can reframe it later. */
  let cropping = $state<{ file: Blob; initial: IconCrop | null } | null>(null);
  let iconSource = $state<{ file: Blob; crop: IconCrop } | null>(null);

  async function useIcon(file: File): Promise<void> {
    iconError = null;
    if (file.size > ICON_INPUT_MAX_BYTES) { iconError = 'Choose an image of 20 MB or smaller.'; return; }
    cropping = { file, initial: null };
  }

  async function applyCrop(crop: IconCrop): Promise<void> {
    if (!cropping || iconBusy) return;
    const { file } = cropping;
    iconError = null;
    iconBusy = true;
    try {
      const icon = await prepareIcon(file, crop);
      if (!icon.ok) {
        iconError = icon.error;
        return;
      }
      if (iconUrl) URL.revokeObjectURL(iconUrl);
      iconUrl = URL.createObjectURL(icon.png);
      draft.iconPng = icon.base64;
      iconSource = { file, crop };
      cropping = null;
    } finally {
      iconBusy = false;
    }
  }

  function cropFailed(message: string): void {
    iconError = message;
    cropping = null;
  }

  function removeIcon(): void {
    if (iconUrl) URL.revokeObjectURL(iconUrl);
    iconUrl = null;
    iconSource = null;
    iconError = null;
    draft.iconPng = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    attempted = true;
    if (busy || !ready) return;
    busy = true;
    error = null;
    progress = null;
    try {
      const result = await bridge.publish({ localId: plan.localId, form: formFor(draft, plan) });
      if (!result.ok) {
        error = publishErrorText(result.error);
        return;
      }
      if (result.value.published) {
        published = result.value;
        onpublished(result.value);
      }
    } catch {
      error = 'Powermove couldn’t publish from this window. Try again.';
    } finally {
      busy = false;
      progress = null;
    }
  }

  function setCategory(event: Event): void {
    const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
    const kind = KINDS.find((candidate) => candidate === value);
    if (kind) draft.category = kind;
  }

  function setVisibility(event: Event): void {
    const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : '';
    if (value === 'public' || value === 'unlisted') draft.visibility = value;
  }
</script>

<div class="pub-sheet" tabindex="-1" data-autofocus>
  {#if published}
    <header class="pub-head">
      <h2>Published {published.coordinate} {published.version}</h2>
      <p>{plan.firstPublish
        ? draft.visibility === 'public' ? 'It’s on the store now, in Discover and search.' : 'It’s on the store now. Anyone with its link can install it.'
        : 'It’s on the store now. People who have it get the update the next time Powermove checks.'}</p>
    </header>
    <footer class="pub-foot">
      <span></span>
      <button class="btn pri" type="button" onclick={onclose}>Done</button>
    </footer>
  {:else}
    <header class="pub-head">
      <h2>{title}</h2>
      {#if plan.isFork && plan.origin}
        <p>Forked from <b>{plan.origin.coordinate}</b> {plan.origin.version}. It goes on the store under your name, linked to the original.</p>
      {:else}
        <p>{plan.coordinate}</p>
      {/if}
    </header>

    <form class="pub-form sg-column" id={`${uid}-form`} novalidate onsubmit={submit}>
      <section class="pub-section">
        <h3 class="pub-title">Release</h3>
        <div class="sg-group pub-group">
          <div class="settings-row pub-row">
            <label class="settings-copy" for={`${uid}-version`}>
              <b>Version</b>
              {#if show('version') && problems.version}
                <span class="pub-problem" id={`${uid}-version-problem`}>{problems.version}</span>
              {:else if plan.lastVersion}
                <span>Last published {plan.lastVersion}</span>
              {:else}
                <span>The number people see on the store.</span>
              {/if}
            </label>
            <input
              id={`${uid}-version`}
              class="pub-input is-short"
              inputmode="decimal"
              autocomplete="off"
              spellcheck="false"
              maxlength="20"
              disabled={busy}
              aria-invalid={show('version') && !!problems.version}
              aria-describedby={show('version') && problems.version ? `${uid}-version-problem` : undefined}
              bind:value={draft.version}
              onblur={() => (touched = { ...touched, version: true })}
            />
          </div>
          <div class="settings-row pub-row is-stacked">
            <label class="settings-copy" for={`${uid}-notes`}>
              <b>What’s new</b>
              <span>{plan.firstPublish ? 'Optional. Shown on the store with this version.' : 'Shown on the store with this version.'}</span>
            </label>
            <textarea
              id={`${uid}-notes`}
              class="pub-input pub-notes"
              rows="3"
              maxlength={PUBLISH_LIMITS.notesChars}
              disabled={busy}
              bind:value={draft.notes}
            ></textarea>
          </div>
        </div>
      </section>

      {#if plan.firstPublish}
        <section class="pub-section">
          <h3 class="pub-title">Listing</h3>
          <div class="sg-group pub-group">
            <div class="settings-row pub-row">
              <label class="settings-copy" for={`${uid}-name`}>
                <b>Name</b>
                {#if show('name') && problems.name}<span class="pub-problem" id={`${uid}-name-problem`}>{problems.name}</span>{:else}<span>How it’s listed on the store.</span>{/if}
              </label>
              <input
                id={`${uid}-name`}
                class="pub-input"
                autocomplete="off"
                maxlength={PUBLISH_LIMITS.nameChars}
                disabled={busy}
                aria-invalid={show('name') && !!problems.name}
                aria-describedby={show('name') && problems.name ? `${uid}-name-problem` : undefined}
                bind:value={draft.name}
                onblur={() => (touched = { ...touched, name: true })}
              />
            </div>
            <div class="settings-row pub-row">
              <label class="settings-copy" for={`${uid}-tagline`}>
                <b>Tagline</b>
                {#if problems.tagline}<span class="pub-problem">{problems.tagline}</span>{:else}<span>One line under the name.</span>{/if}
              </label>
              <input id={`${uid}-tagline`} class="pub-input" autocomplete="off" maxlength={PUBLISH_LIMITS.taglineChars} disabled={busy} bind:value={draft.tagline} />
            </div>
            <div class="settings-row pub-row">
              <label class="settings-copy" for={`${uid}-category`}>
                <b>Kind</b>
                <span>Where it’s filed in Discover.</span>
              </label>
              <select id={`${uid}-category`} class="pub-select" disabled={busy} value={draft.category} onchange={setCategory}>
                {#each KINDS as kind (kind)}<option value={kind}>{KIND_PLURAL[kind]}</option>{/each}
              </select>
            </div>
            <div class="settings-row pub-row">
              <label class="settings-copy" for={`${uid}-visibility`}>
                <b>Visibility</b>
                <span>{draft.visibility === 'public' ? 'Shown in Discover and search.' : 'Only people with the link can find it.'}</span>
              </label>
              <select id={`${uid}-visibility`} class="pub-select" disabled={busy} value={draft.visibility} onchange={setVisibility}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
              </select>
            </div>
            <div class="settings-row pub-row is-stacked">
              <span class="settings-copy">
                <b>Icon</b>
                {#if iconError}<span class="pub-problem" role="alert">{iconError}</span>{:else}<span>Any image. It’s cropped square and sized for the store.</span>{/if}
              </span>
              <input bind:this={iconInput} class="pub-file" type="file" accept={ICON_INPUT_TYPES} tabindex="-1" aria-hidden="true" onchange={chooseIcon} />
              <div
                class="pub-icon-drop"
                class:is-over={iconDragDepth > 0}
                class:has-icon={!!iconUrl || !!cropping}
                role="group"
                aria-label="Icon"
                aria-busy={iconBusy}
                ondragenter={iconDragEnter}
                ondragover={iconDragOver}
                ondragleave={iconDragLeave}
                ondrop={iconDrop}
              >
                {#if cropping}
                  {#key cropping}
                    <IconCropper file={cropping.file} initial={cropping.initial} busy={iconBusy || busy}
                      onconfirm={(crop) => void applyCrop(crop)} oncancel={() => { cropping = null; }} onerror={cropFailed} />
                  {/key}
                {:else if iconUrl}
                  <img class="pub-icon-preview" src={iconUrl} alt="Icon preview" />
                  <span class="pub-icon-copy"><b>Icon ready</b><span>Drop another image to replace it.</span></span>
                  <span class="pub-icon">
                    <button class="btn ghost" type="button" disabled={busy || iconBusy} onclick={removeIcon}>Remove</button>
                    {#if iconSource}<button class="btn" type="button" disabled={busy || iconBusy} onclick={() => { if (iconSource) cropping = { file: iconSource.file, initial: iconSource.crop }; }}>Crop…</button>{/if}
                    <button class="btn" type="button" disabled={busy || iconBusy} onclick={() => iconInput?.click()}>Change…</button>
                  </span>
                {:else}
                  <button class="pub-icon-empty" type="button" disabled={busy || iconBusy} onclick={() => iconInput?.click()}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="9" cy="9.5" r="1.6" /><path d="m4 17 4.5-4.5a1.5 1.5 0 0 1 2.1 0L15 17m-2-2 1.9-1.9a1.5 1.5 0 0 1 2.1 0L20 16" /></svg>
                    <span><b>{iconDragDepth > 0 ? 'Drop to use this image' : 'Drop an image here'}</b><span>or click to choose one</span></span>
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </section>
      {/if}

      <section class="pub-section">
        <h3 class="pub-title">Sandbox</h3>
        <SandboxCheckStatus state={sandbox} onretry={busy ? undefined : () => void runCheck()}
          onfix={onfix ? () => void fixSandbox() : undefined} {fixing} disabled={busy} />
      </section>

      {#if plan.permissionFindings.length}
        <section class="pub-section">
          <h3 class="pub-title">Permissions to declare</h3>
          <div class="sg-group pub-group">
            {#each plan.permissionFindings as finding}
              <div class="settings-row pub-row">
                <span class="settings-copy"><span class="pub-problem">{finding.text}</span></span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if plan.blockedFindings.length || plan.waivableFindings.length}
        <section class="pub-section">
          <h3 class="pub-title">Possible secrets</h3>
          <div class="sg-group pub-group">
            {#each plan.blockedFindings as finding}
              <div class="settings-row pub-row">
                <span class="settings-copy">
                  <b class="pub-path">{finding.path}<i>line {finding.line}</i></b>
                  <span class="pub-problem">{findingLabel(finding.kind)}. Remove this before publishing.</span>
                </span>
              </div>
            {/each}
            {#each plan.waivableFindings as finding (findingKey(finding))}
              {@const key = findingKey(finding)}
              <div class="settings-row pub-row">
                <label class="settings-copy" for={`${uid}-why-${key}`}>
                  <b class="pub-path">{finding.path}<i>line {finding.line}</i></b>
                  {#if show(`why:${key}`) && problems.reasons[key]}
                    <span class="pub-problem">{problems.reasons[key]}</span>
                  {:else}
                    <span>{findingLabel(finding.kind)}. If it isn’t a secret, say why.</span>
                  {/if}
                </label>
                <input
                  id={`${uid}-why-${key}`}
                  class="pub-input"
                  placeholder="Why it’s safe"
                  autocomplete="off"
                  maxlength={PUBLISH_LIMITS.waiverReasonMax}
                  disabled={busy}
                  aria-invalid={show(`why:${key}`) && !!problems.reasons[key]}
                  bind:value={draft.reasons[key]}
                  onblur={() => (touched = { ...touched, [`why:${key}`]: true })}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <p class="pub-terms">{PUBLISH_TERMS}</p>
      {#if error}<p class="pub-error" role="alert">{error}</p>{/if}
    </form>

    <footer class="pub-foot">
      <span class="pub-status" aria-live="polite">{busy ? progressText(progress) : ''}</span>
      <button class="btn" type="button" disabled={busy} onclick={onclose}>Cancel</button>
      <button class="btn pri" type="submit" form={`${uid}-form`} disabled={busy || problems.blocked || !sandboxPassed || (attempted && !ready)}>Publish…</button>
    </footer>
  {/if}
</div>
