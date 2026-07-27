import { readdir, readFile, writeFile } from "node:fs/promises";

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

function toPriceEntry(p) {
  return { sku: p.sku, name: p.name, brand: p.brand, price: p.price };
}

// Cheapest/priciest single item in today's whole catalog (not a comparison,
// just today's extremes). Guards against 0/null prices.
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
  let comparedTo = null;
  let changedCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;

  if (todayIndex === 0) {
    console.log("Þetta er fyrsta verðmyndin — engin fyrri gögn til að bera saman við (en ódýrasta/dýrasta varan er samt reiknuð).");
  } else {
    const prevDate = dates[todayIndex - 1];
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
    topIncreases = changes.slice(0, 3);
    topDecreases = changes.slice(-3).reverse().filter((c) => c.percent < 0);
    comparedTo = prevDate;
    changedCount = changes.length;
    increasedCount = changes.filter((c) => c.percent > 0).length;
    decreasedCount = changes.filter((c) => c.percent < 0).length;
  }

  const result = {
    date: todayDate,
    comparedTo,
    productCount: today.products.length,
    changedCount,
    increasedCount,
    decreasedCount,
    topIncreases,
    topDecreases,
    cheapest,
    mostExpensive,
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
