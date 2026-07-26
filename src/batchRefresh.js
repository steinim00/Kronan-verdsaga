import { mapProduct } from "./productMap.js";

const BATCH_SIZE = 100; // hard max enforced by the API

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// Re-fetches current prices for a known list of SKUs via /products/batch/.
// Much cheaper than a full category crawl: 100 SKUs per request instead
// of one request per category page. SKUs that come back in `missingSkus`
// (discontinued / no longer visible) are dropped from the result — we
// don't want to compare against a stale price for a product that's gone.
export async function batchRefresh(client, skus, { onProgress } = {}) {
  const batches = chunk(skus, BATCH_SIZE);
  const products = [];
  const missing = [];

  for (let i = 0; i < batches.length; i++) {
    const res = await client.batchLookup(batches[i]);
    for (const p of res.results || []) products.push(mapProduct(p));
    for (const sku of res.missingSkus || []) missing.push(sku);
    onProgress?.({ done: i + 1, total: batches.length, productCount: products.length });
  }

  return { products, missing };
}
