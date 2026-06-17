"""
Build the bundled Weiss Schwarz dataset for TCG Vault.

Why this exists: the Encore Decks API does not send CORS headers, so a static
site can't fetch it from the browser. Instead we pull the data once here and
bundle it as data/weiss.json. The card *images* are hot-linked at runtime
(image <img> tags aren't subject to CORS), so only the card data is bundled.

Run:  python scripts/build_weiss.py
"""

import json
import sys
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8")

API = "https://www.encoredecks.com/api/card?cardcode="
IMG_BASE = "https://www.encoredecks.com/images/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; tcg-vault-builder/1.0)"}

# Curated set prefix -> friendly franchise label. These were discovered by
# probing the cardsearch endpoint across popular franchises.
SETS = [
    ("SAO/S20", "Sword Art Online"),
    ("AOT/S35", "Attack on Titan"),
    ("RZ/S46", "Re:Zero"),
    ("KS/W49", "KonoSuba"),
    ("LL/W24", "Love Live!"),
    ("LSS/W45", "Love Live! Sunshine!!"),
    ("TSK/S70", "That Time I Got Reincarnated as a Slime"),
    ("KGL/S79", "Kaguya-sama: Love Is War"),
    ("SFN/S108", "Frieren: Beyond Journey's End"),
    ("CSM/S96", "Chainsaw Man"),
    ("P5/S45", "Persona 5"),
    ("PD/S22", "Hatsune Miku Project DIVA"),
    ("BM/S15", "Bakemonogatari"),
    ("SPY/S106", "Spy x Family"),
    ("UMA/W106", "Uma Musume Pretty Derby"),
    ("UMA/W119", "Uma Musume Pretty Derby"),
    ("UMA/W134", "Uma Musume: Cinderella Gray"),
]

NUM_PER_SET = 45  # enumerate -001 .. -045 for each set

TYPE_MAP = {"CH": "Character", "EV": "Event", "CX": "Climax"}


def fetch(cardcode):
    url = API + urllib.parse.quote(cardcode)
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("error") or not data.get("cardcode"):
        return None
    return data


def pick_locale(card):
    loc = card.get("locale", {}) or {}
    en = loc.get("EN") or {}
    np = loc.get("NP") or {}
    name = en.get("name") or np.get("name")
    traits = en.get("attributes") or np.get("attributes") or []
    ability = en.get("ability") or np.get("ability") or []
    return name, traits, ability


def normalize(card, franchise):
    name, traits, ability = pick_locale(card)
    if not name:
        return None
    color = (card.get("colour") or "").title() or None
    return {
        "id": card.get("cardcode"),
        "name": name,
        "franchise": franchise,
        "setCode": card.get("cardcode", "").rsplit("-", 1)[0],
        "type": TYPE_MAP.get(card.get("cardtype"), card.get("cardtype")),
        "color": color,
        "level": card.get("level"),
        "cost": card.get("cost"),
        "power": card.get("power"),
        "soul": card.get("soul"),
        "rarity": card.get("rarity"),
        "traits": [t for t in traits if t],
        "trigger": card.get("trigger") or [],
        "text": " ".join(a for a in ability if a).strip(),
        "image": IMG_BASE + card["imagepath"] if card.get("imagepath") else None,
    }


def main():
    jobs = []
    for prefix, franchise in SETS:
        for n in range(1, NUM_PER_SET + 1):
            jobs.append((f"{prefix}-{n:03d}", franchise))

    print(f"Fetching {len(jobs)} candidate cards across {len(SETS)} sets...")
    out = []
    start = time.time()

    def work(job):
        cardcode, franchise = job
        card = fetch(cardcode)
        if not card:
            return None
        return normalize(card, franchise)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for rec in pool.map(work, jobs):
            if rec and rec.get("image"):
                out.append(rec)

    # Stable sort: franchise, then set, then card number.
    def sort_key(r):
        cc = r["id"]
        num = cc.rsplit("-", 1)[-1]
        return (r["franchise"], r["setCode"], num)

    out.sort(key=sort_key)

    with open("data/weiss.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)

    by_fr = {}
    for r in out:
        by_fr[r["franchise"]] = by_fr.get(r["franchise"], 0) + 1
    print(f"\nWrote {len(out)} cards to data/weiss.json in {time.time()-start:.1f}s")
    for fr, c in sorted(by_fr.items(), key=lambda kv: -kv[1]):
        print(f"  {c:3}  {fr}")


if __name__ == "__main__":
    main()
