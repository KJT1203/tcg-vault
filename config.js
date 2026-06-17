/**
 * TCG Vault — runtime config
 *
 * To enable live eBay prices in the card detail view, deploy the Cloudflare
 * Worker in /worker (see worker/README.md), then paste its URL here. Leave it
 * empty to keep the app a pure static site with the eBay section hidden.
 *
 * Example: ebayProxyUrl: "https://tcg-vault-ebay-proxy.yourname.workers.dev"
 */
window.TCG_VAULT_CONFIG = {
  ebayProxyUrl: "",
};
