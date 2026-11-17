// Applies supabase/migrations/*.sql in order, once each, inside a transaction. Usage: npm run db:migrate
// Reads DATABASE_URL from .env.local. Never prints secrets.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is missing in .env.local");

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
  await client.query("alter table public._migrations enable row level security"); // no policies: invisible to the API
  const done = new Set((await client.query("select name from public._migrations")).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue; }
    await client.query("begin");
    try {
      await client.query(readFileSync(new URL(f, dir), "utf8"));
      await client.query("insert into public._migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`apply  ${f}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${f} failed (rolled back): ${e.message}`);
    }
  }
} finally {
  await client.end();
}
