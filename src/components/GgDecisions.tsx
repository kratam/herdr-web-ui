import { useState } from "react";
import type { DecisionPackage } from "../lib/ggAttentionBoard.ts";
import { decisionConnection } from "../lib/ggDecisions.ts";
import { useMachineSessions } from "../lib/machineSessionContext.tsx";
import { GgDecisionPackage } from "./GgDecisionPackage.tsx";

interface Props {
  packages: DecisionPackage[];
  unavailable: boolean;
  refresh(): Promise<void>;
  openPane(paneId: string, started: boolean): void;
}

/** Storynkénti döntési csomagok; a Beszéljük át az Ovis saját agentnézetét nyitja. */
export function GgDecisions({ packages, unavailable, refresh, openPane }: Props) {
  const sessions = useMachineSessions();
  const [notice, setNotice] = useState("");
  return <section className="gg-overview-section gg-decisions" aria-label="Tőlem döntés kell">
    <h2>Tőlem döntés kell <span className="gg-section-count">{packages.length}</span></h2>
    {notice && <p className="gg-overview-warning" role="status">{notice}</p>}
    {packages.map(pack => <GgDecisionPackage key={pack.decisions[0]!.id} pack={pack} unavailable={unavailable}
      connection={() => decisionConnection(sessions)} openPane={openPane} saved={async () => { setNotice("A válasz rögzítve. A feladatsor frissül."); await refresh(); }} />)}
    {!packages.length && <p className="gg-overview-empty">{unavailable ? "A döntési sor állapota most nem ismert." : "Most nincs olyan kérdés, amire válaszolnod kell."}</p>}
  </section>;
}
