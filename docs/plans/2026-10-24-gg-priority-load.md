# GG hostload és munkák személyes átnézése

Helyi Ovis-kiegészítés, upstream push/PR nélkül. Tamás kérésére a workspace és globális
áttekintő ugyanazt a Linear-story prioritást állítja; a sorrend prioritás szerinti.
A besorolatlan (0) és korábbi agentírás miatt ellenőrizendő prioritás külön szűrhető.
A felmérés jelöltjei nem bizonyított önkényes besorolások; értéküket nem töröljük.

A későbbre tétel személyes átnézési állapot, story-szinten, a szerver stateDir alatti
privát, atomikusan írt JSON-ban. Nem core-not_before, nem parkolás és nem due date.
1/2 nap, 1/2 hét, 30 nap vagy egyéni időpont. Lejáratkor ismét megjelenik a sorrendben.
A döntési és hibalistára nincs hatása; csak a planned munkák átnézésére.

A Linear-írás fix Python-childon át, proxyzott felhasználói tokennel történik,
csak prioritásválasztásra vagy megerősítésre. Friss Linear-érték ellenőrzése előzi meg;
ütközéskor nincs felülírás/automatikus újrapróba. A mentett érték a core-tükör
utoléréséig jelölt áthidaló adat. A runner DB-szerep továbbra is csak olvas.

A sidebar hostload percenként látható lapon frissül. Helyi OS API, távolról fix,
csak olvasó parancs a meglévő SSH-mesteren. Gépenként single-flight/cache;
régi, hibás és hiányzó mérés megkülönböztetett. A szám 1 perces load / logikai CPU,
nem CPU-százalék; a tooltip 5/15 perces értéket és mérési időt is mutat.
Windows load nem támogatott, ez hiányzó mérésként jelenik meg.

UI-minta: a meglévő T3 Code-féle oldalsáv és egyszerű soronkénti vezérlők
folytatása, natív billentyűzettel kezelhető selectekkel; nincs új kártyarendszer.
A meglévő useGgOverview/App felosztás és release-tagot követő helyi updater megmarad.

Ellenőrzés: írási határ, ütközés, sérült perzisztencia, cache/stale load,
sorrend/lejárat unit; izolált böngészős prioritás/halasztás mindkét nézetben,
typecheck/build, friss független review; szokásos lokális telepítő és élő revision.

## Független review

Friss Claude/Sonnet review: auth- vagy biztonsági rés nem került elő. A prioritásválasztás
külön Mentés gombot kapott (nyílbillentyű nem ír); a core-val egyező prioritásnyugta
időbélyeg nélkül is feloldja az áthidalási jelzést. A story-szintű halasztás szövege
pontosítva. A telepített proxy SIGTERM/SIGHUP jelét továbbítja a gyermeknek.
A bizonytalan írás eredménye továbbra sem próbálódik újra automatikusan.

A visszaellenőrzés után a core által utolért prioritásnyugtát tartósan eltávolítjuk,
így időbélyeg nélküli későbbi változás sem élesztheti újra. Ezt egyezés → eltérő
érték lépéssorral unit teszt ellenőrzi. Nem JSON hibaválasz magyar, bizonytalan
eredményjelzést kap; forrásváltozáskor a régi prioritáspiszkozat törlődik.
