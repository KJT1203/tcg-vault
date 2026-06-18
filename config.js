/**
 * TCG Vault — runtime config
 *
 * To enable live prices in the card detail view, deploy the Cloudflare Worker
 * in /worker (see worker/README.md), then paste its URL here. Leave it empty to
 * keep the app a pure static site with the price panel hidden.
 *
 * The same Worker serves both:
 *   • Pokémon graded prices  (PSA/BGS/CGC) via PokemonPriceTracker
 *   • Weiss Schwarz asking prices via eBay
 * Each turns on only if you set its secret on the Worker.
 *
 * Example: proxyUrl: "https://tcg-vault-price-proxy.yourname.workers.dev"
 */
window.TCG_VAULT_CONFIG = {
  proxyUrl: "https://tcg-vault-price-proxy.khaijiant.workers.dev",
};
