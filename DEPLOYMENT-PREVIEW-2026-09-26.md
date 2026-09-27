# Production backend and local preview

Source: feat/admin-panel at 58e0b6e (includes feat/store-refine at ab87606), combined with the main checkout's uncommitted desktop fixes in this isolated worktree. Original checkout and both feature worktrees unchanged. No Git push, CI dispatch, or public desktop release.

Production database migrations 0007_publisher_verified and 0008_admins applied successfully using drizzle-kit migrate. The earlier seven migrations were already present.

- powermove-cloud: 3b2e79dd-35a0-41bb-b3ae-4538ec49dd04 at https://cloud.trypowermove.com
- powermove-admin: 8af37ce7-3d45-49cd-88ef-7e36de7885b3 at https://admin.trypowermove.com
- Desktop installed locally: 1.0.6-local.20260926.25. Previous .24 retained as rollback; older application backups moved to Trash.

Validation: cloud 74 tests; focused desktop suites 323 tests, plus cloud-desktop/account suites 140 tests. Cloud, admin and desktop type checks pass. Admin and desktop builds and Worker dry-run pass. Live health and Store browse 200; signed-out admin API 401; admin site redirects to sign-in; cross-origin POST rejected 403. Installed app opened and displayed production Store with existing signed-in account.

Integration fixes: retained new Store/Publish UI while carrying forward repair and project-picker fixes; replaced version-specific .bun cache type references with Wrangler-generated runtime types; updated test fixtures for required publisher verified field.

Pending: user selection of account for first admin grant. No admin grant issued yet. Authenticated admin UI and moderation flows have not been exercised against production. Use apps/cloud/scripts/grant-admin.ts once the account is selected; credentials remain outside the repository.
