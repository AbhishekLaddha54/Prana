import { createWorld, injectOutbreak, step, dayOf } from "../src/lib/prana/sim";
import { MEDS } from "../src/lib/prana/core";
const w = createWorld();
console.log("baseline alerts (warmup cleared):", w.alerts.length, "day", dayOf(w));
const base = w.analysis.filter(a=>a.level>0).length; console.log("baseline pairs with level>0:", base, "min dosPhc", Math.min(...w.analysis.map(a=>a.dosPhc)).toFixed(1));
for (let i=0;i<22;i++){
  if (dayOf(w)===5) injectOutbreak(w,"dengue_para",3);
  step(w);
  const top = [...w.analysis].sort((a,b)=>b.rs-a.rs)[0];
  const d4 = w.analysis[3*8+0];
  console.log("day",dayOf(w),"D4PAR rs",d4.rs.toFixed(2),d4.state,"so",d4.soCount,"dosPhc",d4.dosPhc.toFixed(1),"dtso",d4.dtso.toFixed(1),"| top", `D${top.d+1}-${MEDS[top.m].id}`, top.rs.toFixed(2),"| PHCso", w.hist.so[w.hist.so.length-1], "crit", w.alerts.filter(a=>a.level==="CRITICAL").length, "warn", w.alerts.filter(a=>a.level==="WARNING").length);
}
console.log(w.alerts.slice(0,8).map(a=>`${a.tick-w.t0} ${a.level} ${a.text}`).join("\n"));
