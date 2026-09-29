import { createWorld, injectOutbreak, step, dayOf } from "../src/lib/prana/sim";
import { generatePlans } from "../src/lib/prana/planner";
import { MEDS } from "../src/lib/prana/core";
(async()=>{
const w = createWorld();
while (dayOf(w) < 15) { if (dayOf(w)===5) injectOutbreak(w,"dengue_para",3); step(w); if (dayOf(w)>=9 && w.alerts.some(a=>a.level==="CRITICAL")) break; }
console.log("day", dayOf(w), "crit alerts", w.alerts.filter(a=>a.level==="CRITICAL").map(a=>a.text));
const t=Date.now(); const plans = await generatePlans(w); console.log("ms", Date.now()-t);
for (const p of plans) { console.log(p.name, "ships", p.shipments.length, "units", Math.round(p.totalUnits), "cost", p.totalCost, "eta", p.maxEtaH.toFixed(0), "unserved", p.unserved.length); console.log(" effect", JSON.stringify({...p.effect, series: undefined}), "so", p.effect.series.without.join(","), "|", p.effect.series.with.join(",")); }
console.log(plans[0].explanation);
console.log(plans[0].shipments.slice(0,5).map(s=>`D${s.from+1}->D${s.to+1} ${MEDS[s.m].id} ${Math.round(s.units)}`));
})();
