# Ovis workspace-áttekintő MVP

## Elfogadott cél

Tamás a 2026-10-23-i beszélgetésben elfogadta a két nézet drótvázát, majd kérte az MVP-t.
A nyitott workspace-ek első, rögzített virtuális tabja az Áttekintés: döntések, munkák,
hibák és a kapcsolódó rendes tabra ugrás. A globális összesítő a bezárt/inaktív
workspace-ekhez tartozó tartós munkát is mutatja; a link a helyi workspace-t nyitja meg.
A meglévő Ovis-limitkijelzés marad a kapacitás forrása. Ez saját GG-kiegészítés,
upstream PR és új agent-ütemező nélkül.

## Műszaki keret

- A helyi `local/main-gg` ágból külön worktree. Meglévő React/Bun és Ovis-tokenek.
- A backend a telepített `CoreStore.tasks()` adapter és az aktív csomagok függő
  döntéseinek fix lekérdezését cache-eli read-only tranzakcióban, explicit
  adatprojekcióval. Nyers brief, checkpoint, grant és hitelesítő nem jut a böngészőbe.
  A CLI status utolsó 100 kérdésre korlátozott eredménye nem lenne teljes döntési sor.
- A helyi Herdr-roster adja az élő munkákat, interaktív kérdésjelzéseket és restore-hibákat.
  A beszélgetésben maradt, nem regisztrált sessiondöntések nem kereshetőek teljeskörűen;
  ezt a UI kimondja. Hiba vagy elérhetetlen adatforrás nem jelent üres feladatsort.
- A már létező autoagent repository→main_checkout célmapping köti össze a tartós munkát
  a nyitott és bezárt workspace-ekkel. Nincs tippelt könyvtár vagy címke szerinti illesztés.
- A virtuális tab nem hoz létre terminált; natív tabváltáskor eltűnik a tartalma.
- A helyi GG-adat végpontja a meglévő hitelesítés mögött, csak interaktív hozzáférésből
  olvasható. Remote bridge-en nem közvetítjük.

## Végrehajtás

1. Backendprojekció/cache és kliensoldali összerendelés: először hibázó, majd zöld unit-tesztek.
2. Két UI-nézet, globális navigáció, fix első tab; a meglévő natív pane-navigáció megtartása.
3. Typecheck, érintett unit- és szerződéstesztek, build, izolált böngészős működéspróba.
4. Friss kontextusú független review, javítás, valós adatos preview, a saját frissítési
   útba integrálás az érvényes felhatalmazás szerint. Futó Ovis önkényes cseréje nélkül.

## Kiemelt ellenőrzések

Lezárt story maradéka; több repository egy taskban; újrahasznált pane-ID másik gépen;
félbeszakadó státuszolvasás; bezárt workspace-link; shellből nem készül agentmunka;
hibás vagy elavult adatforrás látható jelzést kap.
