// Tekur saman allar movers/*.json skrárnar sem til eru og telur hversu
// margar hækkanir og lækkanir hafa átt sér stað á hverjum vikudegi
// (mánudagur, þriðjudagur, o.s.frv.) yfir alla þá sögu sem til er.
//
// Því fleiri daga sem safnast, því marktækara verður þetta — með
// aðeins viku eða tveimur af gögnum er þetta meira "hvað gerðist"
// en "hvað er líklegt að gerist".

import { readdir, readFile, writeFile } from "node:fs/promises";
import { oneWayAnova, welchTTestVsRest, tukeyHSD, pearsonCorrelation } from "./stats.js";

const HOURLY_DIR = new URL("../data/hourly/", import.meta.url);

const MOVERS_DIR = new URL("../data/movers/", import.meta.url);
const OUTPUT_FILE = new URL("../data/weekday-stats.json", import.meta.url);

const WEEKDAY_NAMES = ["Sunnudagur", "Mánudagur", "Þriðjudagur", "Miðvikudagur", "Fimmtudagur", "Föstudagur", "Laugardagur"];
const ORDER = ["Mánudagur", "Þriðjudagur", "Miðvikudagur", "Fimmtudagur", "Föstudagur", "Laugardagur", "Sunnudagur"];

export async function computeWeekdayStats() {
  const files = (await readdir(MOVERS_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const stats = new Map(); // weekday name -> { up, down, days, upRates: [], downRates: [] }

  for (const f of files) {
    const raw = await readFile(new URL(f, MOVERS_DIR), "utf-8");
    const movers = JSON.parse(raw);
    if (!movers.date || movers.increasedCount == null) continue;

    const weekday = WEEKDAY_NAMES[new Date(movers.date + "T12:00:00Z").getUTCDay()];
    const entry = stats.get(weekday) || { up: 0, down: 0, days: 0, upRates: [], downRates: [] };
    entry.up += movers.increasedCount || 0;
    entry.down += movers.decreasedCount || 0;
    entry.days += 1;
    // Hlutfall vara sem hækkuðu, og hlutfall sem lækkuðu, hvort í sínu lagi —
    // normaliserar fyrir örlítið mismunandi vörufjölda milli daga.
    if (movers.productCount) {
      entry.upRates.push(((movers.increasedCount || 0) / movers.productCount) * 100);
      entry.downRates.push(((movers.decreasedCount || 0) / movers.productCount) * 100);
    }
    stats.set(weekday, entry);
  }

  // Tvö aðskilin einn-þátta ANOVA-próf: er marktækur munur á
  // hækkunarhlutfalli eftir vikudegi? Og á lækkunarhlutfalli?
  // (Sitt í hvoru lagi, því hækkanir og lækkanir gætu fylgt ólíku mynstri —
  // t.d. ef Krónan keyrir tilboð sem renna út á ákveðnum vikudegi.)
  const orderedDays = ORDER.filter((d) => stats.has(d));
  const anovaUp = oneWayAnova(orderedDays.map((d) => stats.get(d).upRates));
  const anovaDown = oneWayAnova(orderedDays.map((d) => stats.get(d).downRates));

  // ANOVA sleppir hópum sem eru tómir, svo endurbyggjum réttu vikudaga-röðina
  // fyrir þá hópa sem raunverulega enduðu í úrtakinu, til að merkja groupStats.
  function labelGroups(anova, rateKey) {
    if (!anova) return anova;
    const nonEmptyDays = orderedDays.filter((d) => stats.get(d)[rateKey].length > 0);
    anova.groupStats = anova.groupStats.map((g, i) => ({ ...g, weekday: nonEmptyDays[i] }));
    return anova;
  }
  labelGroups(anovaUp, "upRates");
  labelGroups(anovaDown, "downRates");

  // Tukey HSD: hvaða PÖR af vikudögum eru marktækt frábrugðin, leiðrétt
  // fyrir margfeldissamanburð — svarar spurningunni sem ANOVA sjálft
  // getur ekki, nefnilega "hvor dagurinn nákvæmlega".
  const tukeyUp = tukeyHSD(anovaUp);
  const tukeyDown = tukeyHSD(anovaDown);

  const result = { days: {}, anovaUp, anovaDown, tukeyUp, tukeyDown };
  for (const day of ORDER) {
    if (stats.has(day)) {
      const { up, down, days, upRates, downRates } = stats.get(day);
      const avg = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
      const sum = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) * 100) / 100 : null);

      // Er þessi tiltekni vikudagur marktækt frábrugðinn öllum hinum
      // dögunum til samans? (Welch t-próf, sjá fyrirvara í stats.js —
      // þetta er EKKI leiðrétt fyrir margfeldissamanburð.)
      const otherUpRates = orderedDays.filter((d) => d !== day).flatMap((d) => stats.get(d).upRates);
      const otherDownRates = orderedDays.filter((d) => d !== day).flatMap((d) => stats.get(d).downRates);
      const pUp = welchTTestVsRest(upRates, otherUpRates)?.p ?? null;
      const pDown = welchTTestVsRest(downRates, otherDownRates)?.p ?? null;

      result.days[day] = {
        up, down, days,
        avgUpRate: avg(upRates), avgDownRate: avg(downRates),
        sumUpRate: sum(upRates), sumDownRate: sum(downRates),
        pUp, pDown,
      };
    }
  }

  // Fylgni: er samband á milli vikudags (í röð, mánudagur=1...sunnudagur=7)
  // og HVAÐA KLUKKUTÍMA breytingar eiga sér stað, samkvæmt klukkutíma-
  // athuguninni (data/hourly/). Þarf a.m.k. þrjá vikudaga með skráðum
  // breytingum til að Pearson-fylgni sé yfirhöfuð reiknanleg.
  result.hourWeekdayCorrelation = await computeHourWeekdayCorrelation();

  await writeFile(OUTPUT_FILE, JSON.stringify(result));
  return result;
}

async function computeHourWeekdayCorrelation() {
  let hourlyFiles;
  try {
    hourlyFiles = (await readdir(HOURLY_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  } catch {
    return null; // data/hourly/ er ekki til ennþá
  }
  if (hourlyFiles.length === 0) return null;

  // Fyrir hvern dag sem klukkutíma-gögn eru til fyrir, safna klukkustund
  // hvers atburðar (fyrsta talan úr "HH:MM") ásamt vikudegi þess dags.
  const hoursByWeekday = new Map(); // weekday -> [hour, hour, ...]
  const weekdayOrderIndex = { "Mánudagur": 1, "Þriðjudagur": 2, "Miðvikudagur": 3, "Fimmtudagur": 4, "Föstudagur": 5, "Laugardagur": 6, "Sunnudagur": 7 };

  for (const f of hourlyFiles) {
    const date = f.replace(".json", "");
    const weekday = WEEKDAY_NAMES[new Date(date + "T12:00:00Z").getUTCDay()];
    const raw = await readFile(new URL(f, HOURLY_DIR), "utf-8");
    const events = JSON.parse(raw);
    if (!Array.isArray(events) || events.length === 0) continue;
    const hours = hoursByWeekday.get(weekday) || [];
    for (const e of events) {
      const hour = Number((e.time || "").split(":")[0]);
      if (!Number.isNaN(hour)) hours.push(hour);
    }
    hoursByWeekday.set(weekday, hours);
  }

  // Eitt gagnapar á vikudag: (röð vikudags, meðal klukkustund breytinga
  // þann vikudag) — reiknum Pearson-fylgni þar á milli.
  const xs = [], ys = [];
  const perWeekday = {};
  for (const [weekday, hours] of hoursByWeekday) {
    if (hours.length === 0) continue;
    const avgHour = Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 100) / 100;
    perWeekday[weekday] = { avgHour, changeCount: hours.length };
    xs.push(weekdayOrderIndex[weekday]);
    ys.push(avgHour);
  }

  const correlation = pearsonCorrelation(xs, ys);
  return { correlation, perWeekday };
}
