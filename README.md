# Kronan Price Tracker

Safnar daglega verði á flestum vörunúmerum hjá Krónunni (með því að labba
í gegnum kategoríutréð) og reiknar út mestu %-hækkanir og lækkanir dagsins.
Keyrir sjálfvirkt á hverjum degi með GitHub Actions og birtir niðurstöðuna
á einfaldri kassakvittunar-síðu.

Athugið: Kronan API-ið sjálft geymir enga verðsögu — það sýnir bara
núverandi verð. Þetta verkefni býr því til sína eigin sögu með því að
vista daglegar "verðmyndir" (snapshots) og bera þær saman.

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
saman við.

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

Restin:

1. `src/index.js` — velur aðferð, vistar niðurstöðuna sem
   `data/snapshots/YYYY-MM-DD.json`.
2. `src/computeMovers.js` — ber saman í dag og gær, reiknar
   `% breyting = (verð_í_dag − verð_í_gær) / verð_í_gær`, tekur topp 3
   hækkanir og topp 3 lækkanir, og vistar í `data/movers/YYYY-MM-DD.json`
   (og uppfærir `data/movers/latest.json` + `data/movers/index.json`).
3. `index.html` — les þessi JSON-skjöl beint (engin bygging/build-skref
   nauðsynleg) og sýnir niðurstöðuna.
4. `src/buildIndex.js` — skrifar `data/products-index.json`, létt skrá
   (bara sku/nafn/vörumerki/flokkur, engin verð) sem framendinn notar
   fyrir leitina.
5. `src/updateHistory.js` — bætir daginn við `data/history/<sku>.json`
   fyrir hverja vöru (þjappað snið: `[dagsetning, verð, verð_á_kg]`), og
   heldur `data/volatility-stats.json` — hlaupandi teljara á því hversu
   oft verð hverrar vöru breytist, notað fyrir "óstöðugustu vörur".

## Eiginleikar í mælaborðinu

- **Leit** — sláðu inn nafn/vörunúmer/vörumerki, niðurstöður birtast
  jafnóðum (notar `products-index.json`).
- **Verðferill vöru** — smelltu á hvaða vöru sem er (í topp-listunum eða
  leitinni) til að sjá lítið línurit af verði hennar yfir tíma, ásamt
  "lægsta/hæsta verð sem sést hefur" merkjum.
- **Eftirlætisvörur** — stjörnu-takki í vöruglugganum bætir vöru í
  "Mínar vörur" neðst á síðunni. Vistast í `localStorage` **í vafranum
  þínum** — fylgir ekki milli tækja/vafra, og er ekki geymt í repo-inu.
- **Kg-verð fyrir vigtarvörur** — vörur með `chargedByWeight: true`
  (ávextir, kjöt í lausu o.þ.h.) eru undanskildar aðal-topplistunum og fá
  sinn eigin samanburð byggðan á `pricePerKilo`, svo pakkningastærð rugli
  ekki saman við raunverulega verðbreytingu.
- **Óstöðugustu vörurnar** — vörur sem skipta oftast um verð miðað við
  fjölda daga sem fylgst hefur verið með þeim. Þarf a.m.k. 3 daga og 2
  breytingar til að birtast — kemur smám saman í ljós.

## Athugasemdir / hlutir sem gætu þurft stillingu

- **Hraði:** API-ið leyfir 200 köll á 200 sekúndum. Kóðinn bíður ~1,1 sek
  milli kalla til að vera örugglega undir því. Full-labbið getur tekið
  dágóða stund fyrstu keyrsluna og á sunnudögum — GitHub Actions leyfir
  allt að 6 klst. keyrslutíma á ókeypis áætlun, svo það ætti að vera nóg
  svigrúm. Hraðuppfærslu-dagarnir (mán–lau) eru mun fljótari: 100 SKU á
  kalli þýðir t.d. ~50 köll fyrir 5.000 vörunúmer.
- **Verðskilgreining:** Notað er `price` (listaverð), óháð afsláttum/
  tilboðum — þú baðst sérstaklega um það. Ef þú vilt síðar skipta yfir í
  raunverð sem viðskiptavinur borgar, er það `discountedPrice` þegar
  `onSale` er `true` — það er ein lína að breyta í `computeMovers.js`.
- Til að þvinga fram fullt labb á hvaða degi sem er: keyrðu með
  `FORCE_FULL_CRAWL=1` (t.d. í handvirkri Actions-keyrslu).
- **Repo-stærð yfir tíma:** `data/history/` er eitt skjal á vörunúmer
  (~9.500 skjöl), og **hvert þeirra breytist í hverri keyrslu** (nýr
  dagur bætist við). Það þýðir að daglega commit-ið snertir öll þessi
  skjöl — git höndlar það vel til að byrja með (þjappar vel), en ef þetta
  keyrir í mörg ár getur repo-ið orðið töluvert stórt. Ekkert að hafa
  áhyggjur af strax, en vert að vita af.
