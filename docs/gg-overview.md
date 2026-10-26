# Saját GG-áttekintő az Ovisban

A `local/main-gg` kiegészítés két helyi nézetet ad:

- A **Globális áttekintés** elején az autonóm sor döntései vannak. A futó sessionök
  és workspace-ek lenyitható összesítést kapnak; a tartós munkák külön listában látszanak.
- A **workspace első Áttekintés tabja** döntéseket, munkákat és hibákat mutat.
  Virtuális Ovis-tab: nem Herdr-terminál, nem húzható át és nem zárható be.
  A normál tabok helye és a meglévő limitkijelzés megmarad.

A workspace neve a saját helyére visz az oldalsávban. Bezárt workspace-nél az Ovis
meglévő workspace-létrehozása nyit egy shell-tabot a már konfigurált fő checkoutban;
coding agent nem indul. Hiányzó könyvtárkötés vagy bizonytalan létrehozási eredmény
látható hiba, nem kitalált könyvtár vagy automatikus újrapróbálkozás.

## Válaszadás és átbeszélés

A **Válaszolok** a kiválasztott story pontos döntését frissen olvassa a kanonikus
`autoagent_decisions` MCP-toollal. A javaslat, kockázat, PR-head és a terv lejárata
ellenőrizhető, az érintett rendszerrel/környezettel, használati és költségkorláttal
együtt. A teljes művelet, paraméterek és előfeltételek is kibontva olvashatók.
A választ a **Válasz rögzítése** menti a meglévő `session_reply`
művelettel; a teljes nyers szöveg megmarad. A típusos feldolgozást, tulajdonost,
epochot, forrásrevíziót, PR-headet és tervkötést a kanonikus rendszer ellenőrzi.
Nincs közvetlen DB-írás vagy válaszként létrehozott Linear-komment.

Csak a válaszhoz kötött nyugta után jelzünk sikert. Félreérthető válasznál a
kérdés nyitva marad; hibánál a beírt szöveg megmarad. Nincs automatikus küldési
újrapróbálás. Változatlan szöveg és döntéskötés kézi újraküldése ugyanazt az
idempotens kérést ellenőrzi. Mentés után a közös áttekintő cache érvénytelenedik.

A **Beszéljük át** ugyanazt a **Döntések átbeszélése** Herdr-tabot használja, a
`gg-agent-skills` konfigurált fő checkoutjában. Első kattintásra friss, ismert heti
kerettel rendelkező normál agent indul; a meglévő beszélgetés nem vált modellt.
A választás csak az indítandó CLI konfigurált profiljának mérését használja,
nem a kijelzőn megjelenő többi fiókét. Ugyanazt a nem titkos profilútvonalat
adja át az új tab környezetében; globális konfigurációt nem módosít. Hiányzó
vagy nem mért elsődleges profil helyett egy tartalék fiók kerete nem használható.
A kontextust az Ovis meglévő, a böngésző és a futó session azonosságához kötött
üzenetsora adja át. A tényleges emberi választ az agent-decisions skill kezeli.
Interaktív koordinátorok saját kérdései továbbra is a saját beszélgetésükben maradnak.

A privát `gg-discussion.json` csak a saját tab/terminál/PID/session kötését és a
kontextusátadás nyugtáját tartja, nem másolatot a döntésekről. Egyidejű kattintások
egyetlen indítást végeznek. Lezárt pane után új tab nyílhat; lecserélt sessionnek
nem küldünk üzenetet. Bizonytalan indításnál/átadásnál a meglévő tab ellenőrzése kell.
Az Ovis memóriabeli üzenetsora újraindításkor elveszhet: a régi elfogadott átadást
ilyenkor nem állítjuk bizonyított kézbesítésnek, és nem ismételjük automatikusan.

Új útvonalak: `GET /api/gg/decisions/:id?story=IT-N`, `POST .../:id/reply`,
`POST .../:id/discuss`. A meglévő interaktív helyi hozzáférés és same-origin kapu
mögött vannak; watch/bridge hozzáférésből egyik sem használható. A rövid életű
MCP-kapcsolat az autentikált `gg-mcp-proxy` identitását használja és mindig lezárul.
Nincs új periodikus lekérdezés vagy daemon.

## Áttekintő olvasó

`GET /api/gg/overview`: a meglévő Ovis-hitelesítés mögött, csak interaktív helyi
hozzáférésből. Watch és bridge nem kap GG-adatot. A GG-kiegészítés magyar nyelvű,
az upstream általános felületét nem fordítja át és upstream PR-ra nem készül.

A `server/gg-overview-reader.py` a telepített közös `CoreStore.tasks()` adapterrel
és az aktív csomagok függő kérdéseinek fix lekérdezésével olvas. Read-only,
repeatable-read tranzakció, statement-timeout, proxyzott meglévő runner-hitelesítő;
új kulcs, env-beállítás, DB-séma vagy ütemező nincs. A backend egyidejű kérései
közös olvasást használnak, legfeljebb percenként. A kliens félpercenként kérdez,
csak a nézet megnyitásakor és látható böngészőlapon.

A helyi célmapping forrása a meglévő `~/.config/auto-agent/herdr-worker.json`.
Csak a repository, label és main_checkout mező olvasható belőle. A nyitott
workspace a checkout-/repository-út alapján illeszkedik, gépazonosítóval együtt;
címke, pane-ID vagy hasonló könyvtárnév önmagában nem bizonyít összetartozást.
A külön worktree-ben induló pane-ekhez az Ovis `git rev-parse --git-common-dir`
méréssel oldja fel a fő checkoutot, korlátos párhuzamossággal és időkerettel.
Ha a Herdr nem elérhető, ez a kiegészítő összerendelés kimarad; a tartós core-adat
ettől még betöltődik.

A tartós task és az élő agent külön számlálódik, ugyanazt a munkát is jelentheti.
Közvetlen sessionből az Ovis által észlelt interaktív kérdések és restore-hibák
látszanak; a csak beszélgetésben maradt döntések lefedettsége nem teljes.
A normál hibaállapotú core-task hibaként jelenik meg; ismeretlen agentstátuszból
nem következtetünk hibára vagy elkészülésre. Másik gépről csak az Ovis-roster látszik.
Az aktív csomag lezárt taskján maradt pending döntés is látszik, lezárt feladatként
megjelölve. A javaslat jsonb objektumából a címke és az indoklás jelenik meg.

Forráshiba esetén a legutóbbi adat megmarad hibajelzéssel. A lekérdezés időpontja
a forrás elérhetőségének mérési ideje, nem OS-folyamatélőség. Nyers brief,
checkpoint, grant, token és a gyermekfolyamat stderrje nem kerül a böngészőbe.

## Ellenőrzés

```sh
HERDR_TEST_MODE=unit bun test ./server/gg-overview.test.ts ./src/lib/ggOverview.test.ts
bun run typecheck
bun run build
HERDR_TEST_SESSION=ovis-gg-overview-mvp bun scripts/gg-overview-regression.ts
HERDR_TEST_MODE=unit bun test ./server/gg-decisions.test.ts ./server/gg-discussion.test.ts ./server/gg-decision-routes.test.ts
bun run check run bun scripts/gg-decisions-regression.ts
```

A böngészős próba saját Herdr-sessionön és saját state-könyvtárral, fixture-adatokon
fut. Ellenőrzi a workspace-megnyitást, a rögzített első tabot, a natív tabváltást,
a jsonb döntési javaslatot, az első sikertelen betöltést és a későbbi forráshibát,
a kis képernyős visszanavigációt, a paletta-gyorsbillentyűt és az inaktív split-fél
Áttekintés tabjáról visszatéréskor mindkét eredeti pane megőrzését.

## Helyi integráció

A módosítás a `local/main-gg` commitlánc részeként vihető tovább. A meglévő helyi
frissítő ezen az ágon rebase-el az upstreamre és készít ellenőrzött, visszaállítható
release-t. A `local/main-gg` ágat nem szabad worktree-ben kicsekkolva hagyni.
A fejlesztés saját feature-worktree-ben történik; a futó Ovis átállítása külön
ellenőrzött lépés. Az upstream infrastruktúratesztek sikertelenségét nem rejtjük el.

Az elrendezés az Ovis meglévő workspace-/tab-navigációját követi a felhasználó
kifejezett kérése szerint; külső alkalmazás pixelmintája vagy kódja nem került át.


## Gyors visszatérés és issue-tabok

A böngésző az áttekintő legutóbbi adatát az alkalmazás memóriájában tartja;
a globális és az egyes workspace-nézetek ugyanazt a gyorsítótárat használják. A tab
elhagyásakor nem dobja el a folyamatban lévő olvasást. Visszatéréskor az adat azonnal
látszik; 30 másodpercnél régebbi olvasásnál a frissítés háttérben indul, a kézi
Frissítés ezt megkerüli. A forrás ideje és hibája továbbra is látszik. Kijelentkezéskor
az adat és a függő kérés törlődik; böngészőtárba nem írunk tartós core-adatot.

A munkasorok státusza az Ovis szemantikus színeit használó, szöveges chip. A globális
sidebar-elem külön ikont, megfelelő behúzást és aktív állapotot kapott. A navigáció
és a piszkozat különválasztásánál a T3 Code sidebarját is megvizsgáltuk:
https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.tsx .
Kódot nem vettünk át.

A Codex/Claude gomb a feladat URL-jét először vágólapra másolja, majd a meglévő
workspace-ben új agenttabot nyit. A könyvtárat a natív workspace-ből örökli, így
linked worktree esetén is ott marad. Csak elérhető, telepített agenthez aktív.
Másolási hiba esetén nem nyit tabot; bizonytalan tabnyitásnál nem próbálkozik
automatikusan újra. Nincs promptargumentum, első üzenet, draft-írás vagy submit:
a felhasználó illeszti be a linket és írja hozzá az utasítását.

A sidebar workspace-váltása az utoljára látott tabot hozza vissza, beleértve az
Áttekintést is; a globális lista linkje mindig az Áttekintést nyitja meg. Az előző/
következő pane gyorsbillentyű a meglévő sorrendben a virtuális első tabokat is
érinti. Watch módban a korábbi natív navigáció marad.

## Hostload és személyes munkalista

A sidebar alján a meglévő előfizetéses mérők fölött látható a gépek terhelése:
**1 perces load / logikai CPU** (nem CPU-százalék). A részletekben az 5/15 perces
átlag és a mérés ideje. Percenként, csak látható lapon frissül; a szerver gépenként
összevonja a kéréseket. Távolról a meglévő hitelesített SSH-mesteren fix olvasóparancs
fut. Nincs új bridge-bundle vagy SSH-belépési párbeszéd. Hibás/régi mérés nem nulla;
Windows load jelenleg nem mérhető.

A globális összesítés alatt és a workspace munkáinál ugyanaz a prioritásválasztó,
nézet- és rendezésvezérlő jelenik meg. A prioritás a kanonikus **Linear-storyé**,
minden hozzá tartozó technikai task osztozik rajta. A 0 külön „Besorolandó”.
A Linear-írás kiválasztás utáni külön Mentés/megerősítés gombbal történik a meglévő proxyzott
felhasználói tokennel; friss Linear-prioritás ellenőrzése előzi meg. Ütközéskor
nem írunk felül, bizonytalan eredménykor nincs automatikus újrapróbálás.
A Linear nem ad feltételes `issueUpdate`-et: az előzetes olvasás és az írás közti
külső szerkesztési versenyt nem lehet tranzakcióként kizárni. Az Ovis a saját,
egy storyhoz tartozó párhuzamos írásokat tiltja.

A **Későbbre** választó a tervezett munka személyes átnézését halasztja 1/2 nappal,
1/2 héttel, 30 nappal vagy egyéni időpontig. A döntések és hibák mindig megmaradnak,
a futtatási sor nem változik; ez nem `not_before`, `later`, `parking` vagy due date.
A „Későbbre tett” és „Összes” nézetből bármikor visszahozható. Lejáratkor a prioritás
szerinti helyére kerül. A szerver stateDir mappájának privát `gg-attention.json`
fájlja tárolja story szerint, atomikus írással; a szerver minden böngészője megosztja.
Sérült fájlt nem írunk felül. A sikeresen mentett Linear-érték jelölt áthidaló
adatként megmarad, amíg a core-tükör utoléri.

A 2026-10-24-i, csak olvasó felmérés 270 tervezett Linear-storyból 155-ben talált
prioritást, 115-ben nem. 37 tervezett storynál az aktuális értékhez lokális agentírás
köthető, a közvetlenül előtte látott emberi mondatban prioritási jelzés nélkül.
Ez **felülvizsgálati jelölt, nem bizonyított jogosulatlan besorolás**. Az ilyen,
még azonos értékű prioritást külön jelöljük; megváltoztatása vagy megerősítése
nyugtázza az átnézést. Régi értéket a felmérés alapján nem módosítottunk.
A közös agentutasítás előírja: fontossági emberi szándék nélkül új issue prioritása 0.

Privát végpontok: `GET /api/gg/host-loads`, `PUT /api/gg/work`.
Mindkettő a meglévő hitelesítés mögött, csak interaktív helyi kliensnek érhető el;
a PUT-ra a meglévő same-origin védelem is érvényes. Watch és bridge nem fér hozzá.
