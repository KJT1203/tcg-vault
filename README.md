# 🃏 TCG Vault

A clean, fast browser for **trading card games** — explore real **Pokémon** and **Weiss Schwarz** cards with actual artwork and stats. Search, filter, flip through full sets, and build a personal collection. Designed with a calm, Apple-style aesthetic.

![Built with HTML, CSS, and vanilla JavaScript](https://img.shields.io/badge/built%20with-HTML%20%2B%20CSS%20%2B%20JS-0071e3)

> No framework, no build step. Just open it and browse.

## ✨ Features

- **Two card games, one interface** — switch between Pokémon and Weiss Schwarz with a smooth segmented control
- **Real card images & data** — pulled from public TCG APIs (see *Data sources* below)
- **Live Pokémon search** — searches the full Pokémon TCG catalogue in real time as you type
- **Smart filters** — by set / series, rarity, and type or color, plus sorting (name, rarity, price)
- **Card detail view** — a clean modal with the full-size card, every stat, and ability text
- **Your collection** — heart any card to save it; persists in your browser via `localStorage`
- **Light & dark mode** — follows your system, toggle any time
- **Polished touches** — frosted-glass nav, image shimmer placeholders, infinite scroll, hover lift, reduced-motion support
- **Fully responsive** — works from phone to desktop

## 🎮 What's included

| Game | Cards bundled | Live search |
| --- | --- | --- |
| **Pokémon** | 1,168 — the full *Mega Evolution* era (5 sets), the *151* set, and the 1999 *Base Set* | ✅ entire catalogue via API |
| **Weiss Schwarz** | 782 across 16 series* + 23 signature (signed) cards | ❌ (filtered locally) |

Cards are grouped into **categories** (Pokémon eras / Weiss Schwarz franchises), with a Set dropdown that narrows to the selected category. Each game has its own accent theme.

\*Sword Art Online, Attack on Titan, Re:Zero, KonoSuba, Love Live!, Slime, Kaguya-sama, Frieren, Chainsaw Man, Persona 5, Hatsune Miku, Bakemonogatari, Spy x Family, Uma Musume Pretty Derby, Uma Musume: Cinderella Gray, and more. Signature cards (rarity **SP** — autographed parallels) get their own **✦ Signatures** category.

## 🚀 Run it

It's static files — no install needed:

```bash
# serve it locally (any static server works)
npx serve .
# or
python -m http.server
```

Then open the page. (It must be *served*, not opened as a `file://` URL, because it fetches the bundled JSON data.)

## 🛠️ How it works

```
tcg-vault/
├─ index.html        # structure
├─ style.css         # Apple-inspired design system (light/dark)
├─ app.js            # game adapters, search, filters, modal, collection
├─ data/
│  ├─ pokemon.json           # bundled Pokémon cards
│  ├─ weiss.json             # bundled Weiss Schwarz cards
│  └─ weiss-signatures.json  # signed "signature" (SP) cards
└─ scripts/
   ├─ build_pokemon.py     # regenerates data/pokemon.json
   ├─ build_weiss.py       # regenerates data/weiss.json
   └─ build_signatures.py  # regenerates data/weiss-signatures.json
```

Each game is a small **adapter** in `app.js` that knows how to load its data and turn a raw record into a common card shape the UI renders. Adding a third game is mostly a matter of writing another adapter and a data file.

**Why some data is bundled:** the Pokémon TCG API sends CORS headers, so the app can call it directly from the browser for live search. The Weiss Schwarz source (Encore Decks) does **not**, so that data is fetched once by `scripts/build_weiss.py` and saved into the repo. Card *images* are hot-linked at runtime from the original sources (image tags aren't subject to CORS).

To refresh or expand the bundled data:

```bash
python scripts/build_pokemon.py
python scripts/build_weiss.py
python scripts/build_signatures.py
```

## 💰 Optional: live prices

The card detail view can show **live prices**, **off by default** so the app
stays a pure static site. Because the price APIs block browser calls and need
server-held keys, enabling it means deploying the small Cloudflare Worker in
[`worker/`](worker/) and pasting its URL into [`config.js`](config.js) — full
steps in [worker/README.md](worker/README.md). One Worker serves both:

- **Pokémon → graded prices.** PSA/BGS/CGC + ungraded **sold** averages via
  [PokemonPriceTracker](https://www.pokemonpricetracker.com) (free tier).
  Results are cached per card to save API credits.
- **Weiss Schwarz → asking prices.** Lowest/median/highest from active eBay
  listings (WS cards aren't graded, so no graded data exists for them). Note
  these are *asking* prices, not completed sales — eBay's sold-price API is
  access-restricted.

The panel shows when the figures were last checked and has a **refresh**
button to re-fetch in place (Pokémon refreshes bypass the per-card cache).

For ungraded Pokémon, the TCGplayer *market* price is also already shown on
every card with no setup at all.

## 📚 Data sources

- **Pokémon** — the [Pokémon TCG API](https://pokemontcg.io) (`api.pokemontcg.io`)
- **Weiss Schwarz** — [Encore Decks](https://www.encoredecks.com)
- **Weiss Schwarz signature cards** — the community [WeissSchwarz-ENG-DB](https://github.com/CCondeluci/WeissSchwarz-ENG-DB), which links the official `en.ws-tcg.com` card images (Encore Decks, a deck builder, doesn't carry signed parallels)
- **Umamusume: Pretty Derby (UMA/W106)** — the full Japanese set from the community [WeissSchwarz-JP-DB](https://github.com/CCondeluci/WeissSchwarz-JP-DB) (Japanese names and card text, official `ws-tcg.com` images)

Card images and names are © their respective owners (The Pokémon Company, Bushiroad, and the original IP holders). This is a non-commercial fan project built for learning.

## 📄 License

[MIT](LICENSE) for the code in this repository. The bundled card data and linked images belong to their respective owners.
