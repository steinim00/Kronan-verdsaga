import { readdir, readFile, writeFile } from "node:fs/promises";
import { readHistory } from "./updateHistory.js";

const SNAPSHOT_DIR = new URL("../data/snapshots/", import.meta.url);
const MOVERS_DIR = new URL("../data/movers/", import.meta.url);
const VOLATILITY_FILE = new URL("../data/volatility-stats.json", import.meta.url);

async function listSnapshotDates() {
  const files = await readdir(SNAPSHOT_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

async function loadSnapshot(date) {
  const raw = await readFile(new URL(`${date}.json`, SNAPSHOT_DIR), "utf-8");
  return JSON.parse(raw);
}

function toPriceEntry(p) {
  return { sku: p.sku, name: p.name, brand: p.brand, price: p.price, category: topCategory(p.categoryPath) };
}

// "Ávextir / Bananar, perur og epli / Bananar og perur" -> "Ávextir"
function topCategory(categoryPath) {
  if (!categoryPath) return null;
  return categoryPath.split("/")[0].trim();
}

function findExtremes(products, count = 5) {
  const priced = products.filter((p) => p.price && p.price > 0).map(toPriceEntry);
  const cheapest = [...priced].sort((a, b) => a.price - b.price).slice(0, count);
  const mostExpensive = [...priced].sort((a, b) => b.price - a.price).slice(0, count);
  return { cheapest, mostExpensive };
}

// Sama og findExtremes, en eitt sett af 5-ódýrustu/5-dýrustu per vöruflokk
// í staðinn fyrir eitt sameiginlegt sett — svo hægt sé að velja flokk á
// "Öfgar í verði" flipanum og sjá öfgarnar bara innan hans.
function findExtremesByCategory(products, count = 5) {
  const priced = products.filter((p) => p.price && p.price > 0).map(toPriceEntry);
  const byCategory = new Map();
  for (const p of priced) {
    const cat = p.category || "Óflokkað";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(p);
  }
  const result = {};
  for (const [cat, items] of byCategory) {
    result[cat] = {
      cheapest: [...items].sort((a, b) => a.price - b.price).slice(0, count),
      mostExpensive: [...items].sort((a, b) => b.price - a.price).slice(0, count),
    };
  }
  return result;
}

async function tagAllTimePriceList(list) {
  for (let i = 0; i < list.length; i++) {
    list[i] = await tagAllTime(list[i], list[i].price);
  }
}

// Tags an entry with whether today's price is the lowest/highest ever
// recorded for that SKU, based on its history file. Only called for the
// small handful of items that make it into the top lists — cheap.
async function tagAllTime(entry, todayPrice) {
  const { h } = await readHistory(entry.sku);
  const prices = h.map((row) => row[1]).filter((p) => p != null);
  if (prices.length === 0) return entry;
  const isLow = todayPrice <= Math.min(...prices);
  const isHigh = todayPrice >= Math.max(...prices);
  return { ...entry, allTimeLow: isLow, allTimeHigh: isHigh };
}

async function computeVolatilityTop() {
  let stats;
  try {
    stats = JSON.parse(await readFile(VOLATILITY_FILE, "utf-8"));
  } catch {
    return [];
  }
  return Object.entries(stats)
    .filter(([, s]) => s.days >= 3 && s.changes >= 2)
    .map(([sku, s]) => ({
      sku,
      name: s.name,
      brand: s.brand,
      category: s.category ?? null,
      changes: s.changes,
      days: s.days,
      lastPrice: s.lastPrice,
    }))
    .sort((a, b) => b.changes / b.days - a.changes / a.days)
    .slice(0, 5);
}

const MAX_MOVERS = 50;

// Ber saman tvær verðmyndir og skilar breytingum, hvort sem er dagur-á-dag
// eða vika-á-viku — sama rökfræði, bara mismunandi "fyrri" verðmynd.
// Shrinkflation: sama tilboðsverð á miðanum, en verð á kíló hækkar samt —
// eina leiðin sem það gerist er að pakkningin sjálf hafi minnkað. Þetta er
// bara hægt að greina fyrir vörur sem eru seldar eftir þyngd
// (chargedByWeight), því aðeins þar höfum við bæði stykkjaverð og kg-verð
// til að bera saman — fyrir venjulegar stykkjavörur er engin leið að vita
// hvort pakkningin minnkaði án upplýsinga um raunverulegt magn.
const SHRINKFLATION_THRESHOLD_PERCENT = 2;

function detectShrinkflation(today, prev) {
  const prevBySku = new Map(prev.products.map((p) => [p.sku, p]));
  const alerts = [];

  for (const p of today.products) {
    if (!p.chargedByWeight) continue;
    const before = prevBySku.get(p.sku);
    if (!before || !before.chargedByWeight) continue;
    if (!before.price || !p.price || !before.pricePerKilo || !p.pricePerKilo) continue;

    const priceUnchanged = Math.abs(p.price - before.price) < 0.01;
    if (!priceUnchanged) continue;

    const perKiloChangePercent = ((p.pricePerKilo - before.pricePerKilo) / before.pricePerKilo) * 100;
    if (perKiloChangePercent > SHRINKFLATION_THRESHOLD_PERCENT) {
      alerts.push({
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: topCategory(p.categoryPath),
        price: p.price,
        pricePerKiloBefore: before.pricePerKilo,
        pricePerKiloAfter: p.pricePerKilo,
        percent: Math.round(perKiloChangePercent * 100) / 100,
      });
    }
  }

  return alerts.sort((a, b) => b.percent - a.percent);
}

function diffSnapshots(today, prev) {
  const prevBySku = new Map(prev.products.map((p) => [p.sku, p]));
  const changes = [];

  for (const p of today.products) {
    const before = prevBySku.get(p.sku);
    if (!before) continue;

    // Weight-priced items use baseComparisonUnit (usually "kg"); everything
    // else defaults to "stk" regardless of what baseComparisonUnit says.
    const unit = p.chargedByWeight ? (p.baseComparisonUnit || "kg") : "stk";
    const useKilo = p.chargedByWeight;
    const beforeVal = useKilo ? before.pricePerKilo : before.price;
    const afterVal = useKilo ? p.pricePerKilo : p.price;

    if (!beforeVal || !afterVal) continue;
    if (beforeVal === afterVal) continue;

    const percent = ((afterVal - beforeVal) / beforeVal) * 100;
    changes.push({
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      category: topCategory(p.categoryPath),
      unit,
      priceBefore: beforeVal,
      priceAfter: afterVal,
      percent: Math.round(percent * 100) / 100,
    });
  }

  changes.sort((a, b) => b.percent - a.percent);
  const topIncreases = changes.filter((c) => c.percent > 0).slice(0, MAX_MOVERS);
  const topDecreases = changes
    .filter((c) => c.percent < 0)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, MAX_MOVERS);

  // Sömu breytingar, en raðað eftir krónutölu (priceAfter - priceBefore)
  // í stað prósentu — 2% hækkun á dýrri vöru getur verið meiri
  // krónutöluhækkun en 15% hækkun á ódýrri vöru.
  const withAmount = changes.map((c) => ({ ...c, amount: Math.round((c.priceAfter - c.priceBefore) * 100) / 100 }));
  const topIncreasesByAmount = withAmount.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, MAX_MOVERS);
  const topDecreasesByAmount = withAmount.filter((c) => c.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, MAX_MOVERS);

  return {
    changedCount: changes.length,
    increasedCount: changes.filter((c) => c.percent > 0).length,
    decreasedCount: changes.filter((c) => c.percent < 0).length,
    topIncreases,
    topDecreases,
    topIncreasesByAmount,
    topDecreasesByAmount,
  };
}

async function tagAllTimeOnLists(lists) {
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      list[i] = await tagAllTime(list[i], list[i].priceAfter);
    }
  }
}

export async function computeMovers(todayDate) {
  const dates = await listSnapshotDates();
  const todayIndex = dates.indexOf(todayDate);
  if (todayIndex === -1) {
    throw new Error(`Engin verðmynd (snapshot) fundin fyrir ${todayDate}`);
  }

  const today = await loadSnapshot(todayDate);
  const { cheapest, mostExpensive } = findExtremes(today.products);
  const extremesByCategory = findExtremesByCategory(today.products);
  let shrinkflationAlerts = [];

  let daily = {
    comparedTo: null,
    changedCount: 0,
    increasedCount: 0,
    decreasedCount: 0,
    topIncreases: [],
    topDecreases: [],
    topIncreasesByAmount: [],
    topDecreasesByAmount: [],
  };
  let weekly = { ...daily };

  if (todayIndex === 0) {
    console.log("Þetta er fyrsta verðmyndin — engin fyrri gögn til að bera saman við.");
  } else {
    const prevDate = dates[todayIndex - 1];
    const prev = await loadSnapshot(prevDate);
    daily = { comparedTo: prevDate, ...diffSnapshots(today, prev) };
    await tagAllTimeOnLists([daily.topIncreases, daily.topDecreases, daily.topIncreasesByAmount, daily.topDecreasesByAmount]);
    shrinkflationAlerts = detectShrinkflation(today, prev);

    // Vikusamanburður: notar verðmyndina frá 7 dögum áður ef hún er til.
    // Ef sagan er styttri en vika enn þá (verkefnið er nýtt) er elsta
    // verðmyndin notuð í staðinn — svo lengi sem hún er ekki sama og
    // gærdagsverðmyndin sem daglegi samanburðurinn notar nú þegar.
    const weeklyIndex = todayIndex - 7 >= 0 ? todayIndex - 7 : (todayIndex >= 2 ? 0 : -1);
    if (weeklyIndex >= 0) {
      const weekDate = dates[weeklyIndex];
      const weekSnap = await loadSnapshot(weekDate);
      weekly = { comparedTo: weekDate, ...diffSnapshots(today, weekSnap) };
      await tagAllTimeOnLists([weekly.topIncreases, weekly.topDecreases, weekly.topIncreasesByAmount, weekly.topDecreasesByAmount]);
    }
  }

  const mostVolatile = await computeVolatilityTop();
  await tagAllTimePriceList(cheapest);
  await tagAllTimePriceList(mostExpensive);

  const result = {
    date: todayDate,
    comparedTo: daily.comparedTo,
    productCount: today.products.length,
    changedCount: daily.changedCount,
    increasedCount: daily.increasedCount,
    decreasedCount: daily.decreasedCount,
    topIncreases: daily.topIncreases,
    topDecreases: daily.topDecreases,
    topIncreasesByAmount: daily.topIncreasesByAmount,
    topDecreasesByAmount: daily.topDecreasesByAmount,
    weekly: {
      comparedTo: weekly.comparedTo,
      changedCount: weekly.changedCount,
      increasedCount: weekly.increasedCount,
      decreasedCount: weekly.decreasedCount,
      topIncreases: weekly.topIncreases,
      topDecreases: weekly.topDecreases,
      topIncreasesByAmount: weekly.topIncreasesByAmount,
      topDecreasesByAmount: weekly.topDecreasesByAmount,
    },
    cheapest,
    mostExpensive,
    extremesByCategory,
    mostVolatile,
    shrinkflationAlerts,
  };

  await writeFile(
    new URL(`${todayDate}.json`, MOVERS_DIR),
    JSON.stringify(result, null, 2)
  );
  await writeFile(new URL("latest.json", MOVERS_DIR), JSON.stringify(result, null, 2));

  const moverFiles = (await readdir(MOVERS_DIR))
    .filter((f) => f.endsWith(".json") && f !== "latest.json" && f !== "index.json")
    .map((f) => f.replace(".json", ""))
    .sort();
  await writeFile(new URL("index.json", MOVERS_DIR), JSON.stringify(moverFiles, null, 2));

  return result;
}
