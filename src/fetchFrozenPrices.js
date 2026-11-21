// Sækir þau vörunúmer sem Krónan segir að séu með frystu verði
// (https://kronan.is/frysting-voruverds), sækir núverandi verð þeirra og
// ber saman við verð 23. sept. og 2 dögum fyrr. Vistað í
// data/frozen-prices.json.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { batchRefresh } from "./batchRefresh.js";

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
  return { date: file.slice(0, 10), prices: new Map(snap.products.map((p) => [p.sku, { price: p.price, kg: p.chargedByWeight ? p.pricePerKilo : null }])) };
}

function change(from, to) {
  if (from == null || to == null) return null;
  return { from, to, amount: to - from, percent: from ? Math.round(((to - from) / from) * 10000) / 100 : null };
}

const PAGE_URL = "https://kronan.is/frysting-voruverds";

// Krónan birtir lista yfir frystar vörur á vefsíðu sinni (API-ið hefur
// ekkert tag/reit fyrir þetta). Hvert vörukort sem ber merkið "Fryst verð!"
// tengir á /vara/<vörunúmer>-<slug>; vörunúmerið er það sama og í API-inu.
export function parseFrozenSkus(html) {
  const parts = html.split(/id="\d+" role="contentinfo"/).slice(1);
  const skus = new Set();
  for (const part of parts) {
    if (!part.includes("Fryst verð!")) continue;
    const m = part.match(/href="\/vara\/(\d+)-/);
    if (m) skus.add(m[1]);
  }
  return [...skus];
}

// Síðan felur líka í sér JSON með "priceAtFreeze" (verðið sem Krónan
// miðar frystinguna við) fyrir hverja vöru: ..."slug":"<sku>-...","src":"...","priceAtFreeze":N
// Fyrir vigtarvörur er það kílóverð, annars verð á einingu.
export function parseFreezePrices(html) {
  const out = new Map();
  const re = /slug\\?":\\?"(\d+)-[^"\\]*\\?",\\?"src\\?":\\?"[^"\\]*\\?",\\?"priceAtFreeze\\?":(\d+)/g;
  for (const m of html.matchAll(re)) out.set(m[1], Number(m[2]));
  return out;
}

async function fetchPage() {
  const res = await fetch(PAGE_URL);
  if (!res.ok) throw new Error(`${PAGE_URL} -> ${res.status}`);
  const html = await res.text();
  return { skus: parseFrozenSkus(html), freezePrices: parseFreezePrices(html) };
}

async function latestSnapshotProducts() {
  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
  const snap = JSON.parse(await readFile(new URL(files[files.length - 1], SNAPSHOT_DIR), "utf-8"));
  return snap.products;
}

async function readPrev() {
  try {
    return JSON.parse(await readFile(OUT, "utf-8"));
  } catch {
    return null;
  }
}

// client má vera null (engin aðgangstóken): þá er nýjasta daglega verðmyndin
// notuð fyrir núverandi verð.
export async function fetchFrozenPrices(client, date) {
  const { skus, freezePrices } = await fetchPage();
  if (skus.length === 0) throw new Error("Fann engar vörur með 'Fryst verð!' á síðu Krónunnar — sleppi uppfærslu.");
  console.log(`  ${skus.length} vörunúmer merkt "Fryst verð!" á ${PAGE_URL}`);

  let current;
  let missing = [];
  if (client) {
    ({ products: current, missing } = await batchRefresh(client, skus));
  } else {
    const wanted = new Set(skus);
    current = (await latestSnapshotProducts()).filter((p) => wanted.has(p.sku));
    missing = skus.filter((k) => !current.some((p) => p.sku === k));
  }
  if (missing.length) console.log(`  ${missing.length} vörunúmer fundust ekki í API/verðmynd: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`);

  const prev = await readPrev();
  const firstSeen = new Map((prev?.products ?? []).map((p) => [p.sku, p.frozenSince ?? prev.date]));
  const base = await pricesAt(BASE_DATE);
  const before = await pricesAt(shiftDate(BASE_DATE, -DAYS_BEFORE));

  const products = current
    .map((p) => {
      const b = base.prices.get(p.sku);
      const o = before.prices.get(p.sku);
      return {
        ...p,
        frozenSince: firstSeen.get(p.sku) ?? date,
        priceAtFreeze: freezePrices.get(p.sku) ?? null, // verð við frystingu skv. Krónunni (kg-verð fyrir vigtarvörur)
        shelfSince: change(b?.price, p.price), // verð á miða
        shelfBefore: change(o?.price, b?.price),
        kgSince: p.chargedByWeight ? change(b?.kg, p.pricePerKilo) : null, // kílóverð (vigtarvörur)
        kgBefore: p.chargedByWeight ? change(o?.kg, b?.kg) : null,
        freezeCmp: change(freezePrices.get(p.sku), unitPrice(p)), // núverandi (kg)verð vs. verð Krónunnar við frystingu
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "is"));

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ date, source: PAGE_URL, baseDate: base.date, beforeDate: before.date, missingSkus: missing, products }, null, 2)
  );
  console.log(`Vistaði ${products.length} vörunúmer með frystu verði.`);
}

// Bein keyrsla án tóka: node src/fetchFrozenPrices.js
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await fetchFrozenPrices(null, new Date().toISOString().slice(0, 10));
}
