# Kronan Price Tracker (Kronan-verdsaga)

Safnar daglega verði á flestum vörunúmerum hjá Krónunni (með því að labba
í gegnum kategoríutréð) og reiknar út verðbreytingar, tölfræði og
vörumerkjasamanburð. Keyrir sjálfvirkt á hverjum degi með GitHub Actions
og birtir niðurstöðuna á kvittunar-stíluðu mælaborði, bæði á íslensku og
ensku.

**Lifandi síða:** https://steinim00.github.io/Kronan-verdsaga/
(enska útgáfan: `/index-en.html`)

Athugið: Kronan API-ið sjálft geymir enga verðsögu — það sýnir bara
núverandi verð. Þetta verkefni býr því til sína eigin sögu með því að
vista daglegar "verðmyndir" (snapshots) og bera þær saman dag frá degi.

## Uppsetning

### 1. Búa til AccessToken

- Skráðu þig inn á Kronan Smartstore með **Auðkenni** (rafræn skilríki).
- Farðu í stillingar á notandasíðunni þinni (eða "Customer group" síðu ef
  þú notar fyrirtækjaaðgang) og búðu til Access Token þar.

### 2. Setja tókann sem GitHub secret

Í repo-inu á GitHub: **Settings → Secrets and variables → Actions → New
repository secret**

- Nafn: `KRONAN_ACCESS_TOKEN`
- Gildi: tókaninn þinn

### 3. Kveikja á GitHub Pages (fyrir mælaborðið)

**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**

Síðan er mælaborðið aðgengilegt á `https://<notandi>.github.io/<repo>/`.

### 4. Fyrsta keyrslan

Workflow-ið (`.github/workflows/daily.yml`) keyrir sjálfkrafa á hverjum
degi kl. 06:00. Þú getur líka keyrt hana handvirkt strax: farðu í
**Actions → Daily price snapshot → Run workflow**.

Fyrsta keyrslan safnar bara grunnverði — samanburður og top-listar birtast
ekki fyrr en daginn eftir, þegar það er komin önnur verðmynd til að bera
saman við. Sum tölfræðin (vikusamanburður, mánaðarsamanburður, ANOVA/
Tukey HSD) þarf lengri sögu til að verða marktæk — þau birta skýr
skilaboð um að gögn vanti í staðinn fyrir að birta tóma/villandi lista.

## Staðbundin keyrsla (til að prófa)

```bash
npm install --omit=dev # engar utanaðkomandi pakkar eru notaðir, en þetta er meinlaust
KRONAN_ACCESS_TOKEN=xxx node src/index.js
```

## Hvernig þetta virkar

Tvær leiðir til að ná í verð, valið sjálfkrafa í `src/index.js`:

- **Full kategoríu-labb** (`src/crawl.js`) — labbar allt kategoríutréð
  (`/categories/`), finnur allar "leaf" kategoríur, og labbar allar síður
  hverrar kategoríu (`/categories/{slug}/products/`). Notað fyrstu
  keyrsluna (engin fyrri gögn til) og svo sjálfkrafa á sunnudögum til að
  ná nýjum vörum sem hafa bæst við.
- **Hraðuppfærsla** (`src/batchRefresh.js`) — notar
  `POST /products/batch/` (allt að 100 SKU í hverju kalli) til að
  endurlesa verð á vörunúmerum sem þegar eru þekkt frá deginum áður.
  Notað alla aðra daga — mun færri köll en fulla labbið. Vörunúmer sem
  API-ið skilar í `missingSkus` (t.d. hætt að selja) eru sleppt úr
  nýju verðmyndinni.

### Bakenda-skriftur (`src/`)

1. **`index.js`** — stýriskrifta sem keyrir allt annað í röð, hverja í
   sínu `try/catch` svo ein bilun stoppi ekki hinar.
2. **`computeMovers.js`** — kjarnaútreikningurinn. Ber saman verðmyndir
   á fjórum tímabilum (sólarhringur, vika, mánuður, þessi almanaksmánuður),
   reiknar % og krónutölubreytingu, finnur 5 ódýrustu/dýrustu vörur
   (heildar og per vöruflokk), greinir shrinkflation (sjá neðar), og
   vistar allt í `data/movers/YYYY-MM-DD.json`.
3. **`computeCategoryTrends.js`** — óvegin verðvísitala per vöruflokk
   (100 = fyrsta skráða verðmynd), vistuð í `data/category-trends.json`.
4. **`computeWeekdayStats.js`** — hækkanir/lækkanir eftir vikudegi, og
   tölfræðiprófin (sjá næsta kafla). Vistað í `data/weekday-stats.json`.
5. **`fetchCpi.js`** — sækir vísitölu neysluverðs og matvælavísitölu frá
   Hagstofu Íslands (PXWeb API), plús undirvísitölur fyrir þá vöruflokka
   sem eiga skýra hliðstæðu hjá Hagstofunni. Vistað í `data/cpi.json` og
   `data/cpi-categories.json`.
6. **`stats.js`** — sjálfstæð tölfræðieining: einn-þátta ANOVA, Welch
   t-próf, og Tukey HSD post-hoc próf. Öll sannreynd á móti R (nákvæm
   samsvörun við `aov()`/`TukeyHSD()` upp á 3-4 aukastafi — sjá athugasemdir
   efst í skránni fyrir dæmin sem voru notuð).
7. **`buildIndex.js`** — skrifar `data/products-index.json` fyrir leitina.
8. **`updateHistory.js`** — bætir daginn við `data/history/<sku>.json`
   (bara þegar verð breytist — sjá "gisin sögu-skráning" neðar) og
   heldur `data/volatility-stats.json`.

`index.html` / `index-en.html` lesa þessi JSON-skjöl beint í vafranum —
ekkert build-skref, engin bakenda-þjónusta þarf að keyra.

## Eiginleikar í mælaborðinu

**Yfirlit-flipinn**
- Mestu hækkanir/lækkanir, raðanlegt eftir % eða krónutölu
- Fjögur tímabil: síðasti sólarhringur, síðasta vika, síðasti mánuður
  (rúllandi 30 dagar), og "á þessum mánuði" (frá 1. hverjum mánuði)
- Vöruflokkatákn (23 handteiknuð SVG-tákn, lituð í vörumerkjalitum
  Krónunnar) fyrir framan hverja vöru

**Öfgar í verði**
- 5 ódýrustu og 5 dýrustu vörur, annaðhvort af öllum vörunúmerum eða
  innan valins vöruflokks
- Óstöðugustu vörurnar (vörur sem skipta oftast um verð)

**Tölfræði**
- Hækkanir/lækkanir eftir vikudegi, með meðalhlutfalli per dag
- Welch t-próf: er einhver tiltekinn vikudagur marktækt frábrugðinn
  hinum til samans?
- Einn-þátta ANOVA: er marktækur munur á milli allra vikudaga?
- Tukey HSD: nákvæmlega hvaða PÖR af vikudögum eru frábrugðin (leiðrétt
  fyrir margfeldissamanburð)

**Annað**
- **Leit** — nafn/vörunúmer/vörumerki, niðurstöður jafnóðum
- **Verðferill vöru** — línurit með hover-tooltip (verð + dagsetning)
  þegar smellt er á hvaða vöru sem er
- **Flokka-verðferill** — smelltu á flokksheiti til að sjá vísitölu þess
  flokks yfir tíma, með samanburði við opinbera Hagstofu-undirvísitölu
  þar sem hún er til
- **Shrinkflation-viðvörun** — fyrir vigtarvörur: ef stykkjaverð er
  óbreytt en kg-verð hækkar, birtist rautt viðvörunarborði efst á síðunni
- **Eftirlætisvörur** — vistast í `localStorage` í vafranum þínum, fylgir
  ekki milli tækja
- **Dagatal** — veldu hvaða skráðan dag sem er til að skoða
- **VNV og matvælavísitala** — frá Hagstofunni, auk Krónu-eigin
  meðal-mánaðarbreytingar, í headernum
- **Um mig** — mjúk yfirlögn neðst í footer, ekki sér síða

## Athugasemdir / hlutir sem gætu þurft stillingu

- **Hraði:** API-ið leyfir 200 köll á 200 sekúndum. Kóðinn bíður ~1,1 sek
  milli kalla. Full-labbið getur tekið dágóða stund fyrstu keyrsluna og
  á sunnudögum — GitHub Actions leyfir allt að 6 klst. á ókeypis áætlun.
- **Verðskilgreining:** Notað er `price` (listaverð), óháð afsláttum/
  tilboðum. `discountedPrice` er tiltækt ef þú vilt skipta yfir síðar.
- Til að þvinga fram fullt labb á hvaða degi sem er: keyrðu með
  `FORCE_FULL_CRAWL=1`.
- **Push-árekstrar:** `daily.yml` reynir `git pull --rebase` og endurtekur
  push allt að 3 sinnum ef eitthvað annað (t.d. handvirk breyting) pushar
  á sama tíma.
- **GitHub PAT-heimildir:** fine-grained tóken sem er notað til að pusha
  þarf `Contents: Read & write`. Til að breyta `.github/workflows/`-skrám
  sjálfum þarf sér `workflow`-svið sem venjuleg fine-grained tóken hafa
  ekki sjálfgefið — þær breytingar þarf að gera beint á GitHub.
- **Gisin sögu-skráning (sparse encoding):** `data/history/<sku>.json`
  fær bara nýja línu þegar verðið raunverulega breytist, ekki einn dálk á
  dag — lesandinn á að túlka verðið sem óbreytt milli skráðra daga, alveg
  fram á síðasta þekkta dag. Þetta minnkaði fjölda lína í `data/history/`
  um ~90% (mælt beint: 104.028 → 9.662 línur á núverandi gagnasafni).
  Framendinn bætir sjálfkrafa við samsettum punkti fyrir nýjasta þekkta
  dag þegar teiknað er, svo línuritin líta ekki út fyrir að hafa stöðvast
  þó verðið hafi ekki breyst í nokkra daga — og notar þrepa-línu
  (step line) í stað beinnar skálínu milli punkta, svo hún gefi ekki
  ranglega í skyn stigvaxandi breytingu þar sem verðið í raun stökk
  skyndilega.
- **Repo-stærð yfir tíma:** `data/history/` er eitt skjal á vörunúmer
  (~9.500 skjöl) sem breytist í hverri keyrslu. Ekkert að hafa áhyggjur
  af strax, en vert að vita af til lengri tíma litið.
- **Mobile:** grunnskipulagið stiflast í einn dálk undir 860px og virkar,
  en er ekki sérstaklega fínstillt fyrir síma ennþá — leitin situr neðst
  á síðunni (því hún er hluti af hliðarstikunni sem kemur á eftir
  aðalefninu), og breiðari töflur (t.d. vikudagatöflan í Tölfræði) geta
  verið þröngar á mjóum skjá.

