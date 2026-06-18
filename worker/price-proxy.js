/**
 * TCG Vault — price proxy (Cloudflare Worker)
 * -------------------------------------------
 * A static site can't safely call these price APIs (browser CORS is blocked and
 * the keys must never ship in front-end code). This Worker holds the keys, calls
 * the APIs, and returns CORS-enabled JSON the app can fetch.
 *
 * Two endpoints, each enabled only if its secret is set:
 *
 *   GET /graded?q=<name>&set=<set>   → graded prices (PSA/BGS/CGC sold averages)
 *       Source: PokemonPriceTracker.  Needs secret PPT_API_KEY.  Pokémon only.
 *
 *   GET /search?q=<text>&category=<id>   → lowest/median/highest ASKING prices
 *       Source: eBay Browse API (active listings, NOT sold).
 *       Needs secrets EBAY_CLIENT_ID + EBAY_CLIENT_SECRET.
 *
 * Set secrets with `wrangler secret put <NAME>`. See worker/README.md.
 */

const EBAY_OAUTH = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";
const PPT_CARDS = "https://www.pokemonpricetracker.com/api/v2/cards";

let ebayToken = null; // { token, expiresAt } cached within the isolate

// ---------- helpers ----------
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=900",
  };
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// "psa10" -> "PSA 10", "psa8_5" -> "PSA 8.5", "bgs9_5" -> "BGS 9.5"
function formatGrade(key) {
  const m = key.match(/^([a-z]+)([0-9]+(?:_[0-9]+)?)$/i);
  if (!m) return key.toUpperCase();
  return `${m[1].toUpperCase()} ${m[2].replace("_", ".")}`;
}

// The grades we surface, in display order (most collected first).
const GRADE_ORDER = [
  "psa10", "psa9", "psa8", "psa7",
  "bgs10", "bgs9_5", "bgs9",
  "cgc10", "cgc9_5", "cgc9",
  "sgc10",
];

// ---------- PokemonPriceTracker (graded) ----------
// One PPT search returning the top card (+ graded data).
async function pptFetchCard(searchText, set, env) {
  const params = new URLSearchParams({ search: searchText, includeEbay: "true", limit: "1" });
  if (set) params.set("set", set);
  const res = await fetch(`${PPT_CARDS}?${params}`, {
    headers: { Authorization: `Bearer ${env.PPT_API_KEY}` },
  });
  if (!res.ok) throw new Error(`ppt ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || body.cards || body.results || [];
  return list[0] || null;
}

async function handleGraded(url, env, cors) {
  if (!env.PPT_API_KEY) {
    return jsonResponse({ error: "graded prices not configured (set PPT_API_KEY)" }, 501, cors);
  }
  const q = url.searchParams.get("q");
  if (!q) return jsonResponse({ error: "missing q" }, 400, cors);
  const set = url.searchParams.get("set");
  const num = url.searchParams.get("num"); // padded collector number, e.g. "006/165"

  // Precise match first (name + collector number), then fall back to name only.
  let card = await pptFetchCard(num ? `${q} ${num}` : q, set, env);
  if (!card && num) card = await pptFetchCard(q, set, env);
  if (!card && set) card = await pptFetchCard(q, null, env);
  if (!card) return jsonResponse({ found: false, query: q }, 200, cors);

  const raw = (card.prices && (card.prices.market ?? card.prices.low)) ?? null;

  // Graded sold data lives under ebay.salesByGrade, keyed by grade.
  const sbg = (card.ebay && card.ebay.salesByGrade) || {};
  const grades = [];
  for (const key of GRADE_ORDER) {
    const g = sbg[key];
    if (!g) continue;
    const value =
      g.medianPrice ?? g.averagePrice ?? (g.smartMarketPrice && g.smartMarketPrice.price);
    if (typeof value === "number" && value > 0) {
      grades.push({ label: formatGrade(key), value, count: g.count || null });
    }
  }

  return jsonResponse(
    {
      found: true,
      source: "pokemonpricetracker",
      name: card.name || q,
      set: card.setName || set || null,
      number: card.cardNumber || null,
      raw: typeof raw === "number" ? raw : null,
      grades,
    },
    200,
    cors
  );
}

// ---------- eBay (active-listing asking prices) ----------
async function ebayAccessToken(env) {
  const now = Date.now();
  if (ebayToken && ebayToken.expiresAt > now + 60_000) return ebayToken.token;
  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch(EBAY_OAUTH, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE)}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  ebayToken = { token: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
  return ebayToken.token;
}

async function handleSearch(url, env, cors) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    return jsonResponse({ error: "eBay not configured (set EBAY_CLIENT_ID/SECRET)" }, 501, cors);
  }
  const q = url.searchParams.get("q");
  if (!q) return jsonResponse({ error: "missing q" }, 400, cors);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 50);
  const category = url.searchParams.get("category");
  const marketplace = env.EBAY_MARKETPLACE || "EBAY_US";

  const token = await ebayAccessToken(env);
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    filter: "buyingOptions:{FIXED_PRICE}",
    sort: "price",
  });
  if (category) params.set("category_ids", category);

  const res = await fetch(`${EBAY_BROWSE}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
  });
  if (!res.ok) return jsonResponse({ error: `ebay ${res.status}`, detail: await res.text() }, 502, cors);

  const data = await res.json();
  const items = (data.itemSummaries || [])
    .map((it) => ({
      title: it.title,
      price: it.price ? Number(it.price.value) : null,
      currency: it.price ? it.price.currency : null,
      url: it.itemWebUrl,
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

  return jsonResponse({ query: q, source: "ebay-active-listings", ...summary, items: items.slice(0, 5) }, 200, cors);
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === "/graded") return await handleGraded(url, env, cors);
      if (url.pathname === "/search") return await handleSearch(url, env, cors);
      return jsonResponse(
        { ok: true, endpoints: ["/graded?q=&set=", "/search?q=&category="] },
        200,
        cors
      );
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500, cors);
    }
  },
};
