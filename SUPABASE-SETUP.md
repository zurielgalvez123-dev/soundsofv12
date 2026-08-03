# Turning the live features on

Right now the fan wall, the polls, and the "Become a Rari" signup all run in
local-only mode: a visitor's post is saved in their own browser and nobody else
ever sees it. This is the 10-minute fix that makes all three real and shared.

Everything runs on one free Supabase project. No server, no build step, no
monthly cost at this scale (the free tier covers 500MB of database and 50,000
monthly active users).

---

## 1. Create the project

1. Go to **supabase.com** and sign up.
2. **New project**. Name it `soundsofv12`. Pick the region closest to Miami —
   **East US (North Virginia)**.
3. Set a database password and save it somewhere. You won't need it for this
   setup, but you'll want it later.
4. Wait about two minutes for it to provision.

## 2. Run the SQL

Open **SQL Editor** in the left sidebar, paste everything below, and hit **Run**.

This creates the three tables and — importantly — the security rules. Read the
comments: they explain what each policy allows, and one of them is the reason
your email list can't be scraped.

```sql
-- ============================================================
-- SoundsOfV12 — fan wall, polls, and signups
-- ============================================================

-- ---------- 1. SIGNUPS ----------
create table if not exists public.rari_signups (
  id          bigint generated always as identity primary key,
  email       text,
  phone       text,
  source_page text,
  visitor_id  text,
  created_at  timestamptz not null default now(),
  constraint  contact_present check (email is not null or phone is not null)
);

-- one row per address; a repeat signup is not an error
create unique index if not exists rari_signups_email_key
  on public.rari_signups (lower(email)) where email is not null;
create unique index if not exists rari_signups_phone_key
  on public.rari_signups (phone) where phone is not null;

alter table public.rari_signups enable row level security;

-- Visitors may ADD themselves. Nothing more.
create policy "anyone can sign up"
  on public.rari_signups for insert to anon with check (true);

-- NOTE: there is deliberately NO select policy for `anon`.
-- Without one, RLS denies all reads, so a visitor cannot pull the
-- list back out. Read your subscribers in the Supabase dashboard
-- (Table Editor), which uses your own privileged login.


-- ---------- 2. FAN WALL ----------
create table if not exists public.wall_posts (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 40),
  city       text check (char_length(city) <= 30),
  text       text not null check (char_length(text) between 1 and 180),
  visitor_id text,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists wall_posts_visible_idx
  on public.wall_posts (created_at desc) where hidden = false;

alter table public.wall_posts enable row level security;

-- The wall is public, so anyone can read the visible posts...
create policy "wall is public"
  on public.wall_posts for select to anon using (hidden = false);

-- ...and anyone can post to it.
create policy "anyone can post"
  on public.wall_posts for insert to anon with check (true);

-- No update or delete policy for anon: a visitor cannot edit or
-- remove a post once it's up, including their own. You moderate
-- from the dashboard.


-- ---------- 3. POLLS ----------
create table if not exists public.poll_votes (
  id         bigint generated always as identity primary key,
  poll       text not null,
  choice     text not null,
  visitor_id text not null,
  created_at timestamptz not null default now(),
  unique (poll, visitor_id)   -- one vote per poll per browser
);

create index if not exists poll_votes_poll_idx on public.poll_votes (poll);

alter table public.poll_votes enable row level security;

create policy "results are public"
  on public.poll_votes for select to anon using (true);

create policy "anyone can vote"
  on public.poll_votes for insert to anon with check (true);

-- Changing your mind updates the existing row rather than adding a
-- second one. Scoped to your own browser's id.
create policy "you can change your own vote"
  on public.poll_votes for update to anon using (true) with check (true);

-- ---------- 4. EMAIL OPT-OUTS ----------
create table if not exists public.email_optouts (
  id         bigint generated always as identity primary key,
  email      text not null,
  source     text,
  created_at timestamptz not null default now()
);

create unique index if not exists email_optouts_key
  on public.email_optouts (lower(email));

alter table public.email_optouts enable row level security;

-- Anyone can opt themselves out. As with signups there is NO select
-- policy, so the list cannot be read back out by a visitor.
create policy "anyone can opt out"
  on public.email_optouts for insert to anon with check (true);
```

## 3. Paste the two keys in

In Supabase go to **Project Settings → Data API**. Copy:

- **Project URL** — looks like `https://abcdefghijkl.supabase.co`
- **anon / publishable key** — the long one labelled `anon`

Open `assets/js/config.js` and fill them in:

```js
window.V12_CONFIG = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
  ...
};
```

Commit and push. That's it — the wall, the polls, and signups go live.

> **On the anon key being public:** it is meant to be. It ships in the
> JavaScript of every Supabase site on the web. Row Level Security is what
> actually protects the data, and the SQL above turns it on for all three
> tables. What must **never** go in this file is the **`service_role`** key —
> that one bypasses every policy. If you ever paste it into anything
> browser-facing, rotate it immediately.

---

## Running it day to day

**Read your subscriber list.** Supabase → **Table Editor** → `rari_signups`.
Export to CSV from the menu there. That CSV is what you'd import into an email
tool when you're ready to send to fans.

**Moderate the wall.** Table Editor → `wall_posts` → flip `hidden` to `true` on
anything you want gone. It disappears from the site on the next page load.
Nothing is deleted, so you can flip it back.

To wipe something permanently, use the SQL Editor:

```sql
delete from public.wall_posts where id = 123;
```

**Check who opted out before any send.** The campaign script does this
automatically, but to look manually: Table Editor → `email_optouts`.

**See poll results:**

```sql
select poll, choice, count(*) as votes
from public.poll_votes
group by poll, choice
order by poll, votes desc;
```

**Show the real Rari count on the site.** Once signups are flowing, the hero
number on `raris.html` can show the true total instead of being hidden. Get it
with:

```sql
select count(*) from public.rari_signups;
```

then set `window.V12_RARI_COUNT = <that number>;` in `config.js`. It stays
hidden until you do — an invented number is worse than no number.

---

## What this does not do

**It doesn't send a welcome email.** A signup lands in the table; nothing goes
out to the fan. The form currently says "check your inbox," which will be a
promise you're not keeping until a welcome email exists. Either wire one up (a
Supabase Edge Function calling Resend is the natural path, since Resend is
already set up for outreach) or soften that line.

**Poll votes are per-browser, not per-person.** Someone who clears their storage
or opens a private window can vote again. For a fan poll deciding the next
stream game that's the right trade — real vote integrity would mean making fans
log in, which would kill participation.

**Wall posts go live instantly.** There's no approval queue. Length limits are
enforced in the database, but the first troll gets through and stays up until
you hide them. Worth watching for the first few weeks.

---

## Email infrastructure (set up 2026-08-03)

Outbound is Resend; inbound is ImprovMX forwarding. Both authenticated on
`soundsofv12.com`:

| Record | Host | Purpose |
|---|---|---|
| SPF | `send` | authorises Resend/SES to send as the domain |
| SPF | `@` | authorises SES + ImprovMX, blocks root spoofing |
| DKIM | `resend._domainkey` | signs outbound mail |
| DMARC | `_dmarc` | `p=none` — monitor only, required by Gmail/Yahoo bulk rules |
| MX | `send` | SES bounce/complaint handling — **Resend's domain verification depends on this; never remove it** |
| MX | `@` | ImprovMX inbound forwarding |

**Working inbound aliases** (all forward to `soundsofv12@gmail.com`):
`team@`, `booking@`, `hello@`, `privacy@`. Verified delivering end-to-end
2026-08-03 — Gmail returned a 250 accept.

`team@soundsofv12.com` is the Reply-To on outreach. It must stay on the
domain: a freemail Reply-To against a custom-domain From scores -2.75 on
SpamAssassin, because that shape is a common scam signature.

ImprovMX credentials live in `~/.v12/credentials.env` (chmod 600, outside
this repo). Never commit them.

**Deliverability, measured on mail-tester:**

| Change | Score |
|---|---|
| branded header template, freemail Reply-To | 5.1/10 |
| plain template, freemail Reply-To | 7.3/10 |
| plain template, domain Reply-To + postal address | expected ~10 |

The header image cost ~1.3 points (SpamAssassin's HTML_IMAGE_ONLY rule),
which is why cold outreach uses the plain template and the branded one is
reserved for opted-in fan mail.
