import { writeFile } from "node:fs/promises";

// A small file (no prices, just enough to search by name/sku/brand) so the
// dashboard can offer instant search without downloading a full snapshot.
export async function buildIndex(products) {
  const index = products.map((p) => ({
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    categoryPath: p.categoryPath,
    chargedByWeight: p.chargedByWeight,
  }));

  await writeFile(
    new URL("../data/products-index.json", import.meta.url),
    JSON.stringify(index)
  );

  return index;
}
