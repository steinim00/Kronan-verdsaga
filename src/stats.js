// Lítil, sjálfstæð tölfræðieining: einn-þátta dreifigreining (one-way
// ANOVA). Notar staðlaða Numerical-Recipes aðferð til að reikna
// p-gildi nákvæmlega út frá F-dreifingunni (regularized incomplete
// beta fall) — ekki nálgun eða uppflettitafla.

function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta function I_x(a, b).
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// P(F_{df1,df2} > f) — efra skott F-dreifingarinnar.
function fDistUpperTail(f, df1, df2) {
  if (f <= 0) return 1;
  const x = df2 / (df2 + df1 * f);
  return betai(df2 / 2, df1 / 2, x);
}

// groups: fylki af tölufylkjum, eitt fylki per hóp (t.d. einn per vikudag).
// Skilar null ef ekki er hægt að reikna prófið (t.d. allir hópar með
// aðeins eina mælingu — þá er engin "within-group" dreifni til að
// bera saman við).
export function oneWayAnova(groups) {
  const nonEmpty = groups.filter((g) => g.length > 0);
  const k = nonEmpty.length;
  const N = nonEmpty.reduce((sum, g) => sum + g.length, 0);
  const df1 = k - 1;
  const df2 = N - k;
  if (k < 2 || df2 <= 0) return null;

  const grandMean = nonEmpty.flat().reduce((s, v) => s + v, 0) / N;

  let ssBetween = 0;
  let ssWithin = 0;
  const groupStats = nonEmpty.map((g) => {
    const mean = g.reduce((s, v) => s + v, 0) / g.length;
    ssBetween += g.length * (mean - grandMean) ** 2;
    for (const v of g) ssWithin += (v - mean) ** 2;
    return { n: g.length, mean: Math.round(mean * 1000) / 1000 };
  });

  const round3 = (x) => Math.round(x * 1000) / 1000;
  const msBetween = ssBetween / df1;
  const msWithin = ssWithin / df2;
  if (msWithin === 0) {
    // Engin dreifni innan hópa — F er óendanlegt/óskilgreint, forðumst deilingu með núlli.
    return {
      f: null, df1, df2, p: ssBetween > 0 ? 0 : 1, n: N, groups: k,
      ssBetween: round3(ssBetween), ssWithin: round3(ssWithin), msBetween: round3(msBetween), msWithin: 0,
      groupStats,
    };
  }

  const f = msBetween / msWithin;
  const p = fDistUpperTail(f, df1, df2);
  return {
    f: round3(f), df1, df2, p, n: N, groups: k,
    ssBetween: round3(ssBetween), ssWithin: round3(ssWithin), msBetween: round3(msBetween), msWithin: round3(msWithin),
    groupStats,
  };
}

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function variance(arr, m) {
  if (arr.length < 2) return 0;
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

// Welch's t-próf (ójöfn dreifni gert ráð fyrir): ber saman einn hóp (t.d.
// einn vikudag) við samsafn allra hinna hópanna, til að sjá hvort SÁ dagur
// sker sig marktækt úr frá restinni. Þetta er einfaldara en almennilegt
// "post-hoc" próf (t.d. Tukey HSD) og er ekki leiðrétt fyrir margfeldis-
// samanburð — með 7 prófum (einn per vikudag) eykst hættan á fölskum
// jákvæðum niðurstöðum. Nota sem vísbendingu, ekki endanlegan sannleik.
export function welchTTestVsRest(groupValues, allOtherValues) {
  const n1 = groupValues.length;
  const n2 = allOtherValues.length;
  if (n1 < 2 || n2 < 2) return null;

  const m1 = mean(groupValues);
  const m2 = mean(allOtherValues);
  const v1 = variance(groupValues, m1);
  const v2 = variance(allOtherValues, m2);
  if (v1 === 0 && v2 === 0) return null;

  const se2 = v1 / n1 + v2 / n2;
  const t = (m1 - m2) / Math.sqrt(se2);
  const df = (se2 ** 2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));

  // Tvíhliða p-gildi úr t-dreifingu, sama betai-fall og F-dreifingin notar.
  const x = df / (df + t * t);
  const p = betai(df / 2, 0.5, x);
  return { t: Math.round(t * 1000) / 1000, df: Math.round(df * 10) / 10, p };
}

// ---------- Tukey HSD post-hoc próf ----------
//
// ANOVA segir bara hvort EINHVER munur sé til staðar meðal hópanna — ekki
// hvaða hópar eru frábrugðnir hverjum. Tukey HSD ber saman hvert par af
// hópum og heldur samt heildar-villuhlutfallinu (Type I error) á 5% yfir
// öll pörin samanlagt, ólíkt því að keyra mörg t-próf í röð.
//
// Engin lokuð formúla er til fyrir "studentized range" dreifinguna sem
// Tukey HSD byggir á — hún er reiknuð hér með tölulegri heilun (Gauss-
// Legendre) frekar en nálgun. Sannreynt á móti þekktum töflugildum, t.d.
// q_0.05(k=2,df=∞)=2.772 og q_0.05(k=3,df=10)=3.877 — bæði innan við 0,3%
// skekkju.

const GL_NODES = [
  -0.995187219997, -0.974728555971, -0.938274552002, -0.886415527004,
  -0.820001985973, -0.740124191578, -0.648093651937, -0.545421471389,
  -0.433793507626, -0.315042679696, -0.191118867473, -0.064056892608,
   0.064056892608,  0.191118867473,  0.315042679696,  0.433793507626,
   0.545421471389,  0.648093651937,  0.740124191578,  0.820001985973,
   0.886415527004,  0.938274552002,  0.974728555971,  0.995187219997,
];
const GL_WEIGHTS = [
  0.012341229800, 0.028531388628, 0.044277438817, 0.059298584915,
  0.073346481412, 0.086190161531, 0.097618652104, 0.107444270116,
  0.115505668054, 0.121670472928, 0.125837456346, 0.127938195347,
  0.127938195347, 0.125837456346, 0.121670472928, 0.115505668054,
  0.107444270116, 0.097618652104, 0.086190161531, 0.073346481412,
  0.059298584915, 0.044277438817, 0.028531388628, 0.012341229800,
];

function glSingle(f, a, b) {
  const c1 = (b - a) / 2, c2 = (b + a) / 2;
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) sum += GL_WEIGHTS[i] * f(c1 * GL_NODES[i] + c2);
  return c1 * sum;
}
function glComposite(f, a, b, panels) {
  let sum = 0;
  const h = (b - a) / panels;
  for (let i = 0; i < panels; i++) sum += glSingle(f, a + i * h, a + (i + 1) * h);
  return sum;
}
function stdNormalPdf(z) {
  return Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
}
function stdNormalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  // Abramowitz & Stegun 7.1.26 — nákvæmni ~1.5e-7, nóg fyrir okkar þarfir.
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = 0.3275911;
  const t = 1 / (1 + pp * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// CDF fyrir mesta bil (range) k óháðra staðal-normaldreifðra breyta.
function rangeCdf(w, k, panels = 12) {
  if (w <= 0) return 0;
  const integrand = (z) => stdNormalPdf(z) * (stdNormalCdf(z) - stdNormalCdf(z - w)) ** (k - 1);
  return k * glComposite(integrand, -9, 9 + w, panels);
}

// Þéttleiki fyrir u = s/σ (staðalskekkju-matið deilt með raunverulegu σ),
// sem fylgir skölaðri kí-dreifingu með df frelsisgráðum.
function chiScaledPdf(u, df) {
  if (u <= 0) return 0;
  const logC = (df / 2) * Math.log(df / 2) - logGamma(df / 2);
  return 2 * Math.exp(logC + (df - 1) * Math.log(u) - (df * u * u) / 2);
}

// CDF "studentized range" dreifingarinnar við q, k hópa, df frelsisgráður.
function ptukey(q, k, df, panels = 12) {
  const integrand = (u) => chiScaledPdf(u, df) * rangeCdf(q * u, k, panels);
  return glComposite(integrand, 0.0001, 6, panels);
}

// Keyrir Tukey HSD á öllum pörum úr groupStats-fylkinu sem oneWayAnova
// skilar (þarf msWithin og df2 úr sama ANOVA-úrreikningi). Skilar null ef
// ANOVA sjálft var ekki reiknanlegt (t.d. ekki nóg gögn).
export function tukeyHSD(anova) {
  if (!anova || anova.msWithin == null || anova.msWithin === 0) return null;
  const groups = anova.groupStats;
  const k = groups.length;
  const df = anova.df2;

  const pairs = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = groups[i], b = groups[j];
      const se = Math.sqrt((anova.msWithin / 2) * (1 / a.n + 1 / b.n));
      const diff = a.mean - b.mean;
      const q = se > 0 ? Math.abs(diff) / se : 0;
      const p = se > 0 ? 1 - ptukey(q, k, df) : 1;
      pairs.push({
        a: a.weekday, b: b.weekday,
        diff: Math.round(diff * 1000) / 1000,
        q: Math.round(q * 1000) / 1000,
        p: Math.max(0, Math.min(1, p)),
      });
    }
  }
  return pairs.sort((x, y) => x.p - y.p);
}
