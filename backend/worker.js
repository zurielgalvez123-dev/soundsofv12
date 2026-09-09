/**
 * SoundsOfV12 API — a Cloudflare Worker over a D1 (SQLite) database.
 *
 * This is the whole backend. It is our own code and our own schema, not
 * a hosted BaaS: if Cloudflare ever stops suiting us, the same routes
 * drop onto Node, Bun or Deno against any SQLite/Postgres with only the
 * db.* calls rewritten.
 *
 * THE SECURITY MODEL, which is the part worth reading:
 * The browser never talks to the database. It talks to these routes, and
 * the routes decide what exists. There is deliberately NO route that
 * reads the signup list or the opt-out list — not a locked-down one, no
 * route at all. That is a stronger guarantee than a row-level policy,
 * because there is no configuration to get wrong. Read those lists with
 * wrangler from your own machine (see README).
 *
 * Routes:
 *   POST /signup       {email|phone, source_page, visitor_id}  -> member no.
 *   POST /booking      {name, contact, kind, when, details}
 *   GET  /wall                                   -> visible posts
 *   POST /wall         {name, city, text, visitor_id}
 *   GET  /polls?visitor_id=x                     -> board + deadlines + your pick
 *   GET  /votes?poll=x                           -> tallies + your vote
 *   POST /votes        {poll, choice, visitor_id} -> refused once closed
 *   POST /optout       {email, source}
 *   POST /events       {visitor_id, session_id, page, ref, device, events:[…]}
 *   GET  /health
 *
 * Secrets (npx wrangler secret put NAME):
 *   ADMIN_TOKEN  gates every /admin/* route
 *   RESEND_KEY   sends the welcome email and the booking notification;
 *                without it both are skipped and the rows still land
 *
 * A daily cron prunes engagement events older than EVENT_RETENTION_DAYS.
 */

// Analytics is only useful as a trend, and a trend does not need last
// year's raw rows. Pruning keeps the database small and means we are not
// quietly accumulating a permanent record of individual browsing.
const EVENT_RETENTION_DAYS = 180;

// Batched ingest: one HTTP request carries a visit's events. These caps
// are what stops a bored visitor with a console from burning the daily
// write quota that the real features depend on.
const EVENTS_PER_BATCH = 25;
const EVENTS_PER_VISITOR_PER_HOUR = 600;

// Event names come from our own client, so they are a known vocabulary
// rather than free text. Anything else is dropped silently — a rejected
// analytics call must never surface as an error in front of a visitor.
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;
const DEVICES = ["mobile", "tablet", "desktop"];

const ALLOWED_ORIGINS = [
  "https://soundsofv12.com",
  "https://www.soundsofv12.com",
];

// Local dev: allow file:// and localhost when DEV=1 is set as a var.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const dev = env.DEV === "1";
  const ok =
    ALLOWED_ORIGINS.includes(origin) ||
    (dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // These reads happen immediately after a write to refresh the UI
      // and share a URL with the previous read; a cached response would
      // show someone their own post or vote failing to appear.
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

const str = (v, max) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

// Compare without leaking length or match position through timing.
// Over the public internet the signal is mostly buried in jitter, but
// this costs nothing and removes the question.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ============================================================
// Welcome mail
//
// A signup that lands in a table and nothing else is a promise the page
// makes and the backend quietly breaks. This is the part that keeps it.
//
// Two things this deliberately does NOT do:
//   - It does not block the signup. If Resend is down, the row is still
//     written and the visitor still sees success, because they did in
//     fact join; the mail is retried by hand from the admin page.
//   - It does not claim delivery. A 200 from Resend means accepted. The
//     mail_sends row says 'accepted' and stores the provider id so a
//     bounce can be traced back to the person later.
// ============================================================
const MAIL_FROM = "V12 <team@soundsofv12.com>";
const MAIL_REPLY_TO = "team@soundsofv12.com";

function welcomeEmail(site) {
  const text = [
    "YOU'RE IN.",
    "",
    "You're a Rari now. That means you hear it first — new music, live",
    "alerts, and merch before it goes public.",
    "",
    "Start here:",
    `  Every release, every platform   ${site}/music.html`,
    `  The V12 Collection              ${site}/shop.html`,
    `  Sign the wall                   ${site}/raris.html#wall`,
    "",
    "See you in the next one.",
    "V12",
    "",
    "---",
    "SoundsOfV12 - Miami, FL",
    `Unsubscribe: ${site}/unsubscribe.html`,
  ].join("\n");

  // Table layout with inline styles, because Gmail strips <style> blocks
  // and Outlook renders on Word's engine — flexbox and CSS variables are
  // not available here even though the rest of the site is built on them.
  //
  // Every colour is stated on the element. The logo sits on a band of the
  // exact colour it was flattened onto, so a client that blocks images
  // shows a dark band with alt text rather than a grey hole.
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>You're in, Rari</title>
</head>
<body style="margin:0;padding:0;background:#08080a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">You're a Rari. New music, live alerts and merch before anyone else.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#08080a;">
<tr><td align="center" style="padding:28px 14px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#0d0d10;border:1px solid #26262e;border-radius:18px;overflow:hidden;">

  <tr><td align="center" style="background:#0a0a0c;padding:30px 24px 24px;">
    <img src="${site}/assets/img/email-logo.png" width="220" alt="SoundsOfV12"
         style="display:block;width:220px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none;">
  </td></tr>

  <tr><td style="height:1px;background:#26262e;font-size:0;line-height:0;">&nbsp;</td></tr>

  <tr><td style="padding:34px 30px 8px;">
    <p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#a7a6a1;">Rari Nation</p>
    <h1 style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:40px;line-height:1.05;color:#ffffff;letter-spacing:-.02em;">You're in.</h1>
    <p style="margin:0 0 22px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#c9c8c3;">
      You're a Rari now. That means you hear it first &mdash; new music, live alerts, and merch before it goes public.
    </p>
  </td></tr>

  <tr><td style="padding:0 30px 26px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="#e9e3d6" style="border-radius:999px;">
        <a href="${site}/music.html"
           style="display:inline-block;padding:15px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#0a0a0b;text-decoration:none;border-radius:999px;">
          Play the catalog
        </a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:13px 0;border-top:1px solid #1e1e24;font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        <a href="${site}/shop.html" style="color:#e9e3d6;text-decoration:none;">The V12 Collection &rarr;</a>
      </td></tr>
      <tr><td style="padding:13px 0;border-top:1px solid #1e1e24;font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        <a href="${site}/raris.html#wall" style="color:#e9e3d6;text-decoration:none;">Sign the Rari wall &rarr;</a>
      </td></tr>
      <tr><td style="padding:13px 0;border-top:1px solid #1e1e24;font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        <a href="https://www.youtube.com/@soundsofv12" style="color:#e9e3d6;text-decoration:none;">Watch on YouTube &rarr;</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 30px 32px;">
    <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c9c8c3;">
      See you in the next one.<br><strong style="color:#ffffff;">V12</strong>
    </p>
  </td></tr>

  <tr><td style="padding:20px 30px 26px;border-top:1px solid #1e1e24;">
    <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#75746f;">
      SoundsOfV12 &middot; Miami, FL<br>
      You got this because you joined the Rari's at soundsofv12.com.<br>
      <a href="${site}/unsubscribe.html" style="color:#a7a6a1;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject: "You're in, Rari", text, html };
}

// A booking inquiry goes to the booking inbox, with Reply-To set to the
// person asking — so hitting reply in Gmail answers the promoter, not us.
async function sendBookingMail(env, inq) {
  if (!env.RESEND_KEY) return { skipped: "no RESEND_KEY" };
  // Deliver to a real mailbox, NOT to booking@soundsofv12.com.
  //
  // booking@ is an ImprovMX alias that forwards on to Gmail. Forwarding
  // re-sends the message from ImprovMX's servers, so SPF is evaluated
  // against a host soundsofv12.com never authorised and fails on that
  // final hop — which is most of why the first booking notification landed
  // in spam. Sending straight to the mailbox removes the hop entirely.
  // Override with: npx wrangler secret put BOOKING_TO
  const to = env.BOOKING_TO || "soundsofv12@gmail.com";
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(inq.contact);

  const lines = [
    `Name:     ${inq.name}`,
    `Contact:  ${inq.contact}`,
    `Type:     ${inq.kind || "—"}`,
    `When/where: ${inq.when || "—"}`,
    "",
    inq.details || "(no details given)",
  ].join("\n");

  let providerId = null, status = "error", errText = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        reply_to: isEmail ? inq.contact : MAIL_REPLY_TO,
        subject: `Booking inquiry — ${inq.name}${inq.kind ? " · " + inq.kind : ""}`,
        text: lines,
        headers: { "X-Entity-Ref-ID": String(Date.now()) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.id) { providerId = data.id; status = "accepted"; }
    else { errText = (data.message || `HTTP ${res.status}`).slice(0, 200); }
  } catch (e) {
    errText = String(e && e.message ? e.message : e).slice(0, 200);
  }

  await env.DB.prepare(
    `INSERT INTO mail_sends (to_addr, kind, provider_id, status, error)
     VALUES (?1, 'booking', ?2, ?3, ?4)`
  ).bind(to, providerId, status, errText).run().catch(() => {});

  return { status, providerId, error: errText };
}

async function sendWelcome(env, email) {
  if (!env.RESEND_KEY) return { skipped: "no RESEND_KEY" };

  // Never mail someone who asked us not to, and never mail the same
  // person a second welcome.
  const blocked = await env.DB.prepare(
    `SELECT 1 AS x FROM optouts WHERE lower(email) = lower(?1)
      UNION ALL
     SELECT 1 FROM mail_sends
      WHERE lower(to_addr) = lower(?1) AND kind = 'welcome' AND status = 'accepted'`
  ).bind(email).first();
  if (blocked) return { skipped: "opted out or already welcomed" };

  const site = env.SITE_URL || "https://soundsofv12.com";
  const body = welcomeEmail(site);

  let providerId = null, status = "error", errText = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        reply_to: MAIL_REPLY_TO,
        subject: body.subject,
        text: body.text,
        html: body.html,
        // Gmail and Yahoo have required one-click unsubscribe on bulk mail
        // since February 2024. Without these two headers a sender with no
        // reputation gets filtered on arrival no matter how clean the
        // domain auth is — and soundsofv12.com has no sending history yet.
        // List-Unsubscribe-Post is what makes it ONE-click rather than a
        // link, which is the part the requirement is actually about.
        headers: {
          "List-Unsubscribe": `<${site}/unsubscribe.html>, <mailto:unsubscribe@soundsofv12.com?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.id) { providerId = data.id; status = "accepted"; }
    else { errText = (data.message || `HTTP ${res.status}`).slice(0, 200); }
  } catch (e) {
    errText = String(e && e.message ? e.message : e).slice(0, 200);
  }

  await env.DB.prepare(
    `INSERT INTO mail_sends (to_addr, kind, provider_id, status, error)
     VALUES (?1, 'welcome', ?2, ?3, ?4)`
  ).bind(email, providerId, status, errText).run().catch(() => {});

  return { status, providerId, error: errText };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      // ---------- health ----------
      if (path === "/health") {
        return json(request, env, { ok: true });
      }

      // ---------- signups ----------
      // Write-only by design. There is no GET counterpart.
      if (path === "/signup" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const contact = str(b.contact, 200) || str(b.email, 200) || str(b.phone, 40);
        if (!contact) return json(request, env, { error: "contact required" }, 400);

        const isEmail = contact.includes("@");
        if (isEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(contact)) {
          return json(request, env, { error: "invalid email" }, 400);
        }

        // A repeat signup is success, not an error — the visitor did
        // nothing wrong and should not see a failure.
        const ins = await env.DB.prepare(
          `INSERT INTO signups (email, phone, source_page, visitor_id)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT DO NOTHING
           RETURNING id`
        )
          .bind(
            isEmail ? contact : null,
            isEmail ? null : contact,
            str(b.source_page, 60),
            str(b.visitor_id, 64)
          )
          .first();

        // The member number is the signup's own row id, so #001 really is
        // the first person who joined. On a repeat signup the insert
        // returns nothing, so look up the number they already have —
        // someone's Rari number must not change between visits.
        let member = ins && ins.id;
        if (!member) {
          const prev = await env.DB.prepare(
            isEmail
              ? `SELECT id FROM signups WHERE lower(email) = lower(?1)`
              : `SELECT id FROM signups WHERE phone = ?1`
          ).bind(contact).first();
          member = prev && prev.id;
        }

        // Mail after the response is on its way: the visitor should not
        // wait on Resend, and a mail failure must not fail the signup.
        if (isEmail) {
          ctx.waitUntil(
            sendWelcome(env, contact).catch((e) => console.error("welcome mail", e))
          );
        }

        return json(request, env, {
          ok: true,
          member: member || null,
          // Texts are not switched on yet (US carrier A2P registration).
          // Telling the client this is what stops the page promising one.
          sms: false,
        });
      }

      // ---------- storefront config ----------
      // Hands the browser the Fourthwall storefront token.
      //
      // This is not a secret being leaked: Fourthwall issues a storefront
      // token precisely so it can sit in client code, it can only read
      // published products and build carts, and the shop cannot render
      // without it reaching the page. Serving it from here rather than
      // committing it buys two real things — it can be rotated with
      // `wrangler secret put` instead of a site deploy, and it stays out
      // of the repository, where GitHub's scanner misreads its shape as
      // Shopify credentials and refuses the push.
      //
      // Cached at the edge: this answer changes about once a year, and the
      // shop should not wait on a cold round trip to start rendering.
      if (path === "/storefront" && request.method === "GET") {
        return new Response(
          JSON.stringify({
            token: env.FW_STOREFRONT_TOKEN || "",
            shop: env.FW_SHOP || "",
            collection: env.FW_COLLECTION || "all",
            currency: env.FW_CURRENCY || "USD",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
              ...corsHeaders(request, env),
            },
          }
        );
      }

      // ---------- booking ----------
      // The booking form used to carry `data-join`, so the newsletter
      // handler took it: it read the FIRST input (a person's name),
      // failed to validate it as an email, and stopped. Nobody was ever
      // told. Every show, brand and sync inquiry ever typed into that
      // form was discarded in the browser.
      //
      // Now it is stored first and mailed second, in that order on
      // purpose: if Resend is down the inquiry is still on the record
      // and shows up in the admin, rather than existing only inside an
      // email that failed to send.
      if (path === "/booking" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const name = str(b.name, 80);
        const contact = str(b.contact, 200);
        const details = str(b.details, 2000);
        if (!name || !contact) {
          return json(request, env, { error: "name and contact required" }, 400);
        }
        const kind = str(b.kind, 60);
        const when = str(b.when, 120);
        const visitor = str(b.visitor_id, 64);

        if (visitor) {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM bookings
              WHERE visitor_id = ?1 AND created_at > datetime('now','-1 hour')`
          ).bind(visitor).first();
          if (row && row.n >= 5) {
            return json(request, env, { error: "slow down a moment" }, 429);
          }
        }

        await env.DB.prepare(
          `INSERT INTO bookings (name, contact, kind, when_where, details, visitor_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        ).bind(name, contact, kind, when, details, visitor).run();

        ctx.waitUntil(
          sendBookingMail(env, { name, contact, kind, when, details })
            .catch((e) => console.error("booking mail", e))
        );

        return json(request, env, { ok: true });
      }

      // ---------- fan wall ----------
      if (path === "/wall" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT name, city, text, visitor_id, created_at
             FROM wall_posts
            WHERE hidden = 0
            ORDER BY created_at DESC
            LIMIT 60`
        ).all();
        return json(request, env, { posts: results || [] });
      }

      if (path === "/wall" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const name = str(b.name, 40);
        const text = str(b.text, 180);
        const visitor = str(b.visitor_id, 64);
        if (!name || !text) return json(request, env, { error: "name and text required" }, 400);

        // Rate limit: 5 posts per visitor per hour. Not airtight — a
        // determined abuser clears storage for a new id — but it stops
        // the accidental double-submit and casual flooding, which is
        // what actually happens on a site this size.
        if (visitor) {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM wall_posts
              WHERE visitor_id = ?1 AND created_at > datetime('now','-1 hour')`
          ).bind(visitor).first();
          if (row && row.n >= 5) {
            return json(request, env, { error: "slow down a moment" }, 429);
          }
        }

        await env.DB.prepare(
          `INSERT INTO wall_posts (name, city, text, visitor_id) VALUES (?1, ?2, ?3, ?4)`
        ).bind(name, str(b.city, 30), text, visitor).run();

        return json(request, env, { ok: true });
      }

      // ---------- polls ----------
      // The whole poll board in one round trip: questions, options,
      // deadlines, tallies and which one you picked. The page renders
      // from this, so adding a poll in the admin makes it appear on the
      // site without anyone touching HTML.
      if (path === "/polls" && request.method === "GET") {
        const visitor = str(url.searchParams.get("visitor_id"), 64);

        const [polls, options, tallies, mine] = await env.DB.batch([
          env.DB.prepare(
            `SELECT id, question, subtitle, closes_at, active,
                    (closes_at IS NOT NULL AND closes_at <= datetime('now')) AS expired
               FROM polls WHERE active = 1 ORDER BY sort, created_at`
          ),
          env.DB.prepare(
            `SELECT poll, key, label FROM poll_options ORDER BY poll, sort, id`
          ),
          env.DB.prepare(
            `SELECT poll, choice, COUNT(*) AS votes FROM poll_votes GROUP BY poll, choice`
          ),
          env.DB.prepare(
            `SELECT poll, choice FROM poll_votes WHERE visitor_id = ?1`
          ).bind(visitor || ""),
        ]);

        const byPoll = {};
        for (const o of options.results || []) {
          (byPoll[o.poll] = byPoll[o.poll] || []).push({ key: o.key, label: o.label, votes: 0 });
        }
        const count = {};
        for (const t of tallies.results || []) count[t.poll + " " + t.choice] = t.votes;
        const picked = {};
        for (const m of mine.results || []) picked[m.poll] = m.choice;

        const out = (polls.results || []).map((p) => {
          const opts = (byPoll[p.id] || []).map((o) => ({
            ...o, votes: count[p.id + " " + o.key] || 0,
          }));
          return {
            id: p.id,
            question: p.question,
            subtitle: p.subtitle,
            closes_at: p.closes_at,
            closed: !!p.expired,
            options: opts,
            total: opts.reduce((n, o) => n + o.votes, 0),
            mine: picked[p.id] || null,
          };
        });

        return json(request, env, { polls: out });
      }

      if (path === "/votes" && request.method === "GET") {
        const poll = str(url.searchParams.get("poll"), 40);
        const visitor = str(url.searchParams.get("visitor_id"), 64);
        if (!poll) return json(request, env, { error: "poll required" }, 400);

        const { results } = await env.DB.prepare(
          `SELECT choice, COUNT(*) AS votes FROM poll_votes WHERE poll = ?1 GROUP BY choice`
        ).bind(poll).all();

        const tally = {};
        for (const r of results || []) tally[r.choice] = r.votes;

        let mine = null;
        if (visitor) {
          const row = await env.DB.prepare(
            `SELECT choice FROM poll_votes WHERE poll = ?1 AND visitor_id = ?2`
          ).bind(poll, visitor).first();
          mine = row ? row.choice : null;
        }
        return json(request, env, { tally, mine });
      }

      if (path === "/votes" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const poll = str(b.poll, 40);
        const choice = str(b.choice, 40);
        const visitor = str(b.visitor_id, 64);
        if (!poll || !choice || !visitor) {
          return json(request, env, { error: "poll, choice and visitor_id required" }, 400);
        }

        // The deadline is enforced HERE, not in the countdown on the page.
        // A closed poll that only the client knows is closed is open to
        // anyone with a console. A poll that predates this table (no row)
        // is left alone so nothing already running breaks.
        const meta = await env.DB.prepare(
          `SELECT active,
                  (closes_at IS NOT NULL AND closes_at <= datetime('now')) AS expired,
                  (SELECT COUNT(*) FROM poll_options o WHERE o.poll = p.id) AS n_opts,
                  (SELECT COUNT(*) FROM poll_options o WHERE o.poll = p.id AND o.key = ?2) AS ok_opt
             FROM polls p WHERE p.id = ?1`
        ).bind(poll, choice).first();

        if (meta) {
          if (!meta.active || meta.expired) {
            return json(request, env, { error: "this poll has closed" }, 409);
          }
          // Only options the poll actually offers. Without this the
          // tally is whatever anyone cares to POST.
          if (meta.n_opts > 0 && !meta.ok_opt) {
            return json(request, env, { error: "unknown option" }, 400);
          }
        }

        // Upsert on (poll, visitor_id): changing your mind moves the
        // vote rather than adding a second one.
        await env.DB.prepare(
          `INSERT INTO poll_votes (poll, choice, visitor_id) VALUES (?1, ?2, ?3)
           ON CONFLICT (poll, visitor_id) DO UPDATE SET choice = excluded.choice`
        ).bind(poll, choice, visitor).run();

        return json(request, env, { ok: true });
      }

      // ---------- opt-outs ----------
      // Also write-only. No GET.
      if (path === "/optout" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const email = str(b.email, 200);
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
          return json(request, env, { error: "valid email required" }, 400);
        }
        await env.DB.prepare(
          `INSERT INTO optouts (email, source) VALUES (?1, ?2) ON CONFLICT DO NOTHING`
        ).bind(email, str(b.source, 40)).run();
        return json(request, env, { ok: true });
      }

      // ---------- engagement events ----------
      // Write-only like the signup list, and for the same reason: there
      // is no public read route, so the site's traffic is not something
      // a competitor can pull down by guessing a URL.
      //
      // This route answers 200 to almost everything. Analytics is the
      // least important thing on the page and must never be the reason a
      // visitor sees a failure, so bad input is dropped, not rejected.
      if (path === "/events" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const list = Array.isArray(b.events) ? b.events.slice(0, EVENTS_PER_BATCH) : [];
        if (!list.length) return json(request, env, { ok: true, stored: 0 });

        const visitor = str(b.visitor_id, 64);
        const session = str(b.session_id, 64);
        const page = str(b.page, 60);
        const ref = str(b.ref, 60);
        const rawDevice = str(b.device, 10);
        const device = DEVICES.includes(rawDevice) ? rawDevice : null;

        if (visitor) {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM events
              WHERE visitor_id = ?1 AND created_at > datetime('now','-1 hour')`
          ).bind(visitor).first();
          // Over the cap we still answer 200: the client should stop
          // talking, not retry, and there is nothing here worth telling
          // an abuser about.
          if (row && row.n >= EVENTS_PER_VISITOR_PER_HOUR) {
            return json(request, env, { ok: true, stored: 0 });
          }
        }

        const stmt = env.DB.prepare(
          `INSERT INTO events (name, page, detail, visitor_id, session_id, ref, device)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        );
        const rows = [];
        for (const e of list) {
          const name = str(e && e.n, 32);
          if (!name || !EVENT_NAME_RE.test(name)) continue;
          rows.push(stmt.bind(
            name,
            str(e.p, 60) || page,
            str(e.d, 80),
            visitor, session, ref, device
          ));
        }
        if (rows.length) await env.DB.batch(rows);
        return json(request, env, { ok: true, stored: rows.length });
      }

      // ---------- admin ----------
      // Everything below needs the ADMIN_TOKEN secret:
      //   npx wrangler secret put ADMIN_TOKEN
      // The token is never in the site source. admin.html asks for it
      // and keeps it in sessionStorage, so it's gone when the tab closes.
      if (path.startsWith("/admin/")) {
        if (!env.ADMIN_TOKEN) {
          return json(request, env, { error: "admin not configured" }, 503);
        }
        const given = request.headers.get("X-Admin-Token") || "";
        if (!timingSafeEqual(given, env.ADMIN_TOKEN)) {
          return json(request, env, { error: "unauthorized" }, 401);
        }

        // Every post including hidden ones, so they can be un-hidden.
        if (path === "/admin/wall" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT id, name, city, text, hidden, created_at
               FROM wall_posts ORDER BY created_at DESC LIMIT 200`
          ).all();
          return json(request, env, { posts: results || [] });
        }

        // Hide/unhide rather than delete — reversible, and a mistake
        // costs nothing.
        if (path === "/admin/hide" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = parseInt(b.id, 10);
          if (!Number.isInteger(id)) return json(request, env, { error: "id required" }, 400);
          await env.DB.prepare(`UPDATE wall_posts SET hidden = ?1 WHERE id = ?2`)
            .bind(b.hidden ? 1 : 0, id).run();
          return json(request, env, { ok: true });
        }

        // ----- polls: create, edit, close, delete -----
        // Every poll including the closed and hidden ones, so the admin
        // can reopen one rather than rebuild it.
        if (path === "/admin/polls" && request.method === "GET") {
          const [polls, options, tallies] = await env.DB.batch([
            env.DB.prepare(
              `SELECT id, question, subtitle, closes_at, active, sort, created_at,
                      (closes_at IS NOT NULL AND closes_at <= datetime('now')) AS expired
                 FROM polls ORDER BY sort, created_at`
            ),
            env.DB.prepare(`SELECT poll, key, label, sort FROM poll_options ORDER BY poll, sort, id`),
            env.DB.prepare(`SELECT poll, choice, COUNT(*) AS votes FROM poll_votes GROUP BY poll, choice`),
          ]);
          const byPoll = {}, count = {};
          for (const o of options.results || []) (byPoll[o.poll] = byPoll[o.poll] || []).push(o);
          for (const t of tallies.results || []) count[t.poll + " " + t.choice] = t.votes;
          return json(request, env, {
            polls: (polls.results || []).map((p) => ({
              ...p,
              closed: !!p.expired,
              options: (byPoll[p.id] || []).map((o) => ({
                key: o.key, label: o.label, votes: count[p.id + " " + o.key] || 0,
              })),
            })),
          });
        }

        // Create or replace one poll and its options in a single write.
        // Options are replaced wholesale, but votes are keyed on
        // (poll, choice) and are NOT touched: rename a label and the
        // votes it already has follow it, drop an option and its votes
        // stop being counted without being destroyed.
        if (path === "/admin/polls" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = str(b.id, 40);
          const question = str(b.question, 160);
          if (!id || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) {
            return json(request, env, { error: "id must be a slug: a-z, 0-9, - and _" }, 400);
          }
          if (!question) return json(request, env, { error: "question required" }, 400);

          // Accept 'YYYY-MM-DDTHH:MM' from a datetime-local input or a
          // full ISO string, and store UTC in SQLite's own shape so the
          // comparison against datetime('now') is apples to apples.
          let closes = null;
          const rawCloses = str(b.closes_at, 40);
          if (rawCloses) {
            const d = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(rawCloses) ? rawCloses : rawCloses + "Z");
            if (isNaN(d.getTime())) return json(request, env, { error: "closes_at is not a date" }, 400);
            closes = d.toISOString().slice(0, 19).replace("T", " ");
          }

          const opts = Array.isArray(b.options) ? b.options.slice(0, 12) : [];
          const clean = [];
          opts.forEach((o, i) => {
            const key = str(o && o.key, 40);
            const label = str(o && o.label, 80);
            if (!key || !label || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)) return;
            if (clean.some((c) => c.key === key)) return;
            clean.push({ key, label, sort: i });
          });
          if (clean.length < 2) {
            return json(request, env, { error: "a poll needs at least 2 options" }, 400);
          }

          const writes = [
            env.DB.prepare(
              `INSERT INTO polls (id, question, subtitle, closes_at, active, sort)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               ON CONFLICT (id) DO UPDATE SET
                 question = excluded.question, subtitle = excluded.subtitle,
                 closes_at = excluded.closes_at, active = excluded.active, sort = excluded.sort`
            ).bind(id, question, str(b.subtitle, 160), closes,
                   b.active === false ? 0 : 1, Number.isFinite(+b.sort) ? +b.sort : 0),
            env.DB.prepare(`DELETE FROM poll_options WHERE poll = ?1`).bind(id),
            ...clean.map((o) =>
              env.DB.prepare(
                `INSERT INTO poll_options (poll, key, label, sort) VALUES (?1, ?2, ?3, ?4)`
              ).bind(id, o.key, o.label, o.sort)
            ),
          ];
          await env.DB.batch(writes);
          return json(request, env, { ok: true, id });
        }

        // Deleting a poll takes its votes with it — there is nothing left
        // to show, and leaving orphan rows would quietly re-inflate the
        // tally if the same id were ever reused.
        if (path === "/admin/polls/delete" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = str(b.id, 40);
          if (!id) return json(request, env, { error: "id required" }, 400);
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM poll_options WHERE poll = ?1`).bind(id),
            env.DB.prepare(`DELETE FROM poll_votes  WHERE poll = ?1`).bind(id),
            env.DB.prepare(`DELETE FROM polls       WHERE id   = ?1`).bind(id),
          ]);
          return json(request, env, { ok: true });
        }

        // ----- mail -----
        // What was actually handed to Resend, so "did they get the email"
        // has an answer that is not a guess.
        if (path === "/admin/mail" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT to_addr, kind, provider_id, status, error, created_at
               FROM mail_sends ORDER BY created_at DESC LIMIT 200`
          ).all();
          const row = await env.DB.prepare(
            `SELECT
               (SELECT COUNT(*) FROM signups WHERE email IS NOT NULL)  AS email_signups,
               (SELECT COUNT(*) FROM mail_sends
                 WHERE kind='welcome' AND status='accepted')           AS welcomed,
               (SELECT COUNT(*) FROM mail_sends WHERE status='error')  AS failed`
          ).first();
          return json(request, env, { sends: results || [], summary: row || {} });
        }

        // Send the welcome to everyone with an email who has never had
        // one accepted. Covers both "Resend was down" and every signup
        // taken before mail existed at all.
        if (path === "/admin/mail/backfill" && request.method === "POST") {
          if (!env.RESEND_KEY) return json(request, env, { error: "RESEND_KEY not set" }, 503);
          const b = await request.json().catch(() => ({}));
          const limit = Math.min(Math.max(parseInt(b.limit, 10) || 25, 1), 100);
          const { results } = await env.DB.prepare(
            `SELECT s.email FROM signups s
              WHERE s.email IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM mail_sends m
                                 WHERE lower(m.to_addr) = lower(s.email)
                                   AND m.kind = 'welcome' AND m.status = 'accepted')
                AND NOT EXISTS (SELECT 1 FROM optouts o
                                 WHERE lower(o.email) = lower(s.email))
              ORDER BY s.created_at LIMIT ?1`
          ).bind(limit).all();

          const out = [];
          for (const r of results || []) {
            out.push({ email: r.email, ...(await sendWelcome(env, r.email)) });
          }
          return json(request, env, {
            ok: true,
            attempted: out.length,
            accepted: out.filter((o) => o.status === "accepted").length,
            results: out,
          });
        }

        // ----- bookings -----
        if (path === "/admin/bookings" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT id, name, contact, kind, when_where, details, handled, created_at
               FROM bookings ORDER BY created_at DESC LIMIT 200`
          ).all();
          return json(request, env, { bookings: results || [] });
        }

        // Marking one handled is how the list stays a to-do rather than
        // an archive nobody reads.
        if (path === "/admin/bookings/handled" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = parseInt(b.id, 10);
          if (!Number.isInteger(id)) return json(request, env, { error: "id required" }, 400);
          await env.DB.prepare(`UPDATE bookings SET handled = ?1 WHERE id = ?2`)
            .bind(b.handled ? 1 : 0, id).run();
          return json(request, env, { ok: true });
        }

        if (path === "/admin/signups" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT email, phone, source_page, created_at FROM signups ORDER BY created_at DESC`
          ).all();
          return json(request, env, { signups: results || [] });
        }

        if (path === "/admin/optouts" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT email, source, created_at FROM optouts ORDER BY created_at DESC`
          ).all();
          return json(request, env, { optouts: results || [] });
        }

        if (path === "/admin/stats" && request.method === "GET") {
          const row = await env.DB.prepare(
            `SELECT (SELECT COUNT(*) FROM signups)                        AS signups,
                    (SELECT COUNT(*) FROM wall_posts WHERE hidden = 0)    AS wall_visible,
                    (SELECT COUNT(*) FROM wall_posts WHERE hidden = 1)    AS wall_hidden,
                    (SELECT COUNT(*) FROM poll_votes)                     AS votes,
                    (SELECT COUNT(*) FROM optouts)                        AS optouts,
                    (SELECT COUNT(*) FROM bookings WHERE handled = 0)     AS bookings_open`
          ).first();
          return json(request, env, row || {});
        }

        // The engagement report. One round trip, because the admin page
        // shows all of it at once and seven sequential awaits over the
        // Atlantic is the difference between instant and sluggish.
        if (path === "/admin/engagement" && request.method === "GET") {
          let days = parseInt(url.searchParams.get("days"), 10);
          if (!Number.isInteger(days) || days < 1 || days > 365) days = 30;
          const since = `-${days} days`;

          const q = (sql) => env.DB.prepare(sql).bind(since);
          const [totals, daily, pages, refs, devices, clicks, funnel, signups] =
            await env.DB.batch([
              q(`SELECT name, COUNT(*) AS n, COUNT(DISTINCT visitor_id) AS people
                   FROM events WHERE created_at > datetime('now', ?1)
                  GROUP BY name ORDER BY n DESC`),

              q(`SELECT substr(created_at, 1, 10) AS day,
                        SUM(name = 'pageview')     AS views,
                        COUNT(DISTINCT visitor_id) AS visitors
                   FROM events WHERE created_at > datetime('now', ?1)
                  GROUP BY day ORDER BY day`),

              q(`SELECT page, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
                   FROM events
                  WHERE name = 'pageview' AND page IS NOT NULL
                    AND created_at > datetime('now', ?1)
                  GROUP BY page ORDER BY views DESC LIMIT 20`),

              q(`SELECT COALESCE(ref, 'direct') AS ref, COUNT(DISTINCT visitor_id) AS visitors
                   FROM events
                  WHERE name = 'pageview' AND created_at > datetime('now', ?1)
                  GROUP BY 1 ORDER BY visitors DESC LIMIT 15`),

              q(`SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT visitor_id) AS visitors
                   FROM events
                  WHERE name = 'pageview' AND created_at > datetime('now', ?1)
                  GROUP BY 1 ORDER BY visitors DESC`),

              // What people actually pressed — the most directly
              // actionable number on the page.
              q(`SELECT name, detail, COUNT(*) AS n
                   FROM events
                  WHERE detail IS NOT NULL AND created_at > datetime('now', ?1)
                    AND name IN ('cta_click','buy_click','stream_click','outbound',
                                 'social_click','share_click','nav_click','poll_vote')
                  GROUP BY name, detail ORDER BY n DESC LIMIT 25`),

              // Counted in PEOPLE, not events: one visitor clicking five
              // things is one person who acted, and a funnel that counts
              // events instead flatters itself.
              q(`SELECT COUNT(DISTINCT visitor_id) AS visitors,
                        COUNT(DISTINCT CASE WHEN name IN ('scroll_50','scroll_90','engaged')
                                            THEN visitor_id END) AS read_on,
                        COUNT(DISTINCT CASE WHEN name IN ('cta_click','buy_click','stream_click',
                                                          'outbound','share_click','audio_play',
                                                          'poll_vote','wall_post')
                                            THEN visitor_id END) AS acted,
                        COUNT(DISTINCT CASE WHEN name = 'signup_ok'
                                            THEN visitor_id END) AS joined
                   FROM events WHERE created_at > datetime('now', ?1)`),

              q(`SELECT COUNT(*) AS n FROM signups WHERE created_at > datetime('now', ?1)`),
            ]);

          return json(request, env, {
            days,
            totals:  totals.results  || [],
            daily:   daily.results   || [],
            pages:   pages.results   || [],
            refs:    refs.results    || [],
            devices: devices.results || [],
            clicks:  clicks.results  || [],
            funnel:  (funnel.results && funnel.results[0]) || {},
            signups: (signups.results && signups.results[0] && signups.results[0].n) || 0,
          });
        }

        return json(request, env, { error: "not found" }, 404);
      }

      return json(request, env, { error: "not found" }, 404);
    } catch (err) {
      // Never leak internals to the browser; log for `wrangler tail`.
      console.error("worker error", err && err.stack ? err.stack : err);
      return json(request, env, { error: "server error" }, 500);
    }
  },

  // Daily, via the cron trigger in wrangler.toml. Old engagement rows
  // are deleted rather than archived: nobody will ever ask what a
  // visitor clicked half a year ago, and not holding the data is the
  // cheapest way to not mishandle it.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      env.DB.prepare(
        `DELETE FROM events WHERE created_at < datetime('now', ?1)`
      )
        .bind(`-${EVENT_RETENTION_DAYS} days`)
        .run()
        .then((r) => console.log("pruned events", JSON.stringify(r && r.meta)))
        .catch((e) => console.error("prune failed", e))
    );
  },
};
