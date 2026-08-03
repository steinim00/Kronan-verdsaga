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
  "https://px.hagstofa.is/pxis/api/v1/is/Efnahagur/visitolur/1_vnv/1_vnv/VIS01000.px";
const FOOD_TABLE_URL =
  "https://px.hagstofa.is/pxis/api/v1/is/Efnahagur/visitolur/1_vnv/2_undirvisitolur/VIS01300.px";

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

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("M").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}M${String(newM).padStart(2, "0")}`;
}

function pctChange(from, to) {
  if (from == null || to == null || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

async function fetchFoodSubindex() {
  const meta = await fetchTableMeta(FOOD_TABLE_URL);

  const lidurVar = meta.variables.find((v) => v.code === "Liður");
  const undirVar = meta.variables.find((v) => v.code === "Undirvísitala");
  if (!lidurVar || !undirVar) {
    throw new Error("Matarvísitala: óvænt uppbygging á töflu hjá Hagstofunni (breytur fundust ekki)");
  }

  // Þessi tafla hefur EKKI "Ársbreyting, %" sem valkost í Liður — bara
  // vísitölugildi, vægi og mánaðarbreytingu. Því sækjum við 13 mánuði af
  // hráum vísitölugildum og reiknum bæði mánaðar- og ársbreytingu sjálf.
  const gildiCode = findCode(lidurVar, "Vísitala");
  const maturCode = findCode(undirVar, "01 Matur og óáfengir drykkir");

  const query = {
    query: [
      { code: "Mánuður", selection: { filter: "top", values: ["13"] } },
      { code: "Liður", selection: { filter: "item", values: [gildiCode] } },
      { code: "Undirvísitala", selection: { filter: "item", values: [maturCode] } },
    ],
    response: { format: "json" },
  };

  const result = await postQuery(FOOD_TABLE_URL, query);

  const monthIdx = result.columns.findIndex((c) => c.code === "Mánuður");
  if (monthIdx === -1) throw new Error("Matarvísitala: fann ekki dálka í svari Hagstofunnar");

  const rows = result.data
    .map((row) => ({ month: row.key[monthIdx], index: Number(row.values[0].replace(",", ".")) }))
    .filter((r) => !Number.isNaN(r.index))
    .sort((a, b) => a.month.localeCompare(b.month));

  if (rows.length === 0) throw new Error("Matarvísitala: engin gögn fundust");

  const latest = rows[rows.length - 1];
  const prevMonth = rows[rows.length - 2] || null;
  const yearAgo = rows.find((r) => r.month === shiftMonth(latest.month, -12)) || null;

  return {
    month: latest.month,
    index: latest.index,
    monthChangePercent: prevMonth ? pctChange(prevMonth.index, latest.index) : null,
    yearChangePercent: yearAgo ? pctChange(yearAgo.index, latest.index) : null,
  };
}

// Handvalin pörun á milli vöruflokka Krónu-verðsögu og COICOP-undirflokka
// Hagstofunnar — flokkarnir heita ekki það sama, svo þetta er handgert og
// bara fyrir þá flokka sem eiga skýra, ótvíræða hliðstæðu. Ef Krónan
// endurraðar sínum flokkum þarf að uppfæra þetta.
const CATEGORY_TO_COICOP = {
  "Ávextir": "0116 Ávextir og hnetur",
  "Grænmeti": "0117 Grænmeti, hnýði, mjölbananar, bananar til eldunar og belgjurtir",
  "Tilbúnir réttir": "0119 Tilbúnir réttir og aðrar matvörur ót.a.s",
  "Fiskur": "0113 Fiskur og annað sjávarfang",
  "Kjöt": "0112 Kjöt, lifandi dýr og aðrir hlutar af slátruðum landdýrum",
  "Mjólkurvörur og egg": "0114 Mjólk, mjólkurvörur og egg",
  "Drykkir": "012 Óáfengir drykkir",
  "Brauð, kökur og kex": "01113 Brauð og bakarísvörur",
};

export async function fetchCategorySubindices() {
  const meta = await fetchTableMeta(FOOD_TABLE_URL);
  const lidurVar = meta.variables.find((v) => v.code === "Liður");
  const undirVar = meta.variables.find((v) => v.code === "Undirvísitala");
  if (!lidurVar || !undirVar) {
    throw new Error("Flokka-undirvísitölur: óvænt uppbygging á töflu hjá Hagstofunni");
  }
  const gildiCode = findCode(lidurVar, "Vísitala");

  // Finnum COICOP-kóðana fyrir þá flokka sem við eigum pörun fyrir; sleppum
  // þeim sem finnast ekki í staðinn fyrir að láta allt klikka.
  const wanted = [];
  for (const [ourName, coicopText] of Object.entries(CATEGORY_TO_COICOP)) {
    const i = undirVar.valueTexts.findIndex((t) => t === coicopText);
    if (i !== -1) wanted.push({ ourName, code: undirVar.values[i] });
  }
  if (wanted.length === 0) return {};

  const query = {
    query: [
      { code: "Mánuður", selection: { filter: "top", values: ["13"] } },
      { code: "Liður", selection: { filter: "item", values: [gildiCode] } },
      { code: "Undirvísitala", selection: { filter: "item", values: wanted.map((w) => w.code) } },
    ],
    response: { format: "json" },
  };

  const result = await postQuery(FOOD_TABLE_URL, query);
  const monthIdx = result.columns.findIndex((c) => c.code === "Mánuður");
  const undirIdx = result.columns.findIndex((c) => c.code === "Undirvísitala");
  if (monthIdx === -1 || undirIdx === -1) throw new Error("Flokka-undirvísitölur: fann ekki dálka í svari");

  const byCode = new Map(); // code -> [{month, index}]
  for (const row of result.data) {
    const code = row.key[undirIdx];
    const index = Number(row.values[0].replace(",", "."));
    if (Number.isNaN(index)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ month: row.key[monthIdx], index });
  }

  const output = {};
  for (const { ourName, code } of wanted) {
    const rows = (byCode.get(code) || []).sort((a, b) => a.month.localeCompare(b.month));
    if (rows.length === 0) continue;
    const latest = rows[rows.length - 1];
    const prevMonth = rows[rows.length - 2] || null;
    const yearAgo = rows.find((r) => r.month === shiftMonth(latest.month, -12)) || null;
    output[ourName] = {
      month: latest.month,
      index: latest.index,
      monthChangePercent: prevMonth ? pctChange(prevMonth.index, latest.index) : null,
      yearChangePercent: yearAgo ? pctChange(yearAgo.index, latest.index) : null,
    };
  }
  return output;
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
