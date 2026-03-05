PrintGuard
Správa skladu tiskového oddělení + audit spotřeby Canon Colorado
Offline-first PWA napsaná v čistém vanilla JS bez závislostí na frameworku. Funguje jako nainstalovaná aplikace na mobilu i desktopu, ukládá data lokálně do IndexedDB a volitelně synchronizuje s Neon PostgreSQL přes Netlify Functions.

Obsah

Co aplikace umí
Technologie
Struktura projektu
Datový model
Role a přístupová práva
Instalace a spuštění
Cloud sync (Neon DB)
Export a import dat
Konfigurace
PWA — instalace na zařízení


Co aplikace umí
Modul Sklad
FunkcePopisPřehled skladuKarty všech položek se stavem OK / Varování / Kritické, vyhledávání a filtrováníPohyb skladuZadání příjmu, výdeje nebo inventury s náhledem dopadu na stavUpozorněníAutomatický výpis položek s kritickým nebo varovným stavemSpráva položekPřidání, úprava a smazání položek katalogu (jen admin)Detail položkyMetriky, parametry, záložka Pohyby a záložka Stav skladu (history)Historie pohybůReportová tabulka všech pohybů ze všech položek s filtrací, date range a exportem CSVOdkaz na objednávkuKaždá položka může mít URL odkaz na e-shop (jen admin vidí)
Výpočet stavu skladu:

Baseline = poslední inventura
Příjmy přičítají, výdeje odečítají
Průměrná týdenní spotřeba = suma výdejů za posledních N týdnů ÷ N (N nastavitelné)
Stav crit: zásoby na ≤ 7 dní nebo pod min. množstvím
Stav warn: zásoby na ≤ dodací lhůta + bezpečnostní zásoba
Stav ok: vše ostatní

Modul Colorado
FunkcePopisDashboard spotřebyPrůměrná spotřeba inkoustu a média za den / měsíc pro obě tiskárny + kombinovaný přehledNový záznamZadání lifetime čítačů z displeje tiskárny s náhledem vypočítaného intervaluHistorieTabulka všech záznamů s delta hodnotami, L/m², volitelně Kč/m²; filtrování date range; export CSV
Průměry jsou klouzavé z posledních N intervalů (N nastavitelné). Čisticí cykly se záměrně promítají do reálné auditní spotřeby.

Technologie
VrstvaŘešeníFrontendVanilla JS (ES2020+), HTML5, CSS3 — žádný frameworkLokální úložištěIndexedDB (přes nativní API, bez wrapperu)OfflineService Worker (cache-first pro statické assety, network-only pro API)InstalacePWA — manifest.json, sw.jsBackend (volitelný)Netlify Functions → Neon PostgreSQLNasazeníNetlify (statický hosting)FontySpace Grotesk + DM Sans (Google Fonts)

Struktura projektu
/
├── index.html          # Celá aplikace — jeden HTML soubor, všechny screeny
├── app.js              # Veškerá logika (~1 850 řádků)
├── styles.css          # Styly — skandinávský minimalistický design
├── sw.js               # Service Worker — offline caching
├── manifest.json       # PWA manifest
├── netlify.toml        # Netlify konfigurace
├── package.json        # Závislosti (pouze pg pro Netlify Functions)
└── netlify/
    └── functions/
        └── sync.js     # Cloud sync endpoint (GET = pull, POST = push)

Datový model
IndexedDB — databáze printguard-db (verze 2)
Store items — katalog skladových položek
js{
  articleNumber: string,   // PRIMARY KEY, např. "GLOVES-NITRILE"
  name:          string,
  unit:          string,   // "box", "pcs", "roll", …
  category:      string,
  supplier:      string,
  MOQ:           number,   // minimální objednávací množství
  leadTimeDays:  number,   // dodací lhůta ve dnech
  safetyDays:    number,   // bezpečnostní zásoba ve dnech
  minQty:        number,   // kritická hranice množství (0 = auto výpočet)
  orderUrl:      string,   // URL odkaz na objednávku (volitelné)
  isActive:      boolean,
}
Store movements — pohyby skladu
js{
  id:            string,   // PRIMARY KEY, generováno (mov_xxx_yyy)
  articleNumber: string,   // FK → items
  movType:       'receipt' | 'issue' | 'stocktake',
  qty:           number,
  note:          string,   // volitelné
  timestamp:     string,   // ISO 8601
  deviceId:      string,
}
Store co_records — záznamy Colorado
js{
  id:              string,   // PRIMARY KEY, generováno (co_xxx_yyy)
  machineId:       'colorado1' | 'colorado2',
  timestamp:       string,   // ISO 8601
  inkTotalLiters:  number,   // lifetime čítač inkoustu (L)
  mediaTotalM2:    number,   // lifetime čítač média (m²)
  note:            string,   // volitelné
  createdAt:       string,   // ISO 8601
}
Store settings — synchronizované nastavení
js{
  key:       'config',   // PRIMARY KEY (vždy jeden záznam)
  weeksN:    number,     // počet týdnů pro průměr spotřeby
  rollingN:  number,     // počet intervalů pro klouzavý průměr Colorado
  inkCost:   number,     // náklad inkoustu (Kč/L)
  mediaCost: number,     // náklad média (Kč/m²)
  savedAt:   string,     // ISO 8601
}
localStorage — jen session data
KlíčObsahpg_device_idUnikátní ID zařízenípg_roleAktuální role (operator / admin)pg_admin_pinPIN admina (default: 2026)pg_weeks, pg_rolling, pg_ink_cost, pg_media_costFallback kopie nastavení

Poznámka: Nastavení se primárně synchronizuje přes IndexedDB store settings. localStorage slouží jen jako fallback pro případ, že IDB ještě není načtena.


Role a přístupová práva
Aplikace má dva režimy — Operátor (výchozí) a Admin.
FunkceOperátorAdminZadávání pohybů skladu✅✅Záznamy Colorado✅✅Přehled, upozornění, reports✅✅Export CSV✅✅Správa položek (přidat/upravit/smazat)❌✅Odkaz na objednávku 🛒❌✅Smazat pohyb skladu❌✅Smazat záznam Colorado❌✅Nastavení a import/export JSON✅✅
Odemknutí admin režimu

Otevřít Nastavení → sekce Admin access
Zadat PIN (výchozí: 2026)
Kliknout Unlock admin

PIN lze změnit přímou editací localStorage klíče pg_admin_pin, nebo doplněním UI pro změnu PINu.

⚠️ PIN je uložen v localStorage — pro produkční použití zvažte serverovou autentizaci.


Instalace a spuštění
Lokální vývoj (bez backendu)
bash# stačí statický HTTP server — žádný build krok není potřeba
npx serve .
# nebo
python3 -m http.server 8080
Aplikace funguje plně offline bez jakéhokoliv backendu. Cloud sync jednoduše selže s chybou — vše ostatní funguje.
Nasazení na Netlify

Forknout / naklonovat repozitář
Připojit k Netlify (Build command: prázdné, Publish directory: .)
Nastavit environment proměnnou DATABASE_URL (Neon PostgreSQL connection string)
Nasadit

toml# netlify.toml
[build]
  publish = "."
  functions = "netlify/functions"

Cloud sync (Neon DB)
Sync probíhá manuálně tlačítkem 🔄 v topbaru — žádný automatický cron.
Průběh sync
1. Načti lokální data (IndexedDB → S.*)
2. Validuj lokální data (chybějící ID, articleNumber)
3. POST /.netlify/functions/sync  →  push lokál do cloudu
4. GET  /.netlify/functions/sync  →  pull cloud zpět
5. Sanitizuj remote data (zahod záznamy bez required polí)
6. Přepiš lokální IDB validními remote daty
7. Reload UI

Cloud je source of truth. Po sync se lokální data přepíší cloudovými. Merge konfliktů není implementován — poslední sync vyhrává.

Netlify Function — netlify/functions/sync.js
MetodaPopisGETVrátí všechna data z Neon DB jako JSONPOSTUpsertuje přijatá data do Neon DB, vrátí počty
Payload (POST body a GET response):
json{
  "items":     [...],
  "movements": [...],
  "coRecords": [...],
  "settings":  [{ "key": "config", "weeksN": 8, ... }]
}

Export a import dat
Exporty CSV (Nastavení → Export CSV)
SouborObsahpohyby_skladu_*.csvVšechny pohyby skladu s průběžným stavem po každém pohybustock_levels_*.csvAktuální stav skladu všech položek (snapshot)co_intervals_*.csvVypočítané intervaly spotřeby Colorado (pro finance)co_raw_*.csvSurové záznamy Colorado
Všechny CSV soubory jsou kódované v UTF-8 s BOM (kompatibilní s Excel), oddělovač čárka, správný CSV escaping.
Z obrazovky Historie pohybů lze exportovat aktuálně vyfiltrovaná data (respektuje date range a fulltext filtr).
JSON záloha
Export — stáhne kompletní zálohu všech dat ve formátu JSON.
Import — nahraje JSON zálohu. Kompatibilní se starým formátem StockGuard — snapshots se automaticky převedou jako inventurní záznamy.

⚠️ Import přepíše všechna lokální data. Před importem doporučujeme udělat export zálohy.


Konfigurace
Nastavení jsou dostupná v záložce Nastavení a synchronizují se přes cloud sync.
ParametrVýchozíPopisPočet týdnů pro průměr (N)8Okno pro výpočet průměrné týdenní spotřeby skladuPočet intervalů Colorado (N)8Klouzavý průměr z posledních N intervalůNáklad inkoustu (Kč/L)0Po vyplnění se zobrazí finanční metriky v ColoradoNáklad média (Kč/m²)0Po vyplnění se zobrazí finanční metriky v Colorado

PWA — instalace na zařízení
Aplikace splňuje kritéria PWA a lze ji nainstalovat jako nativní app.
Android (Chrome): Banner „Přidat na plochu" se zobrazí automaticky, nebo přes menu → Nainstalovat aplikaci
iOS (Safari): Sdílet → Přidat na plochu
Desktop (Chrome/Edge): Ikona instalace v adresním řádku
Po instalaci aplikace funguje plně offline — Service Worker cachuje všechny statické assety při první návštěvě.
PWA shortcuts (rychlý přístup)
ZkratkaURLNový pohyb skladu/?screen=stock-movementColorado záznam/?mode=colorado&screen=co-entry

Verze
printguard-2.0.0 — IndexedDB schema verze 2
