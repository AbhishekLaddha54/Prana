import { createWorld, injectOutbreak, step, dayOf } from "../src/lib/prana/sim";
import { buildLibrary, newMesh, liveMatches, runRound } from "../src/lib/prana/mesh";
const lib = buildLibrary();
for (const e of lib) console.log(e.id, e.medicine, "peak", e.peakMult.toFixed(2), "dtp", e.daysToPeak, e.sig.map(x=>x.toFixed(2)).join(" "));
const w = createWorld(); const mesh = newMesh();
for (let i=0;i<14;i++){ if (dayOf(w)===5) injectOutbreak(w,"dengue_para",3); step(w); const lm = liveMatches(w, mesh); if (lm) console.log("day",dayOf(w), lm.matches.map(m=>m.id+" "+m.sim.toFixed(2)).join(" | "), lm.sig.map(x=>x.toFixed(2)).join(" ")); }
runRound(mesh,true); console.log("DP", liveMatches(w,mesh)!.matches.map(m=>m.id+" "+m.sim.toFixed(2)).join(" | "));
