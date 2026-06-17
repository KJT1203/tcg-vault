# Price proxy (Cloudflare Worker)

This Worker lets TCG Vault show **live prices** without exposing any API keys.
The browser can't call these price APIs directly (CORS is blocked and the keys
must stay server-side), so the app calls this Worker and the Worker calls the
APIs. It serves two endpoints, each enabled only if you set its secret:

| Endpoint | Source | Data | Secret(s) |
| --- | --- | --- | --- |
| `/graded` | [PokemonPriceTracker](https://www.pokemonpricetracker.com) | PSA/BGS/CGC **sold** averages (Pokémon) | `PPT_API_KEY` |
| `/search` | eBay Browse API | lowest/median/highest **asking** prices (active listings) | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |

The app uses `/graded` for Pokémon cards and `/search` for Weiss Schwarz.
Set up whichever you want — you don't need both.

## Recommended: graded Pokémon prices (PokemonPriceTracker)

### 1. Get an API key (you do this)
1. Sign up at <https://www.pokemonpricetracker.com> and open your account / API page.
2. Copy your API key. The free tier is ~100 credits/day (a graded lookup costs
   2 credits), which is plenty for personal browsing — and the app caches each
   card so reopening it doesn't spend more.

### 2. Deploy the Worker
```bash
npm install -g wrangler
cd worker
wrangler login
wrangler secret put PPT_API_KEY     # paste your PokemonPriceTracker key
wrangler deploy
```
Wrangler prints a URL like `https://tcg-vault-price-proxy.<you>.workers.dev`.

### 3. Point the app at it
In [`../config.js`](../config.js):
```js
window.TCG_VAULT_CONFIG = {
  proxyUrl: "https://tcg-vault-price-proxy.<you>.workers.dev",
};
```
Reload, open a Pokémon card → a **Graded prices** panel shows Ungraded + PSA/BGS/CGC values.

Test directly:
```bash
curl "https://tcg-vault-price-proxy.<you>.workers.dev/graded?q=Charizard%20ex&set=151"
```

## Optional: eBay asking prices (Weiss Schwarz)

Weiss Schwarz cards aren't graded by PSA/BGS/CGC and no service tracks them, so
for those we fall back to eBay active-listing **asking** prices.

1. Create a developer account at <https://developer.ebay.com>, accept the terms,
   and make a **Production** keyset → note your **App ID** and **Cert ID**.
   *(Creating the account / accepting terms is something only you can do.)*
2. Add the secrets and redeploy:
   ```bash
   wrangler secret put EBAY_CLIENT_ID       # App ID
   wrangler secret put EBAY_CLIENT_SECRET   # Cert ID
   wrangler deploy
   ```

> ⚠️ eBay's Browse API returns **asking** prices, not completed sales. eBay's
> sold-price data (Marketplace Insights API) is a Limited Release that eBay must
> approve; if you get it, swap the search call in `price-proxy.js`.

## Notes
- Optionally set `ALLOWED_ORIGIN` in `wrangler.toml` to your site's origin so the
  proxy only answers your app.
- The Worker caches the eBay OAuth token in-memory and sends a 15-minute
  `Cache-Control` header to stay within rate limits.
