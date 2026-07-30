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
    baseComparisonUnit: p.baseComparisonUnit ?? null,
    categoryPath: p.categoryPath ?? null,
  };
}
