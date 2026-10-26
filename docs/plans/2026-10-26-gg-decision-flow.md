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
- Nincs core-foglalás, CI/VM-átállítás, közös szerverleállítás vagy idegen session kezelése.

## Review Focus

1. Régi döntés/terv vagy időközben megváltozott PR: a canonical API elutasít, a bevitt válasz megmarad.
2. Megérkezett, de félreérthető válasz: a kérdés nem tűnik el; az átbeszélés elérhető.
3. Két böngésző párhuzamos tabnyitása: egyetlen létrehozás, nincs másolat.
4. Újraindult Ovis és lecserélt agent: a tárolt pane/session kötést újra ellenőrzi, idegen agentnek nem ír.
5. Watch/bridge hozzáférés és hálózati szakadás: nincs írás, automatikus újraküldés vagy üres lista sikerként.

## Task 1: Canonical decision reading and replies

**Files:** `shared/gg-decisions.ts`, `server/gg-mcp.ts`, `server/gg-decisions.ts`, `server/gg-decisions.test.ts`, `server/gg-overview-reader.py`, `server/gg-overview.ts`.

**Interfaces:** `GgDecisionService.detail(id, story) -> GgDecisionDetail`; `reply(input) -> GgDecisionReceipt`; `callGgTool(name, args) -> data`. A binding a friss döntésből származó epoch/revízió/PR/terv-halmaz.

- [ ] A célzott teszt előbb bukjon a hiányzó részletek/írás miatt: nyers szöveg megőrzése, binding, ambiguous, hibás nyugta, lejárt terv, több oldal.
- [ ] MCP SDK-val rövid életű, biztosan lezárt proxykapcsolat; csak a rögzített olvasó és session_reply műveletek.
- [ ] Döntés UUID továbbadása az áttekintőben; mentés után a közös feed érvénytelenítése.
- [ ] `HERDR_TEST_MODE=unit bun test ./server/gg-decisions.test.ts ./server/gg-overview.test.ts` → zöld.

## Task 2: One reusable decision conversation

**Files:** `server/gg-discussion.ts`, `server/gg-discussion.test.ts`, `server/index.ts`.

**Interfaces:** `GgDiscussionService.open(detail, connection) -> {pane_id, agent_started, queued, error?}`; a route a Task 1 friss részletét adja át. A meglévő `queueFirstMessage` végzi a továbbítást.

- [ ] Előbb teszt: párhuzamos nyitás, újrahasználat, zárt/lecserélt pane, indítási/üzenetsor-hiba; izolált stateDir, fake külső Herdr-határ.
- [ ] A saját pane/PID/agentkötés atomikus nyugtája; részleges indításnál látható eredmény, vak új tab nélkül.
- [ ] Első indításkor friss heti keret alapján normál modell; meglévő beszélgetésnél nincs modellváltás.
- [ ] `HERDR_TEST_MODE=unit bun test ./server/gg-discussion.test.ts` → zöld.

## Task 3: Overview interaction and delivery

**Files:** `src/components/GgDecisions.tsx`, `src/components/GgOverview.tsx`, `src/components/GgOverview.css`, `src/lib/ggDecisions.ts`, `src/lib/ggOverviewFeed.ts`, `scripts/gg-decisions-regression.ts`, `docs/gg-overview.md`.

**Interfaces:** Task 1 részlet/nyugta és Task 2 pane-nyugta; meglévő `onAgentPane` és Ovis-navigáció.

- [ ] Interakciós próba előbb: helyben válasz → nyugta → lista frissül; ambiguous/hiba → válasz megmarad; beszélgetés → ugyanaz a pane.
- [ ] Globálisan és workspace-ben elöl az autonóm döntések, alattuk a meglévő munkák/állapot. Rövid kérdés, javaslat, kockázat; a valódi terv és PR-kötés elolvasható.
- [ ] Az alkalmazás meglévő agentbeszélgetését nyitjuk meg; saját chatmotor vagy automatikus modellezés nincs.
- [ ] Célzott tesztek, typecheck/build, izolált böngészős próba, `bun run check fast`, friss független review.
- [ ] Saját fork PR a `local/main-gg` ágra. Merge/telepítés csak a meglévő felhatalmazás tényleges feltételeivel; a felhasználói közös folyamatokat nem állítjuk le.

## Megkülönböztetett mellékszál

A telefonos agent-prep hiba külön diagnózis/javítás. 2026-10-26: a régi `autoagent_prep_list` próbakérés queued/stale claim; a jelenlegi `autoagent_intake` healthy. Tamás pontos hibaszövegét kértük, még nem érkezett meg. Ez önmagában nem bizonyítja a telefonos hiba okát.
