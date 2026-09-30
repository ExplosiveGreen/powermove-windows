/*
 * The Store, as the in-app agent sees it (Claude/Codex/compatible). A thin
 * gateway over the same `storeClient` / `installer` / `publisher` the human's
 * Store screen uses, so nothing about auth, integrity, the sandbox or the
 * native publish confirmation is re-implemented here — this only shapes the
 * inputs/outputs for a tool call and picks what the agent is allowed to do
 * without asking.
 *
 * Consent model (decided with Jude): search/detail/source/library and
 * install/update/uninstall run autonomously — store extensions are sandboxed
 * and reversible. Publishing is outward-facing, so it always goes through the
 * publisher's native confirmation sheet; the agent cannot bypass it.
 *
 * Every method returns plain JSON-serialisable data. Errors throw and surface
 * to the agent as a tool error (bridge wraps them with `isError`).
 */
import type { ListingDto, MeDto } from '@powermove/registry/wire';
import type { ExtensionRecord } from '@powermove/registry/manifest';

import type { LibraryItemDto } from '../../shared/store-ipc';
import type { PublishForm, PublishPlanDto, StorePublishResult } from '../../shared/publish';
import type { StoreInstaller } from './install';
import type { Publisher } from './publish';
import type { ProvenanceStore } from './provenance';
import type { ExtensionsQuery, StoreClient } from './store-client';
import { buildLibrary } from './store-ipc';

/** Trimmed listing the agent sees for search hits and detail headers. */
interface ListingView {
  handle: string;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  installs: number;
  verified: boolean;
  permissions: string[];
  latest: { releaseId: string; version: string } | null;
}

export interface StoreSearchInput {
  query?: string;
  category?: ExtensionsQuery['category'];
  sort?: 'new' | 'installs' | 'name';
  cursor?: string;
}

export interface StoreInstallInput {
  handle: string;
  slug: string;
  /** Omit for the latest published release. */
  version?: string;
}

export interface StorePublishInput {
  localId: string;
  /** Defaults to the prepared plan's suggested version. */
  version?: string;
  notes?: string;
  /** Reasons for soft scan findings; get them from store_publish_prepare. */
  waivers?: PublishForm['waivers'];
  /** First publish only; defaults to the manifest-derived listing. */
  listing?: PublishForm['listing'];
  /** First publish only; defaults to `public`. */
  visibility?: PublishForm['visibility'];
}

export interface StoreAgentGateway {
  search(input: StoreSearchInput): Promise<{ items: ListingView[]; nextCursor: string | null }>;
  detail(handle: string, slug: string): Promise<ListingView & {
    repoId: string;
    about: string | null;
    latestReleaseId: string | null;
    releases: Array<{ releaseId: string; version: string; apiVersion: number; publishedAt: string; yanked: boolean; fileCount: number; sizeBytes: number; permissions: string[] }>;
  }>;
  source(releaseId: string, path?: string): Promise<
    | { treeSha: string; files: Array<{ path: string; size: number }> }
    | { path: string; text: string }
  >;
  library(): Promise<LibraryItemDto[]>;
  install(input: StoreInstallInput): Promise<{ localId: string; coordinate: string; version: string; permissions: string[]; needsSetup: boolean; needsTrust: boolean; warning?: string }>;
  update(localId: string): Promise<unknown>;
  uninstall(localId: string): Promise<{ removed: boolean }>;
  publishPrepare(localId: string): Promise<PublishPlanDto>;
  publish(input: StorePublishInput): Promise<StorePublishResult>;
}

export interface StoreAgentGatewayOptions {
  store: StoreClient;
  installer: StoreInstaller;
  publisher: Publisher;
  provenance: ProvenanceStore;
  registry: { list(): ExtensionRecord[] };
  me(): MeDto | null;
  signedIn(): boolean;
  /** Removes the extension folder + registry record (keeps values). Returns true when removed. */
  removeExtension(localId: string): Promise<boolean>;
  /** Reconciles the renderer after a folder is gone (the agent path has no IPC event). */
  refreshExtensions?(ids: string[]): Promise<void>;
}

function listingView(listing: ListingDto): ListingView {
  return {
    handle: listing.owner.handle,
    slug: listing.slug,
    name: listing.name,
    tagline: listing.tagline,
    category: listing.category,
    installs: listing.installCount,
    verified: listing.owner.verified,
    permissions: listing.permissions,
    latest: listing.latest ? { releaseId: listing.latest.id, version: listing.latest.version } : null
  };
}

export function createStoreAgentGateway(options: StoreAgentGatewayOptions): StoreAgentGateway {
  const { store, installer, publisher, provenance, registry, me, signedIn } = options;

  function requirePublisher(): void {
    if (!signedIn()) {
      throw new Error('Publishing needs the user signed in to their Powermove account. Ask them to sign in from Settings, then try again. Do not retry without them.');
    }
    if (!me()?.publisher) {
      throw new Error('Publishing needs a publisher handle. Ask the user to claim one in the Store, then try again.');
    }
  }

  return {
    async search(input) {
      const query: ExtensionsQuery = {};
      if (input.query) query.q = input.query;
      if (input.category) query.category = input.category;
      if (input.sort) query.sort = input.sort;
      if (input.cursor) query.cursor = input.cursor;
      const page = await store.extensions(query);
      return { items: page.items.map(listingView), nextCursor: page.nextCursor };
    },

    async detail(handle, slug) {
      const detail = await store.detail(handle, slug);
      return {
        ...listingView(detail),
        repoId: detail.repoId,
        about: detail.about,
        latestReleaseId: detail.latest?.id ?? null,
        releases: detail.releases.map((release) => ({
          releaseId: release.id,
          version: release.version,
          apiVersion: release.apiVersion,
          publishedAt: release.publishedAt,
          yanked: release.yankedAt != null,
          fileCount: release.fileCount,
          sizeBytes: release.sizeBytes,
          permissions: release.manifest.permissions
        }))
      };
    },

    async source(releaseId, path) {
      if (!path) {
        const tree = await store.tree(releaseId);
        return { treeSha: tree.treeSha, files: tree.files.map((file) => ({ path: file.path, size: file.size })) };
      }
      /* Reading one file is keyed by coordinate+version on the cloud; resolve
         them from the release the agent already has an id for. */
      const release = await store.release(releaseId);
      const text = await store.file(release.handle, release.slug, release.version, path);
      return { path, text };
    },

    async library() {
      let file = {};
      try {
        file = await provenance.read();
      } catch (error) {
        console.error('[store-agent] provenance unreadable', error instanceof Error ? error.message : 'unknown error');
      }
      const records = registry.list();
      const provenanceFile = file as Awaited<ReturnType<ProvenanceStore['read']>>;
      const trees = new Map<string, string | null>();
      await Promise.all(records.map(async (record) => {
        const entry = record.scope === 'user' ? provenanceFile[record.id] : undefined;
        if (!entry?.origin && !entry?.published) return;
        trees.set(record.id, await installer.localTree(record.id));
      }));
      return buildLibrary({
        records,
        provenance: provenanceFile,
        updates: installer.updates(),
        me: me(),
        modified: (id) => {
          const origin = provenanceFile[id]?.origin;
          return !!origin && trees.has(id) && trees.get(id) !== origin.treeSha;
        },
        tree: (id) => trees.get(id)
      });
    },

    async install(input) {
      const detail = await store.detail(input.handle, input.slug);
      const release = input.version
        ? detail.releases.find((candidate) => candidate.version === input.version)
        : detail.releases.find((candidate) => candidate.id === detail.latest?.id) ?? detail.releases[0];
      if (!release) {
        throw new Error(input.version
          ? `${input.handle}/${input.slug} has no version ${input.version}.`
          : `${input.handle}/${input.slug} has no published release to install.`);
      }
      const result = await installer.installRelease({ repoId: detail.repoId, releaseId: release.id });
      return {
        localId: result.localId,
        coordinate: `${input.handle}/${input.slug}`,
        version: release.version,
        permissions: release.manifest.permissions,
        needsSetup: result.needsSetup,
        needsTrust: result.needsTrust,
        ...(result.warning !== undefined ? { warning: result.warning } : {})
      };
    },

    update(localId) {
      return installer.updateRelease(localId);
    },

    async uninstall(localId) {
      const result = await installer.uninstall(localId, options.removeExtension);
      if (result.removed) await options.refreshExtensions?.([localId]);
      return result;
    },

    publishPrepare(localId) {
      requirePublisher();
      return publisher.prepare(localId);
    },

    async publish(input) {
      requirePublisher();
      /* Derive defaults (version, first-publish listing) from a fresh plan so
         the tool call stays small; the publisher re-snapshots and shows the
         native confirmation before anything uploads. */
      const plan = await publisher.prepare(input.localId);
      const form: PublishForm = {
        version: input.version ?? plan.suggestedVersion,
        waivers: input.waivers ?? [],
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      };
      if (plan.firstPublish) {
        form.listing = input.listing ?? {
          name: plan.listing.name,
          tagline: plan.listing.tagline,
          category: plan.listing.category,
          licence: 'MIT'
        };
        form.visibility = input.visibility ?? 'public';
      }
      return publisher.publish(input.localId, form);
    }
  };
}
