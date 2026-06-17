"""
Build the Weiss Schwarz "signature card" dataset for TCG Vault.

Signature cards (rarity SP = "Signed Parallel") are foil cards stamped with
the voice actor's autograph. Encore Decks (our main Weiss Schwarz source) is a
deck builder and doesn't carry these parallels, so we pull them from the
community English database instead, which links the official card images.

Signed cards are rare in the English release, so this is a small set — it is
genuinely "all the signature cards" available from this source.

Run:  python scripts/build_signatures.py
"""

import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8")

UA = {"User-Agent": "Mozilla/5.0 (compatible; tcg-vault-builder/1.0)"}
TREE = "https://api.github.com/repos/CCondeluci/WeissSchwarz-ENG-DB/git/trees/master?recursive=1"
RAW = "https://raw.githubusercontent.com/CCondeluci/WeissSchwarz-ENG-DB/master/"

# Rarities that denote a signed / signature parallel.
SIGNATURE_RARITIES = {"SP", "SSP", "RR/SP", "R/SP", "U/SP", "C/SP", "SP/SR"}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return json.load(r)
    except Exception:
        return None


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def normalize(c):
    code = c.get("code", "")
    return {
        "id": code,
        "name": c.get("name"),
        "category": "✦ Signatures",  # ✦ — its own group so they're easy to find
        "franchise": c.get("expansion"),  # the real series, shown on the card
        "setCode": code.rsplit("-", 1)[0] if "-" in code else code,
        "type": c.get("type"),
        "color": (c.get("color") or "").title() or None,
        "level": to_int(c.get("level")),
        "cost": to_int(c.get("cost")),
        "power": to_int(c.get("power")),
        "soul": to_int(c.get("soul")),
        "rarity": c.get("rarity"),
        "traits": [a for a in (c.get("attributes") or []) if a],
        "trigger": c.get("trigger") or [],
        "text": " ".join(a for a in (c.get("ability") or []) if a).strip(),
        "image": c.get("image"),
    }


def main():
    tree = get(TREE)
    files = [
        t["path"]
        for t in tree["tree"]
        if t["path"].startswith("DB/") and t["path"].endswith(".json")
    ]
    print(f"Scanning {len(files)} set files for signature cards...")

    def scan(path):
        d = get(RAW + path)
        if not isinstance(d, list):
            return []
        return [c for c in d if str(c.get("rarity", "")).upper() in SIGNATURE_RARITIES]

    sigs = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        for found in pool.map(scan, files):
            sigs.extend(found)

    out = [normalize(c) for c in sigs if c.get("image") and c.get("name")]
    out.sort(key=lambda r: (r["franchise"] or "", r["id"]))

    with open("data/weiss-signatures.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)

    print(f"Wrote {len(out)} signature cards to data/weiss-signatures.json")
    by_fr = {}
    for r in out:
        by_fr[r["franchise"]] = by_fr.get(r["franchise"], 0) + 1
    for fr, n in sorted(by_fr.items(), key=lambda kv: -kv[1]):
        print(f"  {n:3}  {fr}")


if __name__ == "__main__":
    main()
