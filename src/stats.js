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
