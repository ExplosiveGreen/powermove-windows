import { Pool } from 'pg';

/* Grants or revokes admin for an existing account, by email, against
   DATABASE_URL. Admins can do the same from the admin panel; this is the
   bootstrap (the first admin) and the way back in. */
export async function run(mode: 'grant' | 'revoke'): Promise<void> {
  const [email, ...extra] = process.argv.slice(2);
  if (!email || extra.length) {
    console.error(`Usage: DATABASE_URL=… bun scripts/${mode}-admin.ts <email>`);
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const found = await client.query<{ id: string; email: string }>('select id, email from "user" where lower(email) = $1', [email.trim().toLowerCase()]);
    const account = found.rows[0];
    if (!account) throw new Error(`No Powermove account uses ${email}. Sign in once with it first.`);
    if (mode === 'grant') {
      const inserted = await client.query('insert into admins (user_id) values ($1) on conflict do nothing returning user_id', [account.id]);
      if (inserted.rowCount) {
        await client.query(`insert into moderation_log (user_id, action, reason, actor) values ($1, 'grant_admin', '', 'script')`, [account.id]);
      }
      console.log(inserted.rowCount ? `Granted admin to ${account.email} (${account.id}) on ${new URL(databaseUrl).host}.` : `${account.email} is already an admin.`);
    } else {
      const all = await client.query<{ user_id: string }>('select user_id from admins for update');
      if (!all.rows.some((row) => row.user_id === account.id)) throw new Error(`${account.email} is not an admin.`);
      if (all.rows.length <= 1) throw new Error(`${account.email} is the last admin. Grant someone else first.`);
      await client.query('delete from admins where user_id = $1', [account.id]);
      await client.query(`insert into moderation_log (user_id, action, reason, actor) values ($1, 'revoke_admin', '', 'script')`, [account.id]);
      console.log(`Revoked admin from ${account.email} on ${new URL(databaseUrl).host}.`);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
