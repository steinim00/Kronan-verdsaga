// Sækir þau vörunúmer sem Krónan sjálf merkir sem "fryst verð".
// API-ið hefur engan sér-reit fyrir það, en vörur eru flokkaðar með
// "tags" (GET /products/tags/). Við finnum tagið sem snýst um fryst verð
// (eftir nafni/slug) og sækjum allar vörur með það tag.
//
// Ef sjálfvirk greining velur rangt tag má þvinga það með
// FROZEN_TAG_SLUG=<slug>. Vistað í data/frozen-prices.json.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { mapProduct } from "./productMap.js";

const OUT = new URL("../data/frozen-prices.json", import.meta.url);

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

  const products = [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name, "is"));
  await writeFile(
    OUT,
    JSON.stringify({ date, tags: matched.map(({ slug, name }) => ({ slug, name })), products }, null, 2)
  );
  console.log(`Vistaði ${products.length} vörunúmer með frystu verði.`);
}
