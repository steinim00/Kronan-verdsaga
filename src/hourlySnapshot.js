// Klukkutíma-athugun: keyrir (vonandi) einu sinni á klukkustund og ber
// núverandi verð saman við síðustu athugun — ekki daglegu verðmyndina.
// Þetta gefur klukkutíma-nákvæmni á HVENÆR yfir daginn verð breytist,
// ekki bara AÐ það breyttist einhvern tímann þann daginn.
//
// Gisin skráning (sparse encoding), sama hugmynd og data/history/: bara
// skráð þegar verð raunverulega breytist, ekki ein lína á klukkustund
// fyrir hverja vöru óháð breytingu.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { makeClient } from "./client.js";
import { batchRefresh } from "./batchRefresh.js";

const HOURLY_DIR = new URL("../data/hourly/", import.meta.url);
const BASELINE_FILE = new URL("latest-check.json", HOURLY_DIR);
const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);

// Ísland er á UTC+0 allt árið (ekkert sumar-/vetrartíma-skipti), svo UTC
// tíminn ER íslenski tíminn — engin tímabeltisleiðrétting þarf.
function icelandTimeNow() {
  const now = new Date();
  return { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16) };
}

async function readJsonSafe(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf-8"));
  } catch {
    return fallback;
  }
}

async function latestDailySnapshot() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const raw = await readFile(new URL(files[files.length - 1], SNAPSHOT_DIR), "utf-8");
  return JSON.parse(raw);
}

function topCategory(categoryPath) {
  if (!categoryPath) return null;
  return categoryPath.split("/")[0].trim();
}

async function main() {
  const accessToken = process.env.KRONAN_ACCESS_TOKEN;
  const client = makeClient(accessToken);
  const { date, time } = icelandTimeNow();

  await mkdir(HOURLY_DIR, { recursive: true });

  // Grunnlínan til að bera saman við: síðasta klukkutíma-athugun ef til
  // (heldur áfram óháð dagsetningaskilum), annars nýjasta daglega
  // verðmyndin — það er upphafspunkturinn fyrstu klukkutíma-keyrsluna.
  let baseline = await readJsonSafe(BASELINE_FILE, null);
  if (!baseline) {
    const daily = await latestDailySnapshot();
    if (!daily) {
      console.log("Engin verðmynd til ennþá — sleppi klukkutíma-athugun.");
      return;
    }
    baseline = {};
    for (const p of daily.products) {
      baseline[p.sku] = { price: p.price, pricePerKilo: p.chargedByWeight ? p.pricePerKilo : null };
    }
    console.log(`Engin fyrri klukkutíma-athugun — nota nýjustu daglegu verðmyndina sem grunnlínu (${baseline ? Object.keys(baseline).length : 0} vörunúmer).`);
  }

  const knownSkus = Object.keys(baseline);
  console.log(`Klukkutíma-athugun kl. ${time} á ${knownSkus.length} vörunúmerum...`);
  const { products } = await batchRefresh(client, knownSkus, {
    onProgress: ({ done, total }) => {
      if (done % 20 === 0 || done === total) console.log(`  batch ${done}/${total}`);
    },
  });

  const changes = [];
  const newBaseline = { ...baseline };

  for (const p of products) {
    const before = baseline[p.sku];
    const afterPricePerKilo = p.chargedByWeight ? p.pricePerKilo : null;
    newBaseline[p.sku] = { price: p.price, pricePerKilo: afterPricePerKilo };

    if (!before || !before.price || !p.price) continue;
    if (before.price === p.price && before.pricePerKilo === afterPricePerKilo) continue;

    const percent = Math.round(((p.price - before.price) / before.price) * 10000) / 100;
    changes.push({
      time,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      category: topCategory(p.categoryPath),
      unit: p.baseComparisonUnit || (p.chargedByWeight ? "kg" : "stk"),
      priceBefore: before.price,
      priceAfter: p.price,
      percent,
    });
  }

  await writeFile(BASELINE_FILE, JSON.stringify(newBaseline));

  if (changes.length > 0) {
    const dayFile = new URL(`${date}.json`, HOURLY_DIR);
    const existing = await readJsonSafe(dayFile, []);
    await writeFile(dayFile, JSON.stringify([...existing, ...changes]));
    console.log(`  ${changes.length} verðbreyting(ar) skráð(ar) kl. ${time}.`);
  } else {
    console.log("  Engar verðbreytingar þessa klukkustund.");
  }

  const dayFiles = (await readdir(HOURLY_DIR))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  await writeFile(new URL("index.json", HOURLY_DIR), JSON.stringify(dayFiles.map((f) => f.replace(".json", ""))));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
