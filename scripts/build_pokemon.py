"""
Build the bundled Pokemon dataset for TCG Vault.

The Pokemon TCG API (api.pokemontcg.io) *does* support CORS, so the app also
searches it live at runtime. We still bundle a couple of iconic sets so the
default grid paints instantly and works even if the API is unreachable.

Run:  python scripts/build_pokemon.py
"""

import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

API = "https://api.pokemontcg.io/v2/cards"
UA = {"User-Agent": "Mozilla/5.0 (compatible; tcg-vault-builder/1.0)"}

# Sets to bundle, in the order they should appear by default.
# The full Mega Evolution era leads, then the modern "151" reprint and the
# 1999 Base Set as classics. The card's "series" (era) becomes its category.
SETS = [
    "me1",     # Mega Evolution
    "me2",     # Phantasmal Flames
    "me2pt5",  # Ascended Heroes
    "me3",     # Perfect Order
    "me4",     # Chaos Rising
    "sv3pt5",  # 151
    "base1",   # Base
]


def fetch_set(set_id):
    """Fetch every card in a set, following pagination (some sets are >250)."""
    cards = []
    page = 1
    while True:
        url = f"{API}?q=set.id:{set_id}&pageSize=250&page={page}&orderBy=number"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.load(r)
        batch = data.get("data", [])
        cards.extend(batch)
        if len(batch) < 250:
            break
        page += 1
    return cards


def market_price(card):
    tp = (card.get("tcgplayer") or {}).get("prices") or {}
    for variant in tp.values():
        if isinstance(variant, dict) and variant.get("market"):
            return variant["market"]
    return None


def normalize(card):
    images = card.get("images") or {}
    if not images.get("large"):
        return None
    flavor = card.get("flavorText")
    if not flavor:
        attacks = card.get("attacks") or []
        flavor = attacks[0]["text"] if attacks and attacks[0].get("text") else None
    set_obj = card.get("set") or {}
    return {
        "id": card.get("id"),
        "name": card.get("name"),
        "category": set_obj.get("series"),  # the "era" — used to group sets
        "setName": set_obj.get("name"),
        "setId": set_obj.get("id"),
        "number": card.get("number"),
        "printedTotal": set_obj.get("printedTotal"),
        "supertype": card.get("supertype"),
        "subtypes": card.get("subtypes") or [],
        "types": card.get("types") or [],
        "hp": card.get("hp"),
        "rarity": card.get("rarity"),
        "artist": card.get("artist"),
        "flavor": flavor,
        "image": images.get("large"),
        "imageSmall": images.get("small"),
        "price": market_price(card),
    }


def main():
    out = []
    for set_id in SETS:
        cards = fetch_set(set_id)
        kept = [n for n in (normalize(c) for c in cards) if n]
        out.extend(kept)
        print(f"  {set_id}: {len(kept)} cards")

    with open("data/pokemon.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print(f"Wrote {len(out)} cards to data/pokemon.json")


if __name__ == "__main__":
    main()
