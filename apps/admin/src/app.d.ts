import type { AdminUser } from '@powermove/registry/wire';

declare global {
  namespace App {
    interface Locals {
      /** The Powermove session token from the httpOnly cookie, never sent to the browser. */
      token: string | null;
      who: Who;
    }
    interface Platform {
      env: {
        /** Public API origin: server calls without CLOUD, and where the browser goes for Google and verification. */
        API_ORIGIN: string;
        /** Service binding to powermove-cloud in production. */
        CLOUD?: { fetch(request: Request): Promise<Response> };
      };
    }
  }
  type Who =
    | { state: 'signed-out' }
    | { state: 'not-admin'; email: string | null }
    | { state: 'admin'; user: AdminUser };
}

export {};
