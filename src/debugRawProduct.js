// Einnota debug-skrifta: sækir HRÁTT svar frá /products/batch/ fyrir nokkur
// valin vörunúmer, óunnið af mapProduct(), og vistar í
// data/debug-raw-product.json.
//
// Tilgangur: sjá nákvæmlega alla reiti sem Kronan API-ið skilar — þar á
// meðal þá sem núverandi kóði (src/productMap.js) hendir og vistar aldrei
// í daglegu keyrslunni. Keyra með: node src/debugRawProduct.js
//
// Þetta er ekki hluti af daglegu sjálfvirku keyrslunni — bara handvirkt
// verkfæri til að skoða gögnin einu sinni.

import { writeFile } from "node:fs/promises";
import { makeClient } from "./client.js";

// Fjölbreytt úrtak: venjuleg vara, vigtarvara, tvær MS-vörur, og
// snyrtivara — til að sjá hvort reitir séu ólíkir eftir vörutegund.
const SAMPLE_SKUS = [
  "100253786", // Bananar
  "100126757", // Tómatar íslenskir pk. 6 stk (chargedByWeight)
  "02500001", // MS g-mjólk
  "100093407", // Nivea sjampó color brilliance
];

async function main() {
  const accessToken = process.env.KRONAN_ACCESS_TOKEN;
  const client = makeClient(accessToken);

  console.log(`Sæki hrátt svar fyrir ${SAMPLE_SKUS.length} vörunúmer...`);
  const raw = await client.batchLookup(SAMPLE_SKUS);

  await writeFile(
    new URL("../data/debug-raw-product.json", import.meta.url),
    JSON.stringify(raw, null, 2)
  );
  console.log("Vistaði data/debug-raw-product.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
