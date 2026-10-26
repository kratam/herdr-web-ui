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
- [x] Célzott tesztek, typecheck/build, izolált böngészős próba és friss független review elkészült. A helyi teljes fast-kör hibás; a hosted fast és integráció zöld, a teljes böngészős kapu még folyamatban.
- [x] Saját fork PR: https://github.com/kratam/herdr-web-ui/pull/1, a `local/main-gg` ágra.
- [ ] Merge/telepítés a zöld CI és tiszta review után a meglévő felhatalmazással; a felhasználói közös folyamatokat nem állítjuk le.

## Megkülönböztetett mellékszál

A telefonos agent-prep hiba külön diagnózis/javítás. 2026-10-26: Tamás két pontos requestKey-je a claim/heartbeat nélkül lejárt legacy `prep-list` parancsokra mutatott; a jelenlegi `autoagent_intake` healthy. A tool és a dokumentáció a mai olvasóhoz irányít: GuestGuru/gg-mcp PR276 merged és élesítve; 2060 teszt, CI, független review és friss éles olvasás igazolja. A legacy executor nem indult újra, a telefonos UI újrapróbáját nem állítjuk.

## Ellenőrzési állapot

2026-10-26: a döntési/usage/server-convention célzott kör 104/104, az agentnév-regresszió 8/8; typecheck és build zöld. Az új döntési és a meglévő áttekintő böngészős regresszió izolált desktop/mobil környezetben zöld. Valódi emberi választ nem írtak, valódi agentet nem indítottak.

A független review megállapításai javítva és visszaellenőrizve: hiányzó nyugta utáni helyreállítás, igazolt agentindítás utáni átmeneti olvasóhiba, teljes műveleti részletek és a tényleges indítási profilhoz tartozó kvóta kiválasztása. A teljes branch utolsó tiszta review-ja a 6761617a headre szólt; az azóta talált tabhúzási javítás külön visszaellenőrzést kap.

A pusholt 960fab0e head hosted fast-köre 7258 pass / 0 fail / 14 skip (499 fájl); integráció és Windows zöld. A browser-main és browser-other több korábbi GG-integrációs eltérést tárt fel: az Áttekintés külön navigációs lépés, a kiválasztott háttér-pane nem mindig a látható pane, a natív tabok száma/sorrendje külön kezelendő, a host-load a kvóták mellett helyet foglal. A próbák az aktuális működést ellenőrzik, az eredeti fókusz-, input-, bezárási és mobilkövetelmények megmaradnak. A preferenciák próbája az újratöltés előtt megvárja a tényleges mentést, a telefon pedig felületen kapcsolja vissza a közös beállítást.

A tabhúzási regresszió valódi runtime-hibát is igazolt: a rögzített Áttekintés téglalapja eltolta a natív beszúrási indexet. A runtime most kizárólag a rendezhető natív tabok helyét számolja. A próba előbb bukott, a javítás után zöld; az Áttekintés első helyét külön ellenőrzi. A javított célzott UI-, konvenciós és tabsorrend-tesztek zöldek; a nagy böngészős kapu újrafutása folyamatban.

A helyi teljes fast-kör legutóbb 7118 pass / 14 fail / 140 skip; ezt nem állítjuk zöldnek, és valamennyi hibát sem igazolt baseline-nak. A macOS hosted jobot egy runner sem vette fel (kapacitáshiány), nem teszt futása közben bukott. Merge csak az új head kötelező hosted checkjei és tiszta független review után következhet.

A saját fork CI_SELF_HOSTED_LABELS változója Tamás külön engedélyével a JSON-string "ubuntu-24.04"; nincs helyi CI/VM-módosítás. A helyi updater ugyancsak külön engedéllyel a meglévő `check run` futtatón át indítja a böngészőpróbákat, izolált sessionnel és takarítással. A még futó alkalmazás verziója változatlan.
