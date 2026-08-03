// Sækir tvær vísitölur frá Hagstofu Íslands (PXWeb API):
//   1) Heildar vísitala neysluverðs (VNV) — VIS01000
//   2) Undirvísitala fyrir "01 Matur og óáfengir drykkir" — VIS01300
//      (þetta er flokkurinn sem passar best við Krónu-gögnin okkar)
//
// Þetta er alveg óháð Krónu-gögnunum og keyrir bara einu sinni á dag.
// Kóðarnir fyrir breyturnar eru sóttir úr lýsigögnum hverrar töflu í
// hvert sinn (ekki hardkóðaðir), svo þetta heldur áfram að virka þó
// Hagstofan endurraði innri kóðum í töflunum.

const OVERALL_TABLE_URL =
  "https://px.hagstofa.is/pxis/api/v1/is/Efnahagur/Efnahagur__visitolur__1_vnv__1_vnv/VIS01000.px";
const FOOD_TABLE_URL =
  "https://px.hagstofa.is/pxis/api/v1/is/Efnahagur/Efnahagur__visitolur__1_vnv__2_undirvisitolur/VIS01300.px";

function findCode(variable, wantedText) {
  const i = variable.valueTexts.findIndex((t) => t === wantedText);
  if (i === -1) {
    throw new Error(`Fann ekki gildið "${wantedText}" í breytunni ${variable.code}`);
  }
  return variable.values[i];
}

const COMMON_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; Kronan-verdsaga/1.0; +https://github.com/steinim00/Kronan-verdsaga)",
};

async function fetchTableMeta(url) {
  const res = await fetch(url, { headers: COMMON_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`lýsigögn -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function postQuery(url, query) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fyrirspurn -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchOverallCpi() {
  const meta = await fetchTableMeta(OVERALL_TABLE_URL);

  const visitalaVar = meta.variables.find((v) => v.code === "Vísitala");
  const lidurVar = meta.variables.find((v) => v.code === "Liður");
  if (!visitalaVar || !lidurVar) {
    throw new Error("VNV: óvænt uppbygging á töflu hjá Hagstofunni (breytur fundust ekki)");
  }

  const visitalaCode = findCode(visitalaVar, "Vísitala neysluverðs");
  const gildiCode = findCode(lidurVar, "Vísitala");
  const manadarbreytingCode = findCode(lidurVar, "Mánaðarbreyting, %");
  const arsbreytingCode = findCode(lidurVar, "Ársbreyting, %");

  const query = {
    query: [
      { code: "Mánuður", selection: { filter: "top", values: ["1"] } },
      { code: "Vísitala", selection: { filter: "item", values: [visitalaCode] } },
      { code: "Liður", selection: { filter: "item", values: [gildiCode, manadarbreytingCode, arsbreytingCode] } },
    ],
    response: { format: "json" },
  };

  const result = await postQuery(OVERALL_TABLE_URL, query);

  const monthIdx = result.columns.findIndex((c) => c.code === "Mánuður");
  const lidurIdx = result.columns.findIndex((c) => c.code === "Liður");
  if (monthIdx === -1 || lidurIdx === -1) throw new Error("VNV: fann ekki dálka í svari Hagstofunnar");

  const byLidur = {};
  for (const row of result.data) {
    byLidur[row.key[lidurIdx]] = Number(row.values[0].replace(",", "."));
  }

  return {
    month: result.data[0]?.key[monthIdx] ?? null,
    index: byLidur[gildiCode] ?? null,
    monthChangePercent: byLidur[manadarbreytingCode] ?? null,
    yearChangePercent: byLidur[arsbreytingCode] ?? null,
  };
}

async function fetchFoodSubindex() {
  const meta = await fetchTableMeta(FOOD_TABLE_URL);

  const lidurVar = meta.variables.find((v) => v.code === "Liður");
  const undirVar = meta.variables.find((v) => v.code === "Undirvísitala");
  if (!lidurVar || !undirVar) {
    throw new Error("Matarvísitala: óvænt uppbygging á töflu hjá Hagstofunni (breytur fundust ekki)");
  }

  // Athugið: þessi tafla hefur EKKI "Ársbreyting, %" sem valkost, bara
  // vísitölugildi, vægi og mánaðarbreytingu.
  const gildiCode = findCode(lidurVar, "Vísitala");
  const manadarbreytingCode = findCode(lidurVar, "Mánaðarbreyting, %");
  const maturCode = findCode(undirVar, "01 Matur og óáfengir drykkir");

  const query = {
    query: [
      { code: "Mánuður", selection: { filter: "top", values: ["1"] } },
      { code: "Liður", selection: { filter: "item", values: [gildiCode, manadarbreytingCode] } },
      { code: "Undirvísitala", selection: { filter: "item", values: [maturCode] } },
    ],
    response: { format: "json" },
  };

  const result = await postQuery(FOOD_TABLE_URL, query);

  const monthIdx = result.columns.findIndex((c) => c.code === "Mánuður");
  const lidurIdx = result.columns.findIndex((c) => c.code === "Liður");
  if (monthIdx === -1 || lidurIdx === -1) throw new Error("Matarvísitala: fann ekki dálka í svari Hagstofunnar");

  const byLidur = {};
  for (const row of result.data) {
    byLidur[row.key[lidurIdx]] = Number(row.values[0].replace(",", "."));
  }

  return {
    month: result.data[0]?.key[monthIdx] ?? null,
    index: byLidur[gildiCode] ?? null,
    monthChangePercent: byLidur[manadarbreytingCode] ?? null,
  };
}

export async function fetchCpi() {
  const overall = await fetchOverallCpi();

  let food = null;
  try {
    food = await fetchFoodSubindex();
  } catch (err) {
    // Ekki láta matarvísitöluna stöðva heildar-VNV ef hún klikkar ein og sér.
    console.log(`  Matarvísitala (undirvísitala) mistókst: ${err.message}`);
  }

  return { fetchedAt: new Date().toISOString(), overall, food };
}
