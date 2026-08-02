// Tekur saman allar movers/*.json skrárnar sem til eru og telur hversu
// margar hækkanir og lækkanir hafa átt sér stað á hverjum vikudegi
// (mánudagur, þriðjudagur, o.s.frv.) yfir alla þá sögu sem til er.
//
// Því fleiri daga sem safnast, því marktækara verður þetta — með
// aðeins viku eða tveimur af gögnum er þetta meira "hvað gerðist"
// en "hvað er líklegt að gerist".

import { readdir, readFile, writeFile } from "node:fs/promises";

const MOVERS_DIR = new URL("../data/movers/", import.meta.url);
const OUTPUT_FILE = new URL("../data/weekday-stats.json", import.meta.url);

const WEEKDAY_NAMES = ["Sunnudagur", "Mánudagur", "Þriðjudagur", "Miðvikudagur", "Fimmtudagur", "Föstudagur", "Laugardagur"];

export async function computeWeekdayStats() {
  const files = (await readdir(MOVERS_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const stats = new Map(); // weekday name -> { up, down, days }

  for (const f of files) {
    const raw = await readFile(new URL(f, MOVERS_DIR), "utf-8");
    const movers = JSON.parse(raw);
    if (!movers.date || movers.increasedCount == null) continue;

    const weekday = WEEKDAY_NAMES[new Date(movers.date + "T12:00:00Z").getUTCDay()];
    const entry = stats.get(weekday) || { up: 0, down: 0, days: 0 };
    entry.up += movers.increasedCount || 0;
    entry.down += movers.decreasedCount || 0;
    entry.days += 1;
    stats.set(weekday, entry);
  }

  // Raða í eðlilega vikudagaröð (mánudagur fyrst), ekki bara innsetningarröð.
  const order = ["Mánudagur", "Þriðjudagur", "Miðvikudagur", "Fimmtudagur", "Föstudagur", "Laugardagur", "Sunnudagur"];
  const result = {};
  for (const day of order) {
    if (stats.has(day)) result[day] = stats.get(day);
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(result));
  return result;
}
