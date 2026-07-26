// Walks the category tree, then pages through every leaf category's
// product listing, collecting the current price for every SKU seen.
// This is how we get "most vörunúmer" — the API has no single
// "list all products" endpoint, so we go via categories.
//
// This is the slow-but-thorough path: use it for the first run and
// then periodically (see index.js) to pick up newly listed products.
// Day-to-day refreshes should use batchRefresh.js instead, which is
// far cheaper once we already know the SKUs.

import { mapProduct } from "./productMap.js";

function collectLeafSlugs(categories, out = []) {
  for (const cat of categories) {
    const children = cat.children || [];
    if (children.length === 0) {
      out.push(cat.slug);
    } else {
      collectLeafSlugs(children, out);
    }
  }
  return out;
}

export async function crawlCatalog(client, { onProgress } = {}) {
  const tree = await client.getCategories();
  const leafSlugs = collectLeafSlugs(tree);

  // sku -> product snapshot. A dedupe map, since some products can
  // plausibly show up under more than one leaf category.
  const products = new Map();

  for (let i = 0; i < leafSlugs.length; i++) {
    const slug = leafSlugs[i];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await client.getCategoryProducts(slug, page);
      for (const p of data.products || []) {
        products.set(p.sku, mapProduct(p));
      }
      hasNextPage = !!data.hasNextPage;
      page += 1;
    }

    onProgress?.({ done: i + 1, total: leafSlugs.length, slug, productCount: products.size });
  }

  return Array.from(products.values());
}
