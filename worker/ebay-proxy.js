/**
 * TCG Vault — eBay price proxy (Cloudflare Worker)
 * ------------------------------------------------
 * A static site can't talk to eBay directly: eBay blocks browser CORS, and the
 * OAuth flow needs a client secret that must never ship in front-end code. This
 * Worker sits in between — it holds the credentials, talks to eBay, and returns
 * a CORS-enabled price summary the app can fetch.
 *
 * IMPORTANT: this returns ASKING prices from ACTIVE listings (the Browse API).
 * eBay's actual sold-price data (Marketplace Insights API) is a Limited Release
 * that eBay must approve. If you get that access, swap the search URL below.
 *
 * Required secrets (set with `wrangler secret put`):
 *   EBAY_CLIENT_ID       your eBay App ID  (Client ID, production)
 *   EBAY_CLIENT_SECRET   your eBay Cert ID (Client Secret, production)
 * Optional vars (wrangler.toml [vars]):
 *   EBAY_MARKETPLACE     default "EBAY_US"
 *   ALLOWED_ORIGIN       e.g. "https://kjt1203.github.io" (default "*")
 */

const EBAY_OAUTH = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";

// Cached across requests within a Worker isolate to avoid re-minting tokens.
let cachedToken = null; // { token, expiresAt }

async function getToken(env) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch(EBAY_OAUTH, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(OAUTH_SCOPE)}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${await res.text()}`);

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=900", // be kind to eBay's rate limit
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== "/search") {
      return jsonResponse({ ok: true, usage: "/search?q=<text>&grade=<opt>&category=<opt>&limit=<opt>" }, 200, cors);
    }

    const q = url.searchParams.get("q");
    if (!q) return jsonResponse({ error: "missing q" }, 400, cors);

    const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 50);
    const category = url.searchParams.get("category"); // optional, e.g. 183454
    const marketplace = env.EBAY_MARKETPLACE || "EBAY_US";

    try {
      const token = await getToken(env);
      const params = new URLSearchParams({
        q,
        limit: String(limit),
        filter: "buyingOptions:{FIXED_PRICE}",
        sort: "price",
      });
      if (category) params.set("category_ids", category);

      const res = await fetch(`${EBAY_BROWSE}?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplace,
        },
      });
      if (!res.ok) {
        return jsonResponse({ error: `ebay ${res.status}`, detail: await res.text() }, 502, cors);
      }

      const data = await res.json();
      const items = (data.itemSummaries || [])
        .map((it) => ({
          title: it.title,
          price: it.price ? Number(it.price.value) : null,
          currency: it.price ? it.price.currency : null,
          condition: it.condition || null,
          url: it.itemWebUrl,
          image: it.image ? it.image.imageUrl : null,
        }))
        .filter((it) => it.price != null);

      const prices = items.map((i) => i.price).sort((a, b) => a - b);
      const summary = prices.length
        ? {
            count: prices.length,
            currency: items[0].currency,
            low: prices[0],
            median: prices[Math.floor(prices.length / 2)],
            high: prices[prices.length - 1],
          }
        : { count: 0 };

      return jsonResponse(
        { query: q, source: "ebay-browse-active-listings", ...summary, items: items.slice(0, 5) },
        200,
        cors
      );
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500, cors);
    }
  },
};
