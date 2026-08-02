import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { makeClient } from "./client.js";
import { crawlCatalog } from "./crawl.js";
import { batchRefresh } from "./batchRefresh.js";
import { computeMovers } from "./computeMovers.js";
import { buildIndex } from "./buildIndex.js";
import { updateHistory } from "./updateHistory.js";
import { fetchCpi } from "./fetchCpi.js";
import { computeCategoryTrends } from "./computeCategoryTrends.js";
import { computeWeekdayStats } from "./computeWeekdayStats.js";

const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);

function todayIcelandDate() {
  // Iceland has no DST and sits at UTC+0, so the UTC date is correct.
  return new Date().toISOString().slice(0, 10);
}

async function latestSnapshot() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const raw = await readFile(new URL(files[files.length - 1], SNAPSHOT_DIR), "utf-8");
  return JSON.parse(raw);
}

async function main() {
  const accessToken = process.env.KRONAN_ACCESS_TOKEN;
  const client = makeClient(accessToken);
  const date = todayIcelandDate();

  const prev = await latestSnapshot();
  // Sunday (UTC day 0) triggers a full re-crawl to pick up newly listed
  // products; every other day just refreshes known SKUs via /products/batch/,
  // which is far cheaper. Set FORCE_FULL_CRAWL=1 to always do a full crawl.
  const isDiscoveryDay = !prev || new Date().getUTCDay() === 0 || process.env.FORCE_FULL_CRAWL === "1";

  let products;

  if (isDiscoveryDay) {
    console.log(`Full kategoríu-labb fyrir ${date}...`);
    products = await crawlCatalog(client, {
      onProgress: ({ done, total, productCount }) => {
        if (done % 10 === 0 || done === total) {
          console.log(`  kategoríur ${done}/${total} — ${productCount} vörunúmer hingað til`);
        }
      },
    });
  } else {
    const knownSkus = prev.products.map((p) => p.sku);
    console.log(`Hraðuppfærsla fyrir ${date} á ${knownSkus.length} þekktum vörunúmerum...`);
    const { products: refreshed, missing } = await batchRefresh(client, knownSkus, {
      onProgress: ({ done, total }) => console.log(`  batch ${done}/${total}`),
    });
    if (missing.length > 0) {
      console.log(`  ${missing.length} vörunúmer ekki lengur til (sleppt): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`);
    }
    products = refreshed;
  }

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(
    new URL(`${date}.json`, SNAPSHOT_DIR),
    JSON.stringify({ date, products }, null, 2)
  );
  console.log(`Vistaði verðmynd: ${products.length} vörunúmer.`);

  console.log("Uppfæri leitarvísi og verðsögu á vörunúmerum...");
  await buildIndex(products);
  await updateHistory(products, date);

  const movers = await computeMovers(date);
  if (movers) {
    console.log(`Top hækkanir:`, movers.topIncreases);
    console.log(`Top lækkanir:`, movers.topDecreases);
  }

  try {
    console.log("Reikna verðvísitölu eftir vöruflokkum...");
    await computeCategoryTrends();
  } catch (err) {
    console.log(`  Flokkavísitala mistókst (halda samt áfram): ${err.message}`);
  }

  try {
    console.log("Reikna hækkanir/lækkanir eftir vikudegi...");
    await computeWeekdayStats();
  } catch (err) {
    console.log(`  Vikudagatölfræði mistókst (halda samt áfram): ${err.message}`);
  }

  try {
    console.log("Sæki vísitölu neysluverðs frá Hagstofunni...");
    const cpi = await fetchCpi();
    await writeFile(new URL("../data/cpi.json", import.meta.url), JSON.stringify(cpi, null, 2));
    console.log(`  VNV ${cpi.month}: ${cpi.index} stig (mán. ${cpi.monthChangePercent}%, ár ${cpi.yearChangePercent}%)`);
  } catch (err) {
    // Ekki mikilvægt fyrir aðalvirknina — ef Hagstofan er niðri eða
    // breytir töflunni skal það ekki stoppa daglegu Krónu-keyrsluna.
    console.log(`  VNV-sókn mistókst (halda samt áfram): ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
