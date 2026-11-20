// Sækir þau vörunúmer sem Krónan sjálf merkir sem "fryst verð".
// API-ið hefur engan sér-reit fyrir það, en vörur eru flokkaðar með
// "tags" (GET /products/tags/). Við finnum tagið sem snýst um fryst verð
// (eftir nafni/slug) og sækjum allar vörur með það tag.
//
// Ef sjálfvirk greining velur rangt tag má þvinga það með
// FROZEN_TAG_SLUG=<slug>. Vistað í data/frozen-prices.json.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { mapProduct } from "./productMap.js";

const OUT = new URL("../data/frozen-prices.json", import.meta.url);
const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);

// Viðmiðsdagur: frá hvaða degi við mælum hækkun, og hversu mörgum dögum
// á undan er horft til að sjá hækkunina rétt fyrir viðmiðsdaginn.
const BASE_DATE = process.env.FROZEN_BASE_DATE || "2026-09-23";
const DAYS_BEFORE = 2;

function shiftDate(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Verð á einingu eins og annars staðar í kerfinu: kg-verð fyrir vigtarvörur.
const unitPrice = (p) => (p.chargedByWeight && p.pricePerKilo != null ? p.pricePerKilo : p.price);

// Síðasta verðmynd á eða fyrir gefinn dag -> Map(sku -> verð)
async function pricesAt(date) {
  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
  const file = [...files].reverse().find((f) => f.slice(0, 10) <= date);
  if (!file) return { date: null, prices: new Map() };
  const snap = JSON.parse(await readFile(new URL(file, SNAPSHOT_DIR), "utf-8"));
  return { date: file.slice(0, 10), prices: new Map(snap.products.map((p) => [p.sku, unitPrice(p)])) };
}

function change(from, to) {
  if (from == null || to == null) return null;
  return { from, to, amount: to - from, percent: from ? Math.round(((to - from) / from) * 10000) / 100 : null };
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th");

// "fryst verð", "frysting verðs", "verðfrysting", "price freeze", "frozen price"...
export function isFrozenPriceTag(tag) {
  const t = norm(`${tag.name} ${tag.slug}`);
  const frozenWord = /fryst|frysting|frozen|freez|freeze/.test(t);
  const priceWord = /verd|price|verdlag/.test(t);
  return frozenWord && priceWord;
}

async function readPrev() {
  try {
    return JSON.parse(await readFile(OUT, "utf-8"));
  } catch {
    return null;
  }
}

export async function fetchFrozenPrices(client, date) {
  const tags = await client.getTags();
  const forced = process.env.FROZEN_TAG_SLUG;
  const matched = forced ? tags.filter((t) => t.slug === forced) : tags.filter(isFrozenPriceTag);

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });

  if (matched.length === 0) {
    console.log(`  Fann ekkert tag fyrir fryst verð. Tög í boði: ${tags.map((t) => t.slug).join(", ")}`);
    // Skrifum samt skrá svo framendinn geti útskýrt stöðuna í stað þess að bila.
    await writeFile(
      OUT,
      JSON.stringify({ date, tags: [], availableTags: tags, products: [] }, null, 2)
    );
    return;
  }

  const prev = await readPrev();
  const firstSeen = new Map((prev?.products ?? []).map((p) => [p.sku, p.frozenSince ?? prev.date]));

  const bySku = new Map();
  for (const tag of matched) {
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const res = await client.getProductsByTag(tag.slug, page);
      for (const raw of res.results ?? []) {
        if (bySku.has(raw.sku)) continue;
        bySku.set(raw.sku, {
          ...mapProduct(raw),
          frozenSince: firstSeen.get(raw.sku) ?? date,
        });
      }
      hasNext = !!res.hasNextPage;
      page += 1;
    }
    console.log(`  Tag "${tag.name}" (${tag.slug}): ${bySku.size} vörunúmer hingað til`);
  }

  const base = await pricesAt(BASE_DATE);
  const before = await pricesAt(shiftDate(BASE_DATE, -DAYS_BEFORE));
  for (const p of bySku.values()) {
    p.sinceBase = change(base.prices.get(p.sku), unitPrice(p));
    p.beforeBase = change(before.prices.get(p.sku), base.prices.get(p.sku));
  }

  const products = [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name, "is"));
  await writeFile(
    OUT,
    JSON.stringify({ date, baseDate: base.date, beforeDate: before.date, tags: matched.map(({ slug, name }) => ({ slug, name })), products }, null, 2)
  );
  console.log(`Vistaði ${products.length} vörunúmer með frystu verði.`);
}
