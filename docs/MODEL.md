# PRANA — Model Documentation

Every formula and assumption used by the simulator, the nowcast, the contagion engine, the planner and the mesh.
All randomness is a **stateless hash RNG** `rand(seed=42, ...keys)`, so any replay/fork (counterfactual) draws exactly the same noise — the guided demo is identical on every run.

## 1. Synthetic world

* 12 districts on a 4×3 jittered lattice (column-major ids, `D4` = column 2, row 1 → 3 neighbours-of-neighbours in every direction). District polygons share jittered lattice corners so they tile.
* 60 PHCs (5 / district). Each PHC has directed referral edges: ring-next PHC in the district, +40 % chance nearest other in-district PHC, +40 % chance nearest PHC of an adjacent district → **1–3 out-edges**. Spillover uses the undirected union.
* District graph: 8-neighbourhood of the lattice. `n_ij` = number of PHC referral edges between districts *i* and *j*.
* Baseline demand: `base[p,m] = med.base × (pop_d / 800 000) × share_p × U(0.9,1.1)`, share_p ∈ U(0.7,1.3).
* Daily demand: `d[p,m,t] = base × (1 + 0.12 sin(2πt/7)) × outbreakMult × (1 + 0.08 ε)`, ε ~ N(0,1).
* Stock: `stock -= min(stock, demand + spillIn)`. **Stock-out** ⇔ `stock < EMA(demand)` (below one day of demand). `EMA ← 0.6·EMA + 0.4·demand`.
* Restock: district warehouse → PHC weekly, filling to `capDays × base` (capacity-limited, scaled down if the warehouse is short; `capDays`=21, D4 = 13 to model a chronically thin cold/dry store). National depot → warehouse every 14 days (staggered per district): order `max(0, 45·D − wh − pending)`, lead time 2–4 d, fill rate U(0.7, 1.0).
* Beds occupied % = `48 + 15(mult−1) + 4ε`; nurses on duty = `round(4 − 0.3(mult−1) + 0.8ε)` clipped 1..6.
* 90 warm-up ticks = persisted history; demo day 0 = tick 90.

## 2. Dengue surge

Injected in **D4** (all 5 PHCs infected at tick *t₀*). For `t ∈ (t₀, t₀+12]` each infected PHC infects each uninfected neighbour with `p = 0.35` per edge per day. Per-PHC multiplier at infection age *a*:

```
mult = 1 + (peak−1) · sev · σ((a − 1.2)/0.8) · decay(a)        peak: PAR 4×, ORS 3.2×
sev  = 0.85 + 0.15·U        decay(a)=1 for a ≤ 28 else exp(−(a−28)/8)
```
(logistic ramp).

## 3. PRANA-Sense — Bayesian nowcast

State per (PHC, medicine): `days-of-stock ~ N(μ, v)`.

* **Process step each day:** `μ ← max(0, μ − 1)`, `v ← v + 0.6`.
* **Observation** `y ~ N(days, r)` with channel noise sd: voice **4.0 d**, photo **2.5 d**, manual/USSD **1.0 d**.
* **Conjugate update:** `v' = 1 / (1/v + 1/r)`, `μ' = v'(μ/v + y/r)`. CI shown = `μ' ± 1.96 √v'`. Posterior is always tighter than prior and observation.
* Voice/photo extraction returns units; `y = units / EMA(demand)`.
* **Observability score (0–100)** `= 100(0.40·fresh + 0.25·diversity + 0.35·tight)` where per medicine `fresh = exp(−age/10)`, `tight = clamp(1 − sd/7)`, blended `0.5·mean + 0.5·max` over the 8 medicines; `diversity = #distinct source types (voice, photo, manual, ledger) / 4`. Map marker opacity = `0.35 + 0.65·score/100`.

Mock extractor (offline): regex PHC code, medicine keyword dictionary, first number / Hindi number word, `kal tak/khatam` caps days at 1.5, footfall keywords (`badh` → rising, `kam` → falling). Output schema is identical to the LLM path.

## 4. PRANA-Cortex — contagion, Rs, alerts

**Contagion.** A stocked-out PHC sends `s = 0.45` of its unmet demand, split equally, to its non-stocked-out referral neighbours (arrives next tick). The remaining 55 % is lost (= untreated patient-days).

**District metrics** for pair (i, m): `S = Σ PHC stock`, `D = Σ EMA demand`, `dosPHC = S/D`, `dosTot = (S+warehouse)/D`, `fm7 = M(t+7)/M(t)` (outbreak-multiplier ratio from the known infection state).

**States:** `STOCKED_OUT` if ≥ 2 PHCs stocked out; `STRESSED` if `dosPHC < 7` or ≥ 1 stocked out; `RECOVERED` once a formerly STOCKED_OUT pair has < 1 stocked-out PHCs and `dosPHC ≥ 7`; else `ADEQUATE`.

**Shortage Reproduction Number** — expected number of neighbouring districts pushed to stock-out within `H = 7` days if the current spillover persists:

```
u_i      = max( unmetEMA_i ,  max(0, D_i·fm7_i·H − S_i)/H )                 (units/day spilling out)
N_i'     = { j ∈ N(i) : state_j ≠ STOCKED_OUT }                              (only live nodes can be infected)
w_ij     = (1 + n_ij) / Σ_{k∈N_i'} (1 + n_ik)
p_ij     = 1 − (1 − 0.35)^{max(1, n_ij)}                                     (per-edge spread prob., n edges in parallel)
load_ij  = s · u_i · w_ij · H                                                (units pushed onto j over H days)
buffer_j = max( 0.5·D_j ,  S_j/fm7_j − 3·D_j )                              (usable stock above a 3-day working reserve)
Rs_i     = κ · Σ_{j∈N_i'} p_ij · min(1.5, load_ij / buffer_j)
```
`κ = 5.0` is a **calibration constant** chosen so that the seeded demo crosses Rs = 1 around day 9 of the scenario (4 days after injection). It is a scale factor on the structure above, not a fitted epidemiological parameter; the ordering of pairs is κ-invariant. Rs ≥ 0 always; Rs = 0 when nothing spills. **Rs > 1 ⇒ cascade risk.**

**Forecast.** Damped-trend (Holt) exponential smoothing per district–medicine: `l ← α y + (1−α)(l + φb)`, `b ← β(l−l₋) + (1−β)φb`, α=0.4, β=0.2, φ=0.85; horizon-*h* mean `= (l + Σφⁱ b) × M(t+h)/M(t)` (active outbreak multiplier); sd `= √(EMA e²)·√h·ratio`. *Days-to-stockout* = first *h* where cumulative forecast demand ≥ `S + warehouse` (interpolated, cap 60).

**Alerts.** CRITICAL when `Rs > 1`; WARNING when `0.8 ≤ Rs ≤ 1` or `days-to-stockout ≤ 14`. An alert is emitted on escalation; the stored level de-escalates only after 3 consecutive lower ticks (no flapping).

## 5. PRANA-Planner

Per medicine, a transportation problem solved as **min-cost max-flow** (successive shortest paths, SPFA; integer units — a pure-TypeScript stand-in for OR-Tools so the demo installs with zero native wheels).

* **Sinks:** pairs with `level ≥ 1`, or STOCKED_OUT, or STRESSED with days-to-stockout < 21; plus the *pre-emptive frontier* (neighbours of pairs with Rs>1) whose need is scaled ×2.2. `need = Σ_{h ≤ T} forecast − (S + warehouse)`.
* **Sources:** ADEQUATE/RECOVERED districts with days-to-stockout > 21; `surplus = min(warehouse, S − R·avgForecast)`, reserve *R* = 21 + 7 safety days (28) — BALANCED uses 35.
* **Arc cost:** `km = haversine × 1.3`, `hours = km/40 + 4`, truck cost ₹22/km. Cold-chain medicines (Insulin, Oxytocin) may only use arcs between cold-hub districts with `km ≤ 350`. Arc capacity = `maxTrucks × truckUnits`.
* **Plans:** CHEAPEST (cost=km, T=18, ≤3 trucks/lane); FASTEST (cost=hours, T=24, ≤6 trucks); BALANCED (0.5·km + 0.5·hours normalised, T=28, ≤4 trucks, two-tier source arcs that penalise draining a donor past 50 % of its surplus).
* **Counterfactual replay:** `structuredClone` the world, run 21 ticks without the plan and with it (shipments loaded, donor warehouse debited — never below 0; arrival triggers an emergency PHC top-up to 10 days). Reported: Rs at day +7 (max over districts for the focus medicine), days-to-stockout at +7 for the focus pair, stock-out PHC-days avoided, and **untreated patient-days avoided = Σ Δ unmet × patient-days-per-unit**.
* Explanation: 3-sentence LLM rationale with `OPENAI_API_KEY`, otherwise a template with the same slot. **Nothing executes until a human presses Approve.** On approval, a 40-day no-plan shadow is stored so the epidemic-curve panel can overlay *with vs without intervention*.

## 6. PRANA-Mesh

* Three independent engine instances (seeds 1042/2042/3042): **IND** dengue-paracetamol, **BRA** dengue-ORS variant, **ZAF** flood-amoxicillin.
* **12-d signature** (medicine-agnostic, each feature clipped to [0,1] with a fixed normaliser), measured over the first 5 days from onset on the *epicentre cluster* (3 most-elevated districts): demand-growth slope of ln(ratio), mean surge ratio, latest surge ratio, secondary-medicine surge, medicine-mix shift (L1), stress ratio, stress trajectory, spillover rate, unmet-demand fraction, spatial extent, spread velocity, demand volatility.
* **Round:** each nation shares only its vector (+ small local-training jitter). Server **FedAvg** = (weighted) mean; equal weights by default.
* **Differential privacy:** optional Laplace noise, scale `Δ/ε = 0.25/4`, clipped back to [0,1]. Lower ε ⇒ stronger privacy, noisier vectors, lower similarity.
* **Matching:** `cos(live, library_k)` recomputed every tick after onset. Headline picks the best *partner-nation* entry (the local pattern is already in the local model); a match ≥ 0.85 fires the pre-emptive forecast `peakMult× in daysToPeak days` taken from the library's origin-district demand curve.
* **With / without Mesh:** without a prior, a novel pattern needs a **6-day confirmation window** (documented assumption, `CONFIRM_LAG`) before the local forecaster applies an outbreak multiplier, so the without-Mesh baseline stays flat for those 6 extra days. With Mesh the curve is applied at match time.
