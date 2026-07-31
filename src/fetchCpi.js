// Sækir vísitölu neysluverðs (VNV) frá Hagstofu Íslands (PXWeb API) —
// nýjasta gildi, mánaðarbreytingu og ársbreytingu í prósentum.
//
// Þetta er alveg óháð Krónu-gögnunum og keyrir bara einu sinni á dag.
// Kóðarnir fyrir breyturnar eru sóttir úr lýsigögnum töflunnar í
// hvert sinn (ekki hardkóðaðir), svo þetta heldur áfram að virka þó
// Hagstofan endurraði innri kóðum í töflunni.

const TABLE_URL =
  "https://px.hagstofa.is/pxis/api/v1/is/Efnahagur/Efnahagur__visitolur__1_vnv__1_vnv/VIS01000.px";

function findCode(variable, wantedText) {
  const i = variable.valueTexts.findIndex((t) => t === wantedText);
  if (i === -1) {
    throw new Error(`VNV: fann ekki gildið "${wantedText}" í breytunni ${variable.code}`);
  }
  return variable.values[i];
}

export async function fetchCpi() {
  const metaRes = await fetch(TABLE_URL);
  if (!metaRes.ok) throw new Error(`VNV lýsigögn -> ${metaRes.status}`);
  const meta = await metaRes.json();

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
      {
        code: "Liður",
        selection: {
          filter: "item",
          values: [gildiCode, manadarbreytingCode, arsbreytingCode],
        },
      },
    ],
    response: { format: "json" },
  };

  const res = await fetch(TABLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VNV fyrirspurn -> ${res.status}: ${text}`);
  }
  const result = await res.json();

  const monthIdx = result.columns.findIndex((c) => c.code === "Mánuður");
  const lidurIdx = result.columns.findIndex((c) => c.code === "Liður");
  if (monthIdx === -1 || lidurIdx === -1) {
    throw new Error("VNV: fann ekki dálka í svari Hagstofunnar");
  }

  const byLidur = {};
  for (const row of result.data) {
    byLidur[row.key[lidurIdx]] = Number(row.values[0].replace(",", "."));
  }

  return {
    month: result.data[0]?.key[monthIdx] ?? null, // t.d. "2026M05"
    index: byLidur[gildiCode] ?? null,
    monthChangePercent: byLidur[manadarbreytingCode] ?? null,
    yearChangePercent: byLidur[arsbreytingCode] ?? null,
    fetchedAt: new Date().toISOString(),
  };
}
