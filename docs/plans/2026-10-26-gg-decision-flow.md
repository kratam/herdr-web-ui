# GG decision flow implementation plan

> For agentic workers: execute inline with `superpowers:executing-plans`; one independent review covers the completed branch.

**Goal:** Az autonóm sor döntéseire az Áttekintésen lehessen válaszolni, vagy ugyanabban az egy agentes beszélgetésben lehessen pontosítani.

**Architecture:** A meglévő áttekintő olvasó adja a rövid listát. Megnyitáskor a hitelesített GG MCP adja a teljes döntést; a válasz a meglévő `session_reply` műveletre megy. Az átbeszélés saját, nyugtával azonosított Herdr-tabot használ, a meglévő Ovis indító- és üzenetsorával.

**Tech Stack:** React, TypeScript, Bun, hivatalos MCP SDK; meglévő Herdr és GG MCP.

**Spec:** Tamás ebben a beszélgetésben elfogadott drótváza: `.ovis/decision-flow-trial/decision-flow.html` a gg-agent-skills fő checkoutjában; jóváhagyás: „Igen, csináljuk.”

## Global Constraints

- A két út ugyanazt a core-döntést kezeli; nincs külön döntés-DB, SQL-írás vagy Linear-komment.
- Interaktív koordinátorok kérdései a saját beszélgetésükben maradnak.
- A teljes nyers válasz megmarad; a backend ellenőrzi az epochot, revíziót, PR-headet és terveket.
- Bizonytalan mentést/indítást nem ismétlünk automatikusan. A visszaküldött nyugta kötése ellenőrzött.
- Egy közös döntési tab, kattintásra indítva, meglévőnél újrahasználva. A meglévő modell nem vált magától.
- A prototípus tesztmentes volt; a valódi írás és indítás most célzott viselkedés-ellenőrzést kap.
- Nincs core-foglalás, helyi CI/VM-átállítás, közös szerverleállítás vagy idegen session kezelése. Tamás külön jóváhagyásával a saját fork Linux CI-jének repóváltozója GitHub-hosted ubuntu-24.04-re irányít.

## Review Focus

1. Régi döntés/terv vagy időközben megváltozott PR: a canonical API elutasít, a bevitt válasz megmarad.
2. Megérkezett, de félreérthető válasz: a kérdés nem tűnik el; az átbeszélés elérhető.
3. Két böngésző párhuzamos tabnyitása: egyetlen létrehozás, nincs másolat.
4. Újraindult Ovis és lecserélt agent: a tárolt pane/session kötést újra ellenőrzi, idegen agentnek nem ír.
5. Watch/bridge hozzáférés és hálózati szakadás: nincs írás, automatikus újraküldés vagy üres lista sikerként.

## Task 1: Canonical decision reading and replies

**Files:** `shared/gg-decisions.ts`, `server/gg-mcp.ts`, `server/gg-decisions.ts`, `server/gg-decisions.test.ts`, `server/gg-overview-reader.py`, `server/gg-overview.ts`.

**Interfaces:** `GgDecisionService.detail(id, story) -> GgDecisionDetail`; `reply(input) -> GgDecisionReceipt`; `callGgTool(name, args) -> data`. A binding a friss döntésből származó epoch/revízió/PR/terv-halmaz.

- [x] A célzott teszt előbb bukjon a hiányzó részletek/írás miatt: nyers szöveg megőrzése, binding, ambiguous, hibás nyugta, lejárt terv, több oldal.
- [x] MCP SDK-val rövid életű, biztosan lezárt proxykapcsolat; csak a rögzített olvasó és session_reply műveletek.
- [x] Döntés UUID továbbadása az áttekintőben; mentés után a közös feed érvénytelenítése.
- [x] `HERDR_TEST_MODE=unit bun test ./server/gg-decisions.test.ts ./server/gg-overview.test.ts` → zöld.

## Task 2: One reusable decision conversation

**Files:** `server/gg-discussion.ts`, `server/gg-discussion.test.ts`, `server/index.ts`.

**Interfaces:** `GgDiscussionService.open(detail, connection) -> {pane_id, agent_started, queued, error?}`; a route a Task 1 friss részletét adja át. A meglévő `queueFirstMessage` végzi a továbbítást.

- [x] Előbb teszt: párhuzamos nyitás, újrahasználat, zárt/lecserélt pane, indítási/üzenetsor-hiba; izolált stateDir, fake külső Herdr-határ.
- [x] A saját pane/PID/agentkötés atomikus nyugtája; részleges indításnál látható eredmény, vak új tab nélkül.
- [x] Első indításkor friss heti keret alapján normál modell; meglévő beszélgetésnél nincs modellváltás.
- [x] `HERDR_TEST_MODE=unit bun test ./server/gg-discussion.test.ts` → zöld.

## Task 3: Overview interaction and delivery

**Files:** `src/components/GgDecisions.tsx`, `src/components/GgOverview.tsx`, `src/components/GgOverview.css`, `src/lib/ggDecisions.ts`, `src/lib/ggOverviewFeed.ts`, `scripts/gg-decisions-regression.ts`, `docs/gg-overview.md`.

**Interfaces:** Task 1 részlet/nyugta és Task 2 pane-nyugta; meglévő `onAgentPane` és Ovis-navigáció.

- [x] Interakciós próba előbb: helyben válasz → nyugta → lista frissül; ambiguous/hiba → válasz megmarad; beszélgetés → ugyanaz a pane.
- [x] Globálisan és workspace-ben elöl az autonóm döntések, alattuk a meglévő munkák/állapot. Rövid kérdés, javaslat, kockázat; a valódi terv és PR-kötés elolvasható.
- [x] Az alkalmazás meglévő agentbeszélgetését nyitjuk meg; saját chatmotor vagy automatikus modellezés nincs.
- [x] Célzott tesztek, typecheck/build, izolált böngészős próba és friss független review elkészült. A korábbi helyi teljes fast-kör hibás; a hosted teljes kör az alább leírt platformfüggő teszt miatt bukott. A javítás visszaellenőrzése és a teljes CI kapu még folyamatban.
- [x] Saját fork PR: https://github.com/kratam/herdr-web-ui/pull/1, a `local/main-gg` ágra.
- [ ] Merge/telepítés a zöld CI és tiszta review után a meglévő felhatalmazással; a felhasználói közös folyamatokat nem állítjuk le.

## Megkülönböztetett mellékszál

A telefonos agent-prep hiba külön diagnózis/javítás. 2026-10-26: Tamás két pontos requestKey-je a claim/heartbeat nélkül lejárt legacy `prep-list` parancsokra mutatott; a jelenlegi `autoagent_intake` healthy. A tool és a dokumentáció a mai olvasóhoz irányít: GuestGuru/gg-mcp PR276 merged és élesítve; 2060 teszt, CI, független review és friss éles olvasás igazolja. A legacy executor nem indult újra, a telefonos UI újrapróbáját nem állítjuk.

## Ellenőrzési állapot

2026-10-26: 37 célzott unit teszt zöld; typecheck és build zöld. A döntési és a
meglévő áttekintő böngészős regresszió izolált Herdr-sessionön zöld. Valódi emberi
választ nem írtak, valódi agentet nem indítottak.

A teljes `bun run check fast` lefutott, de a 7265 tesztes unit-kör 18 hibás teszttel
és 2 külön hibával állt meg. Vannak macOS-parancseltérések, meglévő böngészős
lane-regisztrációs hibák és időtúllépések; a teljes csomagot nem állítjuk zöldnek,
és valamennyi hibát sem minősítjük igazolt baseline-nak. A saját döntési tesztek
a teljes körben is átmentek. A kezdeti Actions workflow-listázás üres volt, de a PR megnyitásakor a célág workflow-i elindultak. A CI állapotát a PR tényleges checkjei igazolják; a kezdeti listából nem következett a CI hiánya.

A független review négy P2-t jelzett: hiányzó mapping után újrapróbálás, igazolt
agentindítás után átmeneti olvasóhiba, hiányzó műveleti részletek és több fióknál
félreérthető keretválasztás. Mindegyik kapott célzott javítást és ellenőrzést.

A helyi frissítő fájlonként is futtatja a módosult unit teszteket. Emiatt a
böngésző-lane macOS-en hibás GNU `date -Is` hívása hordozható UTC-formátumra
váltott; a meglévő helyi GG-böngészőpróbák felkerültek a manual listára, ahol
az új próba is szerepel. Nem változott workflow, runner, párhuzamosság vagy
böngészős futtatási lista. A meglévő hét lane-teszt az eredeti öt hibából zöldre
váltott; a script-konvenciók is zöldek.

A GitHub-hosted Linux unit-kör 7257 sikeres, 1 hibás és 14 kihagyott teszttel futott le. A `local 0.4.8 object bindings` meglévő tesztje a futtató gép platformjára hagyatkozott, de nem-Macen is macOS Meta-kombinációkat várt. Az azonos fájl az alapágban is szerepelt; Linux platformmal helyben ugyanaz a hiba reprodukálható. A teszt most külön, explicit macOS és nem-macOS bemenettel ellenőrzi a bindolható kombinációk megőrzését és a nem támogatottak elhagyását. A működő kód nem változott; mindkét futtatási platformon 32/32 célzott teszt zöld.
