# eBay price proxy (Cloudflare Worker)

This small Worker lets TCG Vault show **live eBay prices** without exposing any
secrets. The browser can't call eBay directly (eBay blocks CORS, and the OAuth
flow needs a client secret that must never ship in front-end code), so the app
calls this Worker instead, and the Worker calls eBay.

## ⚠️ What you get (and don't)

- ✅ **Asking prices** from **active listings** (eBay's Browse API), summarised
  as lowest / median / highest, plus a few example listings.
- ❌ **Not** completed-sale ("sold") prices. Those live in eBay's **Marketplace
  Insights API**, which is a *Limited Release* eBay must approve for your app.
  If you get that access, swap the `EBAY_BROWSE` search call in `ebay-proxy.js`
  for the Marketplace Insights `item_sales/search` endpoint — the rest is the same.
- Graded prices work by putting the grade (e.g. `PSA 10`) into the search query,
  so they're only as accurate as the matching listings.

## Setup

### 1. Get eBay API credentials (you must do this yourself)

1. Create a developer account at <https://developer.ebay.com> and accept the terms.
2. Create a **Production** keyset under *Application Keys*.
3. Note your **App ID (Client ID)** and **Cert ID (Client Secret)**.

> Creating the account and accepting eBay's terms is something only you can do.

### 2. Deploy the Worker

```bash
npm install -g wrangler        # Cloudflare's CLI
cd worker
wrangler login                 # opens your Cloudflare account
wrangler secret put EBAY_CLIENT_ID       # paste your App ID
wrangler secret put EBAY_CLIENT_SECRET   # paste your Cert ID
wrangler deploy
```

Wrangler prints a URL like `https://tcg-vault-ebay-proxy.<you>.workers.dev`.

Optional: edit `wrangler.toml` and set `ALLOWED_ORIGIN` to your site's origin so
only your app can use the proxy.

### 3. Point the app at it

Open `../config.js` and set:

```js
window.TCG_VAULT_CONFIG = {
  ebayProxyUrl: "https://tcg-vault-ebay-proxy.<you>.workers.dev",
};
```

Reload the site. Open any card — an **eBay listings** panel appears with a grade
selector. Until `ebayProxyUrl` is set, the panel stays hidden and the app remains
a pure static site.

## Test the Worker directly

```bash
curl "https://tcg-vault-ebay-proxy.<you>.workers.dev/search?q=Charizard%20ex%20151%20PSA%2010&category=183454"
```

## Notes

- The Worker caches the eBay OAuth token in-memory and sends a 15-minute
  `Cache-Control` header to stay well within eBay's rate limits (5,000
  Browse calls/day on the default production tier).
- `category=183454` is eBay's *CCG Individual Cards* category; the app sends it
  for Pokémon to cut noise and omits it for Weiss Schwarz.
