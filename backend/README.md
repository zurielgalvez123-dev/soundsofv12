# The SoundsOfV12 backend

This is our own backend — about 250 lines of JavaScript and one SQL file.
Not Supabase, not a hosted service with someone else's opinions baked in.
It runs on Cloudflare Workers with a D1 (SQLite) database.

It exists so three things on the site are actually shared between fans
instead of living in one visitor's browser: **signups**, the **fan wall**,
and the **polls**. Plus email **opt-outs**, because outreach mail carries
an unsubscribe link that has to do something real.

---

## Why this shape

**Cost:** $0. The free tier allows 100,000 Worker requests *per day* and
100,000 database writes *per day*. This site does a few thousand requests
a *month*. It does not plausibly ever cost money.

**Maintenance:** none. No server, no operating system to patch, no TLS
certificate to renew, no uptime to babysit. Compare running our own box,
where all four become someone's job forever.

**The signup list cannot be scraped.** This is the part worth
understanding, because it's the one real advantage over the Supabase
approach we started with.

With Supabase the browser talks *to the database* using a public key, and
the only thing standing between a scraper and every email address is a
row-level policy you remembered to write correctly. Here the browser
talks only to our Worker, and **there is no route that reads the signup
list.** Not a locked-down one — none at all. You cannot misconfigure a
route that doesn't exist. Reading the list requires the admin token.

---

## Deploy it (about 10 minutes, one time)

You need a free Cloudflare account. Everything below runs from this
`backend/` folder.

**1. Log in**

```bash
npx wrangler login
```

**2. Create the database**

```bash
npx wrangler d1 create soundsofv12
```

It prints a `database_id`. Paste that into `wrangler.toml`.

**3. Create the tables**

```bash
npx wrangler d1 execute soundsofv12 --remote --file=schema.sql
```

**4. Set an admin password**

Make up a long random one — this is what unlocks the admin page.

```bash
npx wrangler secret put ADMIN_TOKEN
```

**5. Deploy**

```bash
npx wrangler deploy
```

It prints a URL like `https://soundsofv12-api.<something>.workers.dev`.

**6. Switch the site on**

Put that URL into `assets/js/config.js`:

```js
window.V12_CONFIG = {
  apiUrl: 'https://soundsofv12-api.<something>.workers.dev',
  ...
};
```

Commit and push. The wall, the polls and signups go live.

A custom domain (`api.soundsofv12.com`) is **not** required and is not
worth doing — it would mean moving the domain's nameservers to
Cloudflare, which touches the DNS currently serving the live site and the
email setup.

---

## Running it day to day

Go to **soundsofv12.com/admin.html** and paste the admin token. From
there you can:

- See counts for signups, wall posts, votes and opt-outs
- **Hide** any wall post (reversible — hiding is a flag, nothing is
  deleted, so a mistake costs nothing)
- Download signups as CSV
- Download opt-outs as CSV — **check this before any email send**

The token is kept only for that browser tab and forgotten when you close
it. It never appears in the site's source.

### Show the real Rari count

Once signups are flowing, the count on the Rari page can show the true
number. Take it from the admin page and set it in `config.js`:

```js
rariCount: 137
```

Left null, the stat hides itself rather than inventing a number.

---

## Backups

Cloudflare keeps 7 days of point-in-time history automatically, free, no
setup. To roll back:

```bash
npx wrangler d1 time-travel restore soundsofv12 --timestamp=<unix-seconds>
```

For a copy you keep yourself:

```bash
npx wrangler d1 export soundsofv12 --remote --output=backup.sql
```

Worth doing occasionally and keeping somewhere off Cloudflare.

---

## Watching it / fixing it

```bash
npx wrangler tail                 # live logs
npx wrangler d1 execute soundsofv12 --remote --command "SELECT COUNT(*) FROM signups"
```

---

## If we ever leave Cloudflare

`worker.js` is plain JavaScript with no Cloudflare-specific dependencies
beyond `env.DB.prepare(...).bind(...).run()/all()/first()`. Moving it to
Node, Bun or Deno against any SQLite or Postgres means rewriting those
calls and nothing else. `schema.sql` is ordinary SQLite. Export the data
with the command above and it comes with you.

That's the point of building our own: the code, the schema and the data
are all ours.

---

## What it deliberately doesn't do

**Poll votes are per-browser, not per-person.** Someone who clears their
storage or opens a private window can vote again. Making that airtight
would mean forcing fans to create accounts, which would kill
participation. For "which game should I stream next" that's the right
trade.

**Wall posts appear immediately.** There's no approval queue — length
limits are enforced in the database and there's a 5-posts-per-hour brake
per visitor, but the first troll gets through and stays up until someone
hides them. Worth watching for the first few weeks.

**No welcome email.** A signup lands in the table; the fan gets nothing.
The form currently says "check your inbox," which is a promise nobody is
keeping. Either wire one up or soften that line.
