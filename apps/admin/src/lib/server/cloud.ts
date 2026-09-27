import type { RequestEvent } from '@sveltejs/kit';
import { ApiErrorBody } from '@powermove/registry/wire';
import type { z } from 'zod';

export class CloudError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody | null) {
    super(body?.detail ?? body?.error ?? `HTTP ${status}`);
  }
}

export function apiOrigin(event: RequestEvent): string {
  const origin = event.platform?.env.API_ORIGIN;
  if (!origin) throw new Error('API_ORIGIN is not configured');
  return origin;
}

/** Calls the Powermove API as the signed-in admin. The browser never talks to the API directly. */
export async function cloud<S extends z.ZodType>(
  event: RequestEvent,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; schema: S },
): Promise<z.infer<S>> {
  const headers = new Headers(options.headers);
  if (event.locals.token) headers.set('Authorization', `Bearer ${event.locals.token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const binding = event.platform?.env.CLOUD;
  // Through the binding the API would otherwise see no client address, and
  // its per-IP limits would pool every admin together.
  if (binding) headers.set('cf-connecting-ip', event.getClientAddress());
  const request = new Request(new URL(path, apiOrigin(event)), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = binding ? await binding.fetch(request) : await fetch(request);
  if (!response.ok) {
    const parsed = ApiErrorBody.safeParse(await response.json().catch(() => null));
    throw new CloudError(response.status, parsed.success ? parsed.data : null);
  }
  return options.schema.parse(response.status === 204 ? undefined : await response.json());
}

/** The message an action shows for a failed call. */
export function problem(error: unknown): { status: number; message: string } {
  if (error instanceof CloudError) {
    if (error.status === 429) return { status: 429, message: 'Too many requests. Try again in a minute.' };
    return { status: error.status, message: error.body?.detail ?? `The request failed (${error.body?.error ?? error.status}).` };
  }
  throw error;
}
