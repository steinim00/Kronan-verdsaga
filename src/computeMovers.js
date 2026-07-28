import { readdir, readFile, writeFile } from "node:fs/promises";
import { readHistory } from "./updateHistory.js";

const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);
const MOVERS_DIR = new URL("../data/movers/", import.meta.url);
const VOLATILITY_FILE = new URL("../data/volatility-stats.json", import.meta.url);

async function listSnapshotDates() {
  const files = await readdir(SNAPSHOT_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

async function loadSnapshot(date) {
  const raw = await readFile(new URL(`${date}.json`, SNAPSHOT_DIR), "utf-8");
  return JSON.parse(raw);
}

function toPriceEntry(p) {
  return { sku: p.sku, name: p.name, brand: p.brand, price: p.price };
}

function findExtremes(products) {
  const priced = products.filter((p) => p.price && p.price > 0);
  if (priced.length === 0) return { cheapest: null, mostExpensive: null };

  let cheapest = priced[0];
  let mostExpensive = priced[0];
  for (const p of priced) {
    if (p.price < cheapest.price) cheapest = p;
    if (p.price > mostExpensive.price) mostExpensive = p;
  }
  return { cheapest: toPriceEntry(cheapest), mostExpensive: toPriceEntry(mostExpensive) };
}

// Tags an entry with whether today's price is the lowest/highest ever
// recorded for that SKU, based on its history file. Only called for the
// small handful of items that make it into the top lists — cheap.
async function tagAllTime(entry, todayPrice) {
  const { h } = await readHistory(entry.sku);
  const prices = h.map((row) => row[1]).filter((p) => p != null);
  if (prices.length === 0) return entry;
  const isLow = todayPrice <= Math.min(...prices);
  const isHigh = todayPrice >= Math.max(...prices);
  return { ...entry, allTimeLow: isLow, allTimeHigh: isHigh };
}

async function computeVolatilityTop() {
  let stats;
  try {
    stats = JSON.parse(await readFile(VOLATILITY_FILE, "utf-8"));
  } catch {
    return [];
  }
  return Object.entries(stats)
    .filter(([, s]) => s.days >= 3 && s.changes >= 2)
    .map(([sku, s]) => ({
      sku,
      name: s.name,
      brand: s.brand,
      changes: s.changes,
      days: s.days,
      lastPrice: s.lastPrice,
    }))
    .sort((a, b) => b.changes / b.days - a.changes / a.days)
    .slice(0, 5);
}

export async function computeMovers(todayDate) {
  const dates = await listSnapshotDates();
  const todayIndex = dates.indexOf(todayDate);
  if (todayIndex === -1) {
    throw new Error(`Engin verðmynd (snapshot) fundin fyrir ${todayDate}`);
  }

  const today = await loadSnapshot(todayDate);
  const { cheapest, mostExpensive } = findExtremes(today.products);

  let topIncreases = [];
  let topDecreases = [];
  let topWeightIncreases = [];
  let topWeightDecreases = [];
  let comparedTo = null;
  let changedCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;
  let weightIncreasedCount = 0;
  let weightDecreasedCount = 0;

  if (todayIndex === 0) {
    console.log("Þetta er fyrsta verðmyndin — engin fyrri gögn til að bera saman við.");
  } else {
    const prevDate = dates[todayIndex - 1];
    const prev = await loadSnapshot(prevDate);
    const prevBySku = new Map(prev.products.map((p) => [p.sku, p]));

    const unitChanges = [];
    const weightChanges = [];

    for (const p of today.products) {
      const before = prevBySku.get(p.sku);
      if (!before) continue;

      if (p.chargedByWeight) {
        // For weight-priced items, package size can shift the sticker
        // price without the actual per-kilo price changing at all — so
        // these are tracked separately, using pricePerKilo instead.
        if (!before.pricePerKilo || !p.pricePerKilo) continue;
        if (before.pricePerKilo === p.pricePerKilo) continue;
        const percent = ((p.pricePerKilo - before.pricePerKilo) / before.pricePerKilo) * 100;
        weightChanges.push({
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          priceBefore: before.pricePerKilo,
          priceAfter: p.pricePerKilo,
          percent: Math.round(percent * 100) / 100,
        });
      } else {
        if (!before.price || !p.price) continue;
        if (before.price === p.price) continue;
        const percent = ((p.price - before.price) / before.price) * 100;
        unitChanges.push({
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          priceBefore: before.price,
          priceAfter: p.price,
          percent: Math.round(percent * 100) / 100,
        });
      }
    }

    unitChanges.sort((a, b) => b.percent - a.percent);
    weightChanges.sort((a, b) => b.percent - a.percent);

    topIncreases = unitChanges.slice(0, 3);
    topDecreases = unitChanges.slice(-3).reverse().filter((c) => c.percent < 0);
    topWeightIncreases = weightChanges.slice(0, 3);
    topWeightDecreases = weightChanges.slice(-3).reverse().filter((c) => c.percent < 0);

    comparedTo = prevDate;
    changedCount = unitChanges.length + weightChanges.length;
    increasedCount = unitChanges.filter((c) => c.percent > 0).length;
    decreasedCount = unitChanges.filter((c) => c.percent < 0).length;
    weightIncreasedCount = weightChanges.filter((c) => c.percent > 0).length;
    weightDecreasedCount = weightChanges.filter((c) => c.percent < 0).length;

    // Tag all-time low/high on the items actually shown.
    for (const list of [topIncreases, topDecreases]) {
      for (let i = 0; i < list.length; i++) {
        list[i] = await tagAllTime(list[i], list[i].priceAfter);
      }
    }
  }

  const mostVolatile = await computeVolatilityTop();

  const result = {
    date: todayDate,
    comparedTo,
    productCount: today.products.length,
    changedCount,
    increasedCount,
    decreasedCount,
    weightIncreasedCount,
    weightDecreasedCount,
    topIncreases,
    topDecreases,
    topWeightIncreases,
    topWeightDecreases,
    cheapest: cheapest ? await tagAllTime(cheapest, cheapest.price) : null,
    mostExpensive: mostExpensive ? await tagAllTime(mostExpensive, mostExpensive.price) : null,
    mostVolatile,
  };

  await writeFile(
    new URL(`${todayDate}.json`, MOVERS_DIR),
    JSON.stringify(result, null, 2)
  );
  await writeFile(new URL("latest.json", MOVERS_DIR), JSON.stringify(result, null, 2));

  const moverFiles = (await readdir(MOVERS_DIR))
    .filter((f) => f.endsWith(".json") && f !== "latest.json" && f !== "index.json")
    .map((f) => f.replace(".json", ""))
    .sort();
  await writeFile(new URL("index.json", MOVERS_DIR), JSON.stringify(moverFiles, null, 2));

  return result;
}
