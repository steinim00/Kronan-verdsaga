export function mapProduct(p) {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand ?? null,
    price: p.price,
    discountedPrice: p.discountedPrice ?? null,
    onSale: !!p.onSale,
    pricePerKilo: p.pricePerKilo ?? null,
    chargedByWeight: !!p.chargedByWeight,
    categoryPath: p.categoryPath ?? null,
  };
}
