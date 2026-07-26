import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);
const MOVERS_DIR = new URL("../data/movers/", import.meta.url);

async function listSnapshotDates() {
  const files = await readdir(SNAPSHOT_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort(); // YYYY-MM-DD sorts chronologically as a string
}

async function loadSnapshot(date) {
  const raw = await readFile(new URL(`${date}.json`, SNAPSHOT_DIR), "utf-8");
  return JSON.parse(raw);
}

export async function computeMovers(todayDate) {
  const dates = await listSnapshotDates();
  const todayIndex = dates.indexOf(todayDate);
  if (todayIndex === -1) {
    throw new Error(`Engin verðmynd (snapshot) fundin fyrir ${todayDate}`);
  }
  if (todayIndex === 0) {
    console.log("Þetta er fyrsta verðmyndin — engin fyrri gögn til að bera saman við.");
    return null;
  }

  const prevDate = dates[todayIndex - 1];
  const today = await loadSnapshot(todayDate);
  const prev = await loadSnapshot(prevDate);

  const prevBySku = new Map(prev.products.map((p) => [p.sku, p]));

  const changes = [];
  for (const p of today.products) {
    const before = prevBySku.get(p.sku);
    if (!before) continue; // new product, no prior price to compare to
    if (!before.price || !p.price) continue; // guard against 0/null
    if (before.price === p.price) continue; // no change, skip

    const percent = ((p.price - before.price) / before.price) * 100;
    changes.push({
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      priceBefore: before.price,
      priceAfter: p.price,
      percent: Math.round(percent * 100) / 100,
    });
  }

  changes.sort((a, b) => b.percent - a.percent);
  const topIncreases = changes.slice(0, 3);
  const topDecreases = changes.slice(-3).reverse().filter((c) => c.percent < 0);

  const result = {
    date: todayDate,
    comparedTo: prevDate,
    productCount: today.products.length,
    changedCount: changes.length,
    topIncreases,
    topDecreases,
  };

  await writeFile(
    new URL(`${todayDate}.json`, MOVERS_DIR),
    JSON.stringify(result, null, 2)
  );
  await writeFile(new URL("latest.json", MOVERS_DIR), JSON.stringify(result, null, 2));

  // Keep a running index of available dates for the dashboard.
  const moverFiles = (await readdir(MOVERS_DIR))
    .filter((f) => f.endsWith(".json") && f !== "latest.json" && f !== "index.json")
    .map((f) => f.replace(".json", ""))
    .sort();
  await writeFile(new URL("index.json", MOVERS_DIR), JSON.stringify(moverFiles, null, 2));

  return result;
}
