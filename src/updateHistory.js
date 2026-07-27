import { readFile, writeFile, mkdir } from "node:fs/promises";

const HISTORY_DIR = new URL("../data/history/", import.meta.url);
const VOLATILITY_FILE = new URL("../data/volatility-stats.json", import.meta.url);

async function readJsonSafe(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf-8"));
  } catch {
    return fallback;
  }
}

// Appends today's {date, price} to data/history/<sku>.json for every
// product seen today. Format is deliberately compact — an array of
// [date, price, pricePerKiloOrNull] tuples — since this repeats for
// every product, every day, indefinitely.
async function updateOneHistory(product, date) {
  const url = new URL(`${product.sku}.json`, HISTORY_DIR);
  const existing = await readJsonSafe(url, { h: [] });

  // Re-running the same day (e.g. a manual re-trigger) replaces today's
  // entry instead of appending a duplicate.
  const withoutToday = existing.h.filter((row) => row[0] !== date);
  withoutToday.push([date, product.price, product.chargedByWeight ? product.pricePerKilo : null]);
  existing.h = withoutToday;

  await writeFile(url, JSON.stringify(existing));
}

// Tracks how often each product's price actually changes day-to-day, so we
// can later surface "most volatile" products. Cheap running counters
// instead of re-scanning full history each time.
async function updateVolatility(products, date) {
  const stats = await readJsonSafe(VOLATILITY_FILE, {});

  for (const p of products) {
    const entry = stats[p.sku];
    if (!entry) {
      stats[p.sku] = {
        name: p.name,
        brand: p.brand,
        days: 1,
        changes: 0,
        lastPrice: p.price,
        lastDate: date,
      };
      continue;
    }

    if (entry.lastDate === date) continue; // already counted today, skip

    if (entry.lastPrice !== p.price) entry.changes += 1;
    entry.days += 1;
    entry.lastPrice = p.price;
    entry.lastDate = date;
    entry.name = p.name; // keep display fields fresh
    entry.brand = p.brand;
  }

  await writeFile(VOLATILITY_FILE, JSON.stringify(stats));
  return stats;
}

export async function updateHistory(products, date) {
  await mkdir(HISTORY_DIR, { recursive: true });
  for (const p of products) {
    await updateOneHistory(p, date);
  }
  return updateVolatility(products, date);
}

// Reads a handful of history files (used for "lowest/highest price ever"
// badges on a small set of products, e.g. today's top movers) without
// loading the whole history directory.
export async function readHistory(sku) {
  return readJsonSafe(new URL(`${sku}.json`, HISTORY_DIR), { h: [] });
}
