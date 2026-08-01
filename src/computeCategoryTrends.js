// Reiknar einfalda verðvísitölu fyrir hvern efsta-stigs vöruflokk yfir
// tíma — meðaltal af (verð_í_dag / verð_í_upphafi) fyrir allar vörur í
// flokknum sem til eru bæði í fyrstu verðmyndinni og verðmynd dagsins.
// Grunngildi (fyrsta daginn) = 100.
//
// Þetta er GRÓF vísitala (óvegin, jafnt vægi á allar vörur), ekki
// opinber neysluverðsvísitala — hún sýnir bara stefnu/þróun innan
// flokks yfir tíma þau fáu daga sem verkefnið hefur safnað gögnum.

import { readdir, readFile, writeFile } from "node:fs/promises";

const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);
const OUTPUT_FILE = new URL("../data/category-trends.json", import.meta.url);
const MIN_PRODUCTS_PER_CATEGORY = 5; // sleppa örsmáum flokkum — of hávaðasamt

function topCategory(categoryPath) {
  if (!categoryPath) return null;
  return categoryPath.split("/")[0].trim();
}

function priceFor(p) {
  return p.chargedByWeight ? p.pricePerKilo : p.price;
}

export async function computeCategoryTrends() {
  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return {};

  const dates = files.map((f) => f.replace(".json", ""));
  const snapshots = [];
  for (const f of files) {
    const raw = await readFile(new URL(f, SNAPSHOT_DIR), "utf-8");
    snapshots.push(JSON.parse(raw));
  }

  const baseline = snapshots[0];
  const baselineBySku = new Map();
  for (const p of baseline.products) {
    const val = priceFor(p);
    if (val) baselineBySku.set(p.sku, { val, category: topCategory(p.categoryPath) || "Óflokkað" });
  }

  const trends = {};

  for (let i = 0; i < snapshots.length; i++) {
    const date = dates[i];
    const sums = new Map(); // category -> { sumRatio, count }

    for (const p of snapshots[i].products) {
      const base = baselineBySku.get(p.sku);
      if (!base) continue;
      const val = priceFor(p);
      if (!val) continue;

      const entry = sums.get(base.category) || { sumRatio: 0, count: 0 };
      entry.sumRatio += val / base.val;
      entry.count += 1;
      sums.set(base.category, entry);
    }

    for (const [cat, { sumRatio, count }] of sums) {
      if (count < MIN_PRODUCTS_PER_CATEGORY) continue;
      const index = Math.round((sumRatio / count) * 1000) / 10; // 1 aukastafur
      if (!trends[cat]) trends[cat] = [];
      trends[cat].push([date, index]);
    }
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(trends));
  return trends;
}
