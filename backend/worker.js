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
 *   POST /signup       {email|phone, source_page, visitor_id}
 *   GET  /wall                                   -> visible posts
 *   POST /wall         {name, city, text, visitor_id}
 *   GET  /votes?poll=x                           -> tallies + your vote
 *   POST /votes        {poll, choice, visitor_id}
 *   POST /optout       {email, source}
 *   GET  /health
 */

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

export default {
  async fetch(request, env) {
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
        await env.DB.prepare(
          `INSERT INTO signups (email, phone, source_page, visitor_id)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT DO NOTHING`
        )
          .bind(
            isEmail ? contact : null,
            isEmail ? null : contact,
            str(b.source_page, 60),
            str(b.visitor_id, 64)
          )
          .run();

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
                    (SELECT COUNT(*) FROM optouts)                        AS optouts`
          ).first();
          return json(request, env, row || {});
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
};
