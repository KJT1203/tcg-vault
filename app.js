/* ============================================================
   TCG Vault — app logic
   Two games, one clean interface.
   - Pokemon: bundled "featured" set + live search via the Pokemon TCG API
   - Weiss Schwarz: bundled dataset (its API has no CORS), filtered locally
   ============================================================ */

// ---- Game adapters --------------------------------------------
// Each game knows how to load its data and how to turn a raw record
// into the common "card" shape the UI renders.
const GAMES = {
  pokemon: {
    id: "pokemon",
    name: "Pokémon",
    dataUrls: ["data/pokemon.json"],
    typeLabel: "Type",
    live: true,
    toCard(r) {
      return {
        game: "pokemon",
        id: r.id,
        name: r.name,
        series: r.setName,
        image: r.image,
        thumb: r.imageSmall || r.image,
        rarity: r.rarity || "—",
        text: r.flavor || "",
        price: r.price,
        meta: [
          r.hp && ["HP", r.hp],
          r.types && r.types.length && ["Type", r.types.join(" / ")],
          r.supertype && ["Category", r.supertype],
          r.subtypes && r.subtypes.length && ["Subtype", r.subtypes.join(", ")],
          r.setName && ["Set", r.setName],
          r.number && ["Number", r.number + (r.printedTotal ? " / " + r.printedTotal : "")],
          r.artist && ["Illustrator", r.artist],
        ].filter(Boolean),
        facet: {
          category: r.category || r.setName || "Other",
          set: r.setName || "—",
          rarity: r.rarity || "—",
          type: (r.types && r.types[0]) || r.supertype || "—",
        },
      };
    },
    // Map a raw Pokemon TCG API card (live) into our bundled record shape.
    fromApi(c) {
      const img = c.images || {};
      const flavor =
        c.flavorText || (c.attacks && c.attacks[0] && c.attacks[0].text) || null;
      const tp = (c.tcgplayer && c.tcgplayer.prices) || {};
      let price = null;
      for (const v of Object.values(tp)) if (v && v.market) { price = v.market; break; }
      return {
        id: c.id,
        name: c.name,
        category: c.set && c.set.series,
        setName: c.set && c.set.name,
        setId: c.set && c.set.id,
        number: c.number,
        printedTotal: c.set && c.set.printedTotal,
        supertype: c.supertype,
        subtypes: c.subtypes || [],
        types: c.types || [],
        hp: c.hp,
        rarity: c.rarity,
        artist: c.artist,
        flavor,
        image: img.large,
        imageSmall: img.small,
        price,
      };
    },
  },

  weiss: {
    id: "weiss",
    name: "Weiss Schwarz",
    // Signatures load first so their category leads the list.
    dataUrls: ["data/weiss-signatures.json", "data/weiss.json"],
    typeLabel: "Color",
    live: false,
    toCard(r) {
      return {
        game: "weiss",
        id: r.id,
        name: r.name,
        series: r.franchise,
        image: r.image,
        thumb: r.image,
        rarity: r.rarity || "—",
        text: r.text || "",
        price: null,
        meta: [
          r.type && ["Type", r.type],
          r.color && ["Color", r.color],
          r.level != null && ["Level", String(r.level)],
          r.cost != null && ["Cost", String(r.cost)],
          r.power != null && ["Power", String(r.power)],
          r.soul != null && ["Soul", String(r.soul)],
          r.traits && r.traits.length && ["Traits", r.traits.join(" · ")],
          r.trigger && r.trigger.length && ["Trigger", r.trigger.join(", ")],
          r.setCode && ["Set", r.setCode],
        ].filter(Boolean),
        facet: {
          // Signature cards carry an explicit category ("✦ Signatures") so they
          // group together; everything else groups by its franchise.
          category: r.category || r.franchise,
          set: r.setCode ? r.setCode.split("/").pop() : "—",
          rarity: r.rarity || "—",
          type: r.color || r.type || "—",
        },
      };
    },
  },
};

// ---- App state ------------------------------------------------
const state = {
  game: "pokemon",
  view: "browse", // browse | collection
  query: "",
  filters: { category: "all", set: "all", rarity: "all", type: "all" },
  sort: "default",
  cards: [], // all cards for the current game (bundled, or live results)
  filtered: [], // after search + filters + sort
  rendered: 0, // how many of `filtered` are in the DOM (infinite scroll)
  liveMode: false,
  collection: new Set(JSON.parse(localStorage.getItem("tcg-collection") || "[]")),
};

const PAGE = 30;
const $ = (sel) => document.querySelector(sel);

// ---- Element refs ---------------------------------------------
const grid = $("#grid");
const searchInput = $("#search");
const searchSpinner = $("#searchSpinner");
const categoryChips = $("#categoryChips");
const setFilter = $("#setFilter");
const rarityFilter = $("#rarityFilter");
const typeFilter = $("#typeFilter");
const sortFilter = $("#sortFilter");
const resultCount = $("#resultCount");
const liveBadge = $("#liveBadge");
const emptyEl = $("#empty");
const collectionCount = $("#collectionCount");

// ---- Data loading ---------------------------------------------
const cache = {}; // game id -> raw bundled array

async function loadGame(gameId) {
  const game = GAMES[gameId];
  if (!cache[gameId]) {
    // `no-cache` revalidates with the server so rebuilt data is never stale.
    const urls = game.dataUrls || [game.dataUrl];
    const arrays = await Promise.all(
      urls.map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json()))
    );
    cache[gameId] = arrays.flat();
  }
  state.cards = cache[gameId].map((r) => game.toCard(r));
  state.liveMode = false;
}

// ---- Live Pokemon search --------------------------------------
let searchAbort = null;

async function livePokemonSearch(query) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const q = encodeURIComponent(`name:"${query}*"`);
  const url = `https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=60&orderBy=-set.releaseDate`;
  const res = await fetch(url, { signal: searchAbort.signal });
  if (!res.ok) throw new Error("API " + res.status);
  const json = await res.json();
  const game = GAMES.pokemon;
  return (json.data || []).map((c) => game.toCard(game.fromApi(c)));
}

// ---- Filtering & sorting --------------------------------------
function applyFilters() {
  const { query, filters, sort, view } = state;
  let list = state.cards;

  if (view === "collection") {
    list = list.filter((c) => state.collection.has(c.id));
  }

  // Text search (skip when live mode already searched server-side)
  if (query && !state.liveMode) {
    const q = query.toLowerCase();
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.series && c.series.toLowerCase().includes(q)) ||
        c.text.toLowerCase().includes(q)
    );
  }

  if (filters.category !== "all") list = list.filter((c) => c.facet.category === filters.category);
  if (filters.set !== "all") list = list.filter((c) => c.facet.set === filters.set);
  if (filters.rarity !== "all") list = list.filter((c) => c.facet.rarity === filters.rarity);
  if (filters.type !== "all") list = list.filter((c) => c.facet.type === filters.type);

  list = sortCards(list, sort);
  state.filtered = list;
  state.rendered = 0;
}

const RARITY_ORDER = [
  "Common", "Uncommon", "Rare", "Double Rare", "Ultra Rare", "Illustration Rare",
  "Special Illustration Rare", "Hyper Rare", "Rare Holo", "Promo",
  "C", "U", "R", "RR", "RR+", "SR", "SP", "PR", "CR", "CC",
];

function sortCards(list, sort) {
  const copy = list.slice();
  if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === "rarity") {
    copy.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  } else if (sort === "price-desc") {
    copy.sort((a, b) => (b.price || 0) - (a.price || 0));
  }
  return copy;
}
function rarityRank(r) {
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? -1 : RARITY_ORDER.length - i;
}

// ---- Building the filter controls -----------------------------
function buildFilters() {
  const game = GAMES[state.game];
  $("#typeLabel").textContent = game.typeLabel;
  $("#setLabel").textContent = game.id === "weiss" ? "Set" : "Set";

  // Category chips (kept in data order, e.g. Mega Evolution first).
  const categoryValues = uniqueFacet("category", false);
  categoryChips.innerHTML = "";
  makeChip("All", "all", state.filters.category === "all");
  categoryValues.forEach((v) => makeChip(v, v, state.filters.category === v));

  buildSetSelect();
  fillSelect(rarityFilter, uniqueFacet("rarity"), state.filters.rarity);
  fillSelect(typeFilter, uniqueFacet("type"), state.filters.type);
}

// The Set dropdown only lists sets within the active category.
function buildSetSelect() {
  const cat = state.filters.category;
  const seen = [];
  state.cards.forEach((c) => {
    if (cat !== "all" && c.facet.category !== cat) return;
    const v = c.facet.set;
    if (v && v !== "—" && !seen.includes(v)) seen.push(v);
  });
  fillSelect(setFilter, seen, state.filters.set);
}

function uniqueFacet(key, sort = true) {
  const seen = [];
  state.cards.forEach((c) => {
    const v = c.facet[key];
    if (v && v !== "—" && !seen.includes(v)) seen.push(v);
  });
  return sort ? seen.sort() : seen;
}

function makeChip(label, value, active) {
  const b = document.createElement("button");
  b.className = "chip" + (active ? " is-active" : "");
  b.textContent = label;
  b.addEventListener("click", () => {
    state.filters.category = value;
    state.filters.set = "all"; // reset set when the category changes
    document.querySelectorAll("#categoryChips .chip").forEach((c) => c.classList.remove("is-active"));
    b.classList.add("is-active");
    buildSetSelect();
    refresh();
  });
  categoryChips.appendChild(b);
}

function fillSelect(sel, values, current) {
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = sel === rarityFilter ? "All rarities" : sel === setFilter ? "All sets" : "All";
  sel.appendChild(all);
  values.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = current;
}

// ---- Rendering ------------------------------------------------
function renderMore() {
  const slice = state.filtered.slice(state.rendered, state.rendered + PAGE);
  const frag = document.createDocumentFragment();
  slice.forEach((card) => frag.appendChild(makeCardEl(card)));
  grid.appendChild(frag);
  state.rendered += slice.length;
}

function rerender() {
  grid.innerHTML = "";
  state.rendered = 0;
  renderMore();
  updateMeta();
}

function makeCardEl(card) {
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;

  const wrap = document.createElement("div");
  wrap.className = "card-img-wrap";

  const img = document.createElement("img");
  img.className = "card-img";
  img.loading = "lazy";
  img.alt = card.name;
  img.src = card.thumb;
  img.addEventListener("load", () => {
    img.classList.add("loaded");
    wrap.classList.add("loaded");
  });
  img.addEventListener("error", () => wrap.classList.add("loaded"));
  wrap.appendChild(img);

  const fav = document.createElement("button");
  fav.className = "fav-btn card-fav" + (state.collection.has(card.id) ? " is-fav" : "");
  fav.innerHTML = '<span class="heart">♥</span>';
  fav.setAttribute("aria-label", "Add to collection");
  fav.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav(card.id);
    fav.classList.toggle("is-fav", state.collection.has(card.id));
  });
  wrap.appendChild(fav);

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = card.name;

  const sub = document.createElement("div");
  sub.className = "card-sub";
  sub.innerHTML = `<span>${escapeHtml(card.rarity)}</span>`;
  if (card.price) sub.innerHTML += `<span class="card-price">$${card.price.toFixed(2)}</span>`;

  el.append(wrap, name, sub);
  el.addEventListener("click", () => openModal(card));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openModal(card);
  });
  return el;
}

function updateMeta() {
  const n = state.filtered.length;
  if (state.view === "collection") {
    resultCount.textContent = n === 0 ? "Your collection is empty" : `${n} saved card${n === 1 ? "" : "s"}`;
  } else {
    resultCount.textContent = `${n.toLocaleString()} card${n === 1 ? "" : "s"}`;
  }
  liveBadge.hidden = !state.liveMode;
  emptyEl.hidden = n !== 0;
  grid.hidden = n === 0;
}

// ---- Collection -----------------------------------------------
function toggleFav(id) {
  if (state.collection.has(id)) state.collection.delete(id);
  else state.collection.add(id);
  localStorage.setItem("tcg-collection", JSON.stringify([...state.collection]));
  collectionCount.textContent = state.collection.size;
  if (state.view === "collection") refresh();
}

// ---- Modal ----------------------------------------------------
const modal = $("#modal");
let modalCard = null;

function openModal(card) {
  modalCard = card;
  $("#modalImg").src = card.image;
  $("#modalImg").alt = card.name;
  $("#modalSeries").textContent = card.series || GAMES[card.game].name;
  $("#modalName").textContent = card.name;
  $("#modalRarity").textContent = card.rarity;
  $("#modalRarity").hidden = !card.rarity || card.rarity === "—";

  const stats = $("#modalStats");
  stats.innerHTML = "";
  card.meta.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    stats.append(dt, dd);
  });
  if (card.price) {
    const dt = document.createElement("dt");
    dt.textContent = "Market price";
    const dd = document.createElement("dd");
    dd.textContent = "$" + card.price.toFixed(2);
    stats.append(dt, dd);
  }

  $("#modalText").textContent = card.text;
  $("#modalText").hidden = !card.text;
  syncModalFav();
  setupEbay(card);

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

// ---- Live eBay prices (optional; needs the Worker proxy) -------
const EBAY_PROXY = (window.TCG_VAULT_CONFIG && window.TCG_VAULT_CONFIG.ebayProxyUrl) || "";
const ebayBlock = $("#ebayBlock");
const ebayGrade = $("#ebayGrade");
const ebayResult = $("#ebayResult");
let ebayReqId = 0; // guards against out-of-order responses

function setupEbay(card) {
  if (!EBAY_PROXY) {
    ebayBlock.hidden = true;
    return;
  }
  ebayBlock.hidden = false;
  ebayGrade.value = "raw";
  loadEbayPrices(card, "raw");
}

// Build a focused eBay search query for a card (+ optional grade).
function ebayQuery(card, grade) {
  const parts = [card.name];
  if (card.game === "pokemon") {
    if (card.series) parts.push(card.series);
    const num = (card.meta.find((m) => m[0] === "Number") || [])[1];
    if (num) parts.push(num.split(" ")[0]); // collector number, e.g. "6"
  } else {
    parts.push("Weiss Schwarz", card.id);
  }
  if (grade && grade !== "raw") parts.push(grade);
  return parts.join(" ");
}

async function loadEbayPrices(card, grade) {
  const reqId = ++ebayReqId;
  ebayResult.innerHTML = '<span class="ebay-loading">Checking eBay…</span>';
  const q = ebayQuery(card, grade);
  const url =
    `${EBAY_PROXY.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}&limit=25` +
    (card.game === "pokemon" ? "&category=183454" : "");

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("proxy " + res.status);
    const data = await res.json();
    if (reqId !== ebayReqId) return; // a newer request superseded this one
    renderEbay(data);
  } catch (err) {
    if (reqId !== ebayReqId) return;
    ebayResult.innerHTML = '<span class="ebay-empty">Couldn’t reach the eBay proxy.</span>';
  }
}

function renderEbay(data) {
  if (!data || !data.count) {
    ebayResult.innerHTML = '<span class="ebay-empty">No active listings found.</span>';
    return;
  }
  const cur = data.currency === "USD" ? "$" : (data.currency || "") + " ";
  const money = (n) => cur + Number(n).toFixed(2);
  const stat = (label, val) => `<div class="ebay-stat"><span>${label}</span><strong>${money(val)}</strong></div>`;

  const listings = (data.items || [])
    .slice(0, 3)
    .map(
      (it) =>
        `<a class="ebay-listing" href="${it.url}" target="_blank" rel="noopener">
           <span class="ebay-listing-title">${escapeHtml(it.title)}</span>
           <span class="ebay-listing-price">${money(it.price)}</span>
         </a>`
    )
    .join("");

  ebayResult.innerHTML =
    `<div class="ebay-stats">${stat("Lowest", data.low)}${stat("Median", data.median)}${stat("Highest", data.high)}</div>` +
    `<div class="ebay-count">${data.count} active listing${data.count === 1 ? "" : "s"}</div>` +
    `<div class="ebay-listings">${listings}</div>`;
}

ebayGrade.addEventListener("change", () => {
  if (modalCard) loadEbayPrices(modalCard, ebayGrade.value);
});

function syncModalFav() {
  const btn = $("#modalFav");
  const inCol = modalCard && state.collection.has(modalCard.id);
  btn.classList.toggle("is-fav", inCol);
  btn.setAttribute("aria-pressed", String(!!inCol));
  btn.querySelector(".fav-label").textContent = inCol ? "In your collection" : "Add to collection";
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  modalCard = null;
}

$("#modalFav").addEventListener("click", () => {
  if (!modalCard) return;
  toggleFav(modalCard.id);
  syncModalFav();
  // keep grid hearts in sync
  document.querySelectorAll(".card").forEach((el) => {});
  rerenderFavStates();
});

function rerenderFavStates() {
  // Re-sync heart icons currently in the DOM with collection state.
  const cards = state.filtered.slice(0, state.rendered);
  const els = grid.querySelectorAll(".card-fav");
  els.forEach((favEl, i) => {
    if (cards[i]) favEl.classList.toggle("is-fav", state.collection.has(cards[i].id));
  });
}

modal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

// ---- Orchestration --------------------------------------------
function refresh() {
  state.filters.set = setFilter.value;
  state.filters.rarity = rarityFilter.value;
  state.filters.type = typeFilter.value;
  state.sort = sortFilter.value;
  applyFilters();
  rerender();
}

// Full reload when the game changes.
async function switchGame(gameId) {
  state.game = gameId;
  document.body.dataset.game = gameId;
  state.filters = { category: "all", set: "all", rarity: "all", type: "all" };
  state.query = "";
  searchInput.value = "";
  resultCount.textContent = "Loading…";
  grid.innerHTML = "";
  await loadGame(gameId);
  buildFilters();
  sortFilter.value = "default";
  applyFilters();
  rerender();
}

// ---- Search (debounced; live for Pokemon) ---------------------
let searchTimer = null;
searchInput.addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 320);
});

async function runSearch() {
  const game = GAMES[state.game];
  const q = state.query;

  // Live Pokemon search for queries of 2+ chars while browsing.
  if (game.live && q.length >= 2 && state.view === "browse") {
    searchSpinner.hidden = false;
    try {
      const results = await livePokemonSearch(q);
      state.cards = results;
      state.liveMode = true;
      buildFilters();
      applyFilters();
      rerender();
    } catch (err) {
      if (err.name !== "AbortError") {
        // Fall back to filtering the bundled set.
        state.cards = cache[state.game].map((r) => game.toCard(r));
        state.liveMode = false;
        applyFilters();
        rerender();
      }
    } finally {
      searchSpinner.hidden = true;
    }
    return;
  }

  // Restore bundled data when the query is cleared or too short.
  if (state.liveMode) {
    state.cards = cache[state.game].map((r) => game.toCard(r));
    state.liveMode = false;
    buildFilters();
  }
  applyFilters();
  rerender();
}

// ---- Wiring ---------------------------------------------------
const gameSwitch = $("#gameSwitch");
const segThumb = gameSwitch.querySelector(".seg-thumb");

function positionThumb() {
  const active = gameSwitch.querySelector(".seg-btn.is-active");
  segThumb.style.width = active.offsetWidth + "px";
  segThumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

gameSwitch.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("is-active")) return;
    gameSwitch.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    positionThumb();
    switchGame(btn.dataset.game);
  });
});

document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    state.view = btn.dataset.view;
    // Collection view always uses the full bundled set, not live results.
    if (state.view === "collection" && state.liveMode) {
      state.cards = cache[state.game].map((r) => GAMES[state.game].toCard(r));
      state.liveMode = false;
    }
    refresh();
  });
});

setFilter.addEventListener("change", refresh);
rarityFilter.addEventListener("change", refresh);
typeFilter.addEventListener("change", refresh);
sortFilter.addEventListener("change", refresh);

// Infinite scroll
const sentinel = $("#sentinel");
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && state.rendered < state.filtered.length) {
    renderMore();
  }
}).observe(sentinel);

// Theme
const themeToggle = $("#themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("tcg-theme", theme);
}
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
});

// ---- Utils ----------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- Boot -----------------------------------------------------
(async function init() {
  const savedTheme = localStorage.getItem("tcg-theme");
  if (savedTheme) applyTheme(savedTheme);
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) applyTheme("dark");

  collectionCount.textContent = state.collection.size;
  positionThumb();
  window.addEventListener("resize", positionThumb);

  await switchGame("pokemon");
})();
