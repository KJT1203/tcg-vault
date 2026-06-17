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
| **Pokémon** | 309 (the *151* set + the 1999 *Base Set*) | ✅ entire catalogue via API |
| **Weiss Schwarz** | 624 across 14 popular series* | ❌ (filtered locally) |

\*Sword Art Online, Attack on Titan, Re:Zero, KonoSuba, Love Live!, Slime, Kaguya-sama, Frieren, Chainsaw Man, Persona 5, Hatsune Miku, Bakemonogatari, Spy x Family, and more.

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
│  ├─ pokemon.json   # bundled featured Pokémon cards
│  └─ weiss.json     # bundled Weiss Schwarz cards
└─ scripts/
   ├─ build_pokemon.py   # regenerates data/pokemon.json
   └─ build_weiss.py     # regenerates data/weiss.json
```

Each game is a small **adapter** in `app.js` that knows how to load its data and turn a raw record into a common card shape the UI renders. Adding a third game is mostly a matter of writing another adapter and a data file.

**Why some data is bundled:** the Pokémon TCG API sends CORS headers, so the app can call it directly from the browser for live search. The Weiss Schwarz source (Encore Decks) does **not**, so that data is fetched once by `scripts/build_weiss.py` and saved into the repo. Card *images* are hot-linked at runtime from the original sources (image tags aren't subject to CORS).

To refresh or expand the bundled data:

```bash
python scripts/build_pokemon.py
python scripts/build_weiss.py
```

## 📚 Data sources

- **Pokémon** — the [Pokémon TCG API](https://pokemontcg.io) (`api.pokemontcg.io`)
- **Weiss Schwarz** — [Encore Decks](https://www.encoredecks.com)

Card images and names are © their respective owners (The Pokémon Company, Bushiroad, and the original IP holders). This is a non-commercial fan project built for learning.

## 📄 License

[MIT](LICENSE) for the code in this repository. The bundled card data and linked images belong to their respective owners.
