/* ============================================================
   Campus Sustainability Simulator — app.js  v3.0
   New in v3: Dynamic Compounded Growth + AI Recommendation Layer
   ============================================================ */


/* ══════════════════════════════════════════════════════════════
   SECTION 1 — CONSTANTS & STATE
   ══════════════════════════════════════════════════════════════ */

/**
 * DYNAMIC GROWTH RATES (compounded yearly)
 * ─────────────────────────────────────────
 * These drive the "no-intervention" trajectory. Growth is applied
 * EVERY year BEFORE policy reductions, so policies fight an
 * ever-growing baseline — which is realistic.
 *
 * How to tune them:
 *   population  → drives per-capita scaling (energy, water, waste)
 *   energy      → additional demand growth beyond population (new labs etc.)
 *   water       → additional water-intensity growth
 *   waste       → additional waste-intensity growth
 *   inflation   → applied to maintenance cost accumulation each year
 */
const GROWTH_RATES = {
  population: 0.03,   // 3 % annual student + staff growth
  energy:     0.03,   // 3 % additional energy demand growth
  water:      0.02,   // 2 % additional water usage growth
  waste:      0.02,   // 2 % additional waste generation growth
  inflation:  0.04,   // 4 % annual maintenance cost inflation
};

const POLICIES = {
  solar:       { costKey: 'solarCost',       label: 'Solar Panels',         icon: '☀️',  maintBase: 0.01  },
  smartEnergy: { costKey: 'smartEnergyCost', label: 'Smart Energy Mgmt',    icon: '🤖',  maintBase: 0.005 },
  rainwater:   { costKey: 'rainwaterCost',   label: 'Rainwater Harvesting', icon: '🌧️', maintBase: 0.008 },
  compost:     { costKey: 'compostCost',     label: 'Composting & Biogas',  icon: '♻️',  maintBase: 0.006 },
};

let SIM_YEARS  = 5;
let campus     = null;
let budget     = null;
let simResults = {};
let aiRecs     = null;   // stores AI recommendation output
let charts     = {};
let selected   = { solar: false, smartEnergy: false, rainwater: false, compost: false };


/* ══════════════════════════════════════════════════════════════
   SECTION 2 — YEAR TOGGLE
   ══════════════════════════════════════════════════════════════ */

function setYears(n) {
  SIM_YEARS = n;
  [3, 5, 10].forEach(y => document.getElementById('y' + y).classList.toggle('on', y === n));
  document.getElementById('yrsHint').innerHTML =
    `Projecting <strong style="color:var(--green)">${n} years</strong> ahead`;
  stampYears(n);
  updateSummary();
}

function stampYears(n) {
  ['badgeYrs', 'hdrYrs', 'resYrs', 'scoreTitleYrs', 'liveYrLbl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  });
  document.querySelectorAll('.dynYrs').forEach(el => (el.textContent = n));
  const rb = document.getElementById('runBtn');
  if (rb) rb.textContent = `▶ Run ${n}-Year Simulation`;
}


/* ══════════════════════════════════════════════════════════════
   SECTION 3 — BUDGET HELPERS
   ══════════════════════════════════════════════════════════════ */

function calcBudget(d) {
  const s = Math.round(d.dailyEnergyKwh   * 365 * 0.12);
  const m = Math.round(d.dailyEnergyKwh   * 365 * 0.02);
  const r = Math.round(d.dailyWaterLiters * 365 * 0.005);
  const c = Math.round(d.dailyWasteKg     * 365 * 0.008);
  return {
    totalBudget:     Math.round((s + m + r + c) * 1.2),
    solarCost:       s,
    smartEnergyCost: m,
    rainwaterCost:   r,
    compostCost:     c,
  };
}

function refreshBudgetPreview() {
  const dE = +g('dailyEnergy') || 0, dW = +g('dailyWater') || 0, dD = +g('dailyWaste') || 0;
  if (dE || dW || dD)
    document.getElementById('sugDisplay').textContent =
      '₹ ' + fmt(calcBudget({ dailyEnergyKwh: dE, dailyWaterLiters: dW, dailyWasteKg: dD }).totalBudget);
}

function onBudgetType() {
  const val = +g('budgetInput'), hint = document.getElementById('budgetHint');
  if (val > 0) { hint.textContent = '₹ ' + fmt(val) + ' set as your budget'; hint.style.color = 'var(--green)'; }
  else         { hint.textContent = 'Total spend across all policies';          hint.style.color = ''; }
}

function useSuggestedBudget() {
  const dE = +g('dailyEnergy') || 0, dW = +g('dailyWater') || 0, dD = +g('dailyWaste') || 0;
  if (!dE && !dW && !dD) { toast('Fill in consumption data first'); return; }
  document.getElementById('budgetInput').value =
    calcBudget({ dailyEnergyKwh: dE, dailyWaterLiters: dW, dailyWasteKg: dD }).totalBudget;
  onBudgetType();
}

function resetBudget() {
  if (!budget) return;
  document.getElementById('budgetInput').value = budget.totalBudget;
  budget._active = budget.totalBudget;
  document.getElementById('budgetDisplay').textContent = fmt(budget.totalBudget);
  updateSummary();
}


/* ══════════════════════════════════════════════════════════════
   SECTION 4 — NAVIGATION
   ══════════════════════════════════════════════════════════════ */

function setPage(n) {
  document.querySelectorAll('.page').forEach((p, i) => p.classList.toggle('active', i + 1 === n));
  [1, 2, 3].forEach(i => {
    const s = document.getElementById('step' + i);
    s.classList.remove('active', 'done');
    if (i < n) s.classList.add('done');
    if (i === n) s.classList.add('active');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goTo1() { setPage(1); }

function goTo2() {
  const req = ['dailyEnergy', 'dailyWater', 'dailyWaste'];
  let ok = true;
  req.forEach(id => {
    const el = document.getElementById(id), valid = el.value !== '' && parseFloat(el.value) > 0;
    el.classList.toggle('warn', !valid);
    if (!valid) ok = false;
  });
  const hasPopulation = (+g('students') || 0) + (+g('staff') || 0) > 0;
  ['students', 'staff'].forEach(id => document.getElementById(id).classList.toggle('warn', !hasPopulation));
  if (!hasPopulation) ok = false;
  if (!ok) { toast('Please fill in all required fields'); return; }

  stampYears(SIM_YEARS);
  const s = +g('students') || 0, st = +g('staff') || 0, h = +g('hostelCount') || 0, tot = s + st;
  const dW = +g('dailyWaste') || 0, org = +g('organicWaste') || 0;

  campus = {
    students: s, staff: st, hostelResidentCount: h,
    hostelResidentPercent: tot > 0 ? +(Math.min(100, (h / tot) * 100)).toFixed(2) : 0,
    dailyEnergyKwh:  +g('dailyEnergy'),
    dailyWaterLiters:+g('dailyWater'),
    dailyWasteKg: dW,
    organicWasteKgDay: org,
    organicWastePercent: (dW > 0 && org > 0) ? +(Math.min(100, (org / dW) * 100)).toFixed(2) : 60,
  };

  budget = calcBudget(campus);
  const userB = +g('budgetInput');
  budget._active = userB > 0 ? userB : budget.totalBudget;
  if (!g('budgetInput')) document.getElementById('budgetInput').value = budget.totalBudget;

  document.getElementById('sugDisplay').textContent    = '₹ ' + fmt(budget.totalBudget);
  document.getElementById('budgetDisplay').textContent = fmt(budget._active);
  document.getElementById('sugSummary').textContent    = fmt(budget.totalBudget);
  document.getElementById('cost-solar').textContent        = '₹ ' + fmt(budget.solarCost);
  document.getElementById('cost-smartEnergy').textContent  = '₹ ' + fmt(budget.smartEnergyCost);
  document.getElementById('cost-rainwater').textContent    = '₹ ' + fmt(budget.rainwaterCost);
  document.getElementById('cost-compost').textContent      = '₹ ' + fmt(budget.compostCost);

  updateSummary();
  setPage(2);
}


/* ══════════════════════════════════════════════════════════════
   SECTION 5 — POLICY TOGGLE
   ══════════════════════════════════════════════════════════════ */

function toggle(key) {
  selected[key] = !selected[key];
  document.getElementById('pc-' + key).classList.toggle('on', selected[key]);
  updateSummary();
}


/* ══════════════════════════════════════════════════════════════
   SECTION 6 — SUMMARY PANEL (LIVE)
   ══════════════════════════════════════════════════════════════ */

function updateSummary() {
  if (!budget) return;
  const total = budget._active || 0;
  const costs = {
    solar: budget.solarCost, smartEnergy: budget.smartEnergyCost,
    rainwater: budget.rainwaterCost, compost: budget.compostCost,
  };
  const used = Object.keys(selected).reduce((s, k) => s + (selected[k] ? costs[k] || 0 : 0), 0);
  const rem  = total - used, over = used > total;
  const usedP = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const remP  = total > 0 ? Math.max((rem  / total) * 100, 0)   : 0;

  const bar = document.getElementById('budgetBar');
  bar.style.width = usedP + '%'; bar.className = 'prog-fill ' + (over ? 'over' : 'amber');
  document.getElementById('budgetRemBar').style.width = remP + '%';
  document.getElementById('budgetUsed').textContent   = '₹ ' + fmt(used);
  document.getElementById('budgetRem').textContent    = '₹ ' + fmt(Math.max(0, rem));
  document.getElementById('budgetRem').style.color    = over ? 'var(--red)' : 'var(--green)';
  document.getElementById('budgetWarn').classList.toggle('show', over);

  const active = Object.keys(selected).filter(k => selected[k]);
  document.getElementById('polList').innerHTML = active.length === 0
    ? '<div class="no-pol">Nothing selected yet</div>'
    : active.map(k => `<div class="pol-sel-row">
        <span class="pol-sel-name">${POLICIES[k].icon} ${POLICIES[k].label}</span>
        <span class="pol-sel-cost">₹ ${fmt(costs[k])}</span>
      </div>`).join('');

  document.getElementById('polCount').textContent = active.length + ' / 4';
  document.getElementById('polCost').textContent  = '₹ ' + fmt(used);
  document.getElementById('polRem').textContent   = '₹ ' + fmt(rem);
  document.getElementById('polRem').className     = 'sum-val ' + (over ? 'r' : 'g');

  if (campus) {
    const sim = simulate(campus, { ...budget, totalBudget: total }, selected);
    const sc  = sim.years[sim.years.length - 1].score;
    const col = scoreColor(sc);
    document.getElementById('liveScoreLbl').textContent      = sc + ' / 100';
    document.getElementById('liveScoreLbl').style.color      = col;
    document.getElementById('liveScoreBar').style.width      = sc + '%';
    document.getElementById('liveScoreBar').style.background = col;
  }
}


/* ══════════════════════════════════════════════════════════════
   SECTION 7 — SIMULATION ENGINE (Dynamic Compounded Growth)
   ══════════════════════════════════════════════════════════════

   HOW COMPOUNDED GROWTH WORKS:
   ─────────────────────────────
   Two independent effects compound each year before any policy is applied:

     1. Population growth  → more students/staff each year
        popFactor = (1 + GROWTH_RATES.population) ^ y

     2. Per-capita demand growth → each person uses more over time
        energyFactor = (1 + GROWTH_RATES.energy) ^ y
        (similarly for water and waste)

   Combined effect inside the loop:
     grownBaseline = annualBase × popFactor × perCapitaFactor

   This means the baseline grows FASTER than either rate alone — which
   is the correct compounding behavior. It applies every year regardless
   of whether policies are selected.

   THEN policy reductions are applied AFTER growth:
     actual = grownBaseline × (1 − reductionFraction)

   Maintenance cost inflation:
     maintCost_y = baseMaintCost × (1 + inflation) ^ y
     Deducted from budRem each year to show realistic TCO.
   ══════════════════════════════════════════════════════════════ */

function simulate(campus, budget, policies) {
  /* Annual base consumption */
  const bE = campus.dailyEnergyKwh   * 365;
  const bW = campus.dailyWaterLiters * 365;
  const bD = campus.dailyWasteKg     * 365;

  /* Capital costs deducted upfront */
  let budRem = budget.totalBudget;
  Object.keys(policies).forEach(k => {
    if (policies[k]) budRem -= (budget[POLICIES[k].costKey] || 0);
  });

  /* Annual maintenance base costs (% of capital) */
  const maintCosts = {};
  Object.keys(policies).forEach(k => {
    if (policies[k]) maintCosts[k] = (budget[POLICIES[k].costKey] || 0) * POLICIES[k].maintBase;
  });

  /* Policy reduction fractions */
  const eRed = (policies.solar ? 0.40 : 0) + (policies.smartEnergy ? 0.15 : 0);
  const wRed = policies.rainwater ? 0.30 : 0;
  const dRed = policies.compost   ? 0.35 : 0;
  const oCap = policies.compost   ? 0.80 : 0;

  /* Scoring bounds at final year (worst-case = no-policy grown, best-case = max reductions on grown) */
  const yr  = SIM_YEARS;
  const wcE = bE * Math.pow(1 + GROWTH_RATES.population, yr) * Math.pow(1 + GROWTH_RATES.energy, yr);
  const wcW = bW * Math.pow(1 + GROWTH_RATES.population, yr) * Math.pow(1 + GROWTH_RATES.water,  yr);
  const wcD = bD * Math.pow(1 + GROWTH_RATES.population, yr) * Math.pow(1 + GROWTH_RATES.waste,  yr);
  const wC  = energyCarbon(wcE) + wasteCarbon(wcD * campus.organicWastePercent / 100, 0);
  const bcE = wcE * (1 - 0.55), bcW = wcW * (1 - 0.30), bcD = wcD * (1 - 0.35);
  const bC  = energyCarbon(bcE) + wasteCarbon(bcD * campus.organicWastePercent / 100, 0.80);
  const bounds = { wC, bC, wW: wcW, bW: bcW, wD: wcD, bD: bcD };

  /* ══ YEARLY LOOP ══════════════════════════════════════════════
     Each iteration:
       STEP 1 — Compound growth (population × per-capita intensity)
       STEP 2 — Apply policy reductions AFTER growth
       STEP 3 — Calculate carbon emissions
       STEP 4 — Inflate & deduct maintenance cost
     ══════════════════════════════════════════════════════════ */
  const years = [];
  for (let y = 1; y <= SIM_YEARS; y++) {

    /* STEP 1: demand *= (1 + growthRate) compounded → implemented as base × (1+r)^y */
    const popFactor    = Math.pow(1 + GROWTH_RATES.population, y);  // e.g. 1.03^y
    const energyFactor = Math.pow(1 + GROWTH_RATES.energy,     y);  // e.g. 1.03^y
    const waterFactor  = Math.pow(1 + GROWTH_RATES.water,      y);  // e.g. 1.02^y
    const wasteFactor  = Math.pow(1 + GROWTH_RATES.waste,      y);  // e.g. 1.02^y

    const eGrown = bE * popFactor * energyFactor;  // grown baseline (no-policy)
    const wGrown = bW * popFactor * waterFactor;   // grown baseline
    const dGrown = bD * popFactor * wasteFactor;   // grown baseline

    /* STEP 2: policy reductions applied AFTER growth */
    const e = eGrown * (1 - Math.min(eRed, 0.95));
    const w = wGrown * (1 - Math.min(wRed, 0.95));
    const d = dGrown * (1 - Math.min(dRed, 0.95));

    /* STEP 3: carbon from energy + organic waste */
    const eC  = energyCarbon(e);
    const wC2 = wasteCarbon(d * campus.organicWastePercent / 100, oCap);
    const tC  = eC + wC2;

    /* STEP 4: maintenance costs inflate with (1 + inflation)^y */
    const yearlyMaint = Object.keys(maintCosts).reduce(
      (sum, k) => sum + maintCosts[k] * Math.pow(1 + GROWTH_RATES.inflation, y), 0
    );
    budRem -= Math.round(yearlyMaint);

    const row = {
      year: y,
      energy: Math.round(e),  water: Math.round(w),  waste: Math.round(d),
      energyCarbon: +eC.toFixed(2), wasteCarbon: +wC2.toFixed(2), totalCarbon: +tC.toFixed(2),
      budRem: Math.round(budRem),
      maintThisYear: Math.round(yearlyMaint),
      grownBaseline: { energy: Math.round(eGrown), water: Math.round(wGrown), waste: Math.round(dGrown) },
    };

    const sc = scoreRow(row, bounds, policies);
    row.score = sc.score; row.breakdown = sc.breakdown; row.reasons = sc.reasons;
    years.push(row);
  }

  const last = years[years.length - 1];
  const base = energyCarbon(bE) + wasteCarbon(bD * campus.organicWastePercent / 100, 0);
  return {
    years,
    summary: {
      active:      Object.keys(policies).filter(k => policies[k]),
      budRem:      Math.round(budRem),
      baseCarbon:  +base.toFixed(2),
      finalCarbon: last.totalCarbon,
      carbonCut:   +(((base - last.totalCarbon) / base) * 100).toFixed(1),
    },
  };
}

function energyCarbon(kwh)          { return (kwh * 0.82) / 1000; }
function wasteCarbon(kg, capRate)   { return ((kg * (1 - capRate)) / 1000) * 0.25; }


/* ══════════════════════════════════════════════════════════════
   SECTION 8 — SCORING
   ══════════════════════════════════════════════════════════════ */

function scoreRow(row, b, p) {
  const rng = (actual, worst, best) => {
    if (worst === best || actual <= best) return 100;
    return Math.min(100, Math.max(0, Math.round(((worst - actual) / (worst - best)) * 100)));
  };
  const cS = rng(row.totalCarbon, b.wC, b.bC);
  const wS = rng(row.water,       b.wW, b.bW);
  const dS = rng(row.waste,       b.wD, b.bD);
  const rS = p.solar && p.smartEnergy ? 100 : p.solar ? 40 : 0;

  const reasons = [];
  if (cS < 100) reasons.push(!p.solar && !p.smartEnergy ? 'Enable Solar + Smart Energy to cut grid carbon.'
    : !p.compost ? 'Add Composting to reduce organic emissions.' : `Carbon at ${cS}/100 — near-optimal.`);
  if (wS < 100) reasons.push(!p.rainwater ? 'Enable Rainwater Harvesting to improve water score.'
    : `Water at ${wS}/100 — near-optimal.`);
  if (dS < 100) reasons.push(!p.compost ? 'Enable Composting & Biogas to reduce landfill waste.'
    : `Waste at ${dS}/100 — near-optimal.`);
  if (rS < 100) {
    if (!p.solar && !p.smartEnergy) reasons.push('Enable Solar + Smart Energy for 100/100 renewable score.');
    else if (p.solar) reasons.push('Add Smart Energy Management to go from 40 → 100 on renewable.');
    else reasons.push('Add Solar Panels to reach 100/100 on renewable score.');
  }
  return {
    score: Math.min(100, Math.round(cS * 0.40 + wS * 0.30 + dS * 0.20 + rS * 0.10)),
    breakdown: {
      carbon:    { score: cS, weight: '40%', label: 'Carbon Impact' },
      water:     { score: wS, weight: '30%', label: 'Water Efficiency' },
      waste:     { score: dS, weight: '20%', label: 'Waste Reduction' },
      renewable: { score: rS, weight: '10%', label: 'Renewable Energy' },
    },
    reasons,
  };
}


/* ══════════════════════════════════════════════════════════════
   SECTION 9 — AI RECOMMENDATION ENGINE
   ══════════════════════════════════════════════════════════════

   Five rule-based analytical functions:

   ① calcCostPerTonCO2()     → ₹ per metric ton of CO₂ reduced
   ② calcCostPerScorePoint() → ₹ per sustainability score point gained
   ③ rankPoliciesByROI()     → all 4 policies ranked by composite ROI
   ④ identifyCriticalGap()  → dimension hurting score the most
   ⑤ recommendBestPolicy()  → best single affordable unselected policy
   ══════════════════════════════════════════════════════════════ */

/**
 * ① Cost per metric ton of CO₂ reduced (vs no-policy scenario).
 */
function calcCostPerTonCO2(selectedRes, noPolicyRes, budgetObj) {
  const costs = {
    solar: budgetObj.solarCost, smartEnergy: budgetObj.smartEnergyCost,
    rainwater: budgetObj.rainwaterCost, compost: budgetObj.compostCost,
  };
  const active = selectedRes.summary.active;
  const totalInvested = active.reduce((s, k) => s + (costs[k] || 0), 0);
  const noPLast = noPolicyRes.years[noPolicyRes.years.length - 1];
  const selLast = selectedRes.years[selectedRes.years.length - 1];
  const co2Saved = Math.max(0, noPLast.totalCarbon - selLast.totalCarbon);
  if (co2Saved === 0 || totalInvested === 0) return { costPerTon: null, co2Saved: 0, totalInvested };
  return { costPerTon: Math.round(totalInvested / co2Saved), co2Saved: +co2Saved.toFixed(2), totalInvested };
}

/**
 * ② Cost per sustainability score point gained (vs no-policy baseline).
 */
function calcCostPerScorePoint(selectedRes, noPolicyRes, budgetObj) {
  const costs = {
    solar: budgetObj.solarCost, smartEnergy: budgetObj.smartEnergyCost,
    rainwater: budgetObj.rainwaterCost, compost: budgetObj.compostCost,
  };
  const active = selectedRes.summary.active;
  const totalInvested = active.reduce((s, k) => s + (costs[k] || 0), 0);
  const baseScore = noPolicyRes.years[noPolicyRes.years.length - 1].score;
  const selScore  = selectedRes.years[selectedRes.years.length - 1].score;
  const scoreDelta = Math.max(0, selScore - baseScore);
  if (scoreDelta === 0 || totalInvested === 0) return { costPerPoint: null, scoreDelta: 0, totalInvested };
  return { costPerPoint: Math.round(totalInvested / scoreDelta), scoreDelta, baseScore, selScore, totalInvested };
}

/**
 * ③ Rank all four policies by ROI.
 *    Simulates each policy ALONE vs no-policy, computes:
 *      carbonROI  = t CO₂ saved per ₹ lakh invested
 *      scoreROI   = score pts gained per ₹ lakh invested
 *      composite  = 60% carbonROI + 40% scoreROI (normalized to 0-100)
 */
function rankPoliciesByROI(campus, budgetObj, noPolicyRes) {
  const costs = {
    solar: budgetObj.solarCost, smartEnergy: budgetObj.smartEnergyCost,
    rainwater: budgetObj.rainwaterCost, compost: budgetObj.compostCost,
  };
  const noPolScore  = noPolicyRes.years[noPolicyRes.years.length - 1].score;
  const noPolCarbon = noPolicyRes.years[noPolicyRes.years.length - 1].totalCarbon;

  const results = Object.keys(POLICIES).map(key => {
    const onlyThis = { solar: false, smartEnergy: false, rainwater: false, compost: false };
    onlyThis[key] = true;
    const simThis  = simulate(campus, { ...budgetObj }, onlyThis);
    const lastYr   = simThis.years[simThis.years.length - 1];
    const co2Saved = Math.max(0, noPolCarbon - lastYr.totalCarbon);
    const scoreGain= Math.max(0, lastYr.score - noPolScore);
    const lakhCost = (costs[key] || 1) / 100000;
    const carbonROI = lakhCost > 0 ? +(co2Saved  / lakhCost).toFixed(3) : 0;
    const scoreROI  = lakhCost > 0 ? +(scoreGain / lakhCost).toFixed(3) : 0;
    return {
      key, label: POLICIES[key].label, icon: POLICIES[key].icon,
      cost: costs[key], co2Saved: +co2Saved.toFixed(2), scoreGain,
      carbonROI, scoreROI,
      composite: (carbonROI * 0.60) + (scoreROI * 0.40),
    };
  });

  const maxComp = Math.max(...results.map(r => r.composite), 0.001);
  results.forEach(r => { r.compositeNorm = Math.round((r.composite / maxComp) * 100); });
  results.sort((a, b) => b.composite - a.composite);
  results.forEach((r, i) => r.rank = i + 1);
  return results;
}

/**
 * ④ Identify the most critical sustainability gap.
 *    Highest weighted-gap dimension = most impactful to fix.
 */
function identifyCriticalGap(selectedRes) {
  const last = selectedRes.years[selectedRes.years.length - 1];
  const bd   = last.breakdown;
  const dimWeights = { carbon: 0.40, water: 0.30, waste: 0.20, renewable: 0.10 };
  const gaps = Object.entries(bd).map(([dim, v]) => ({
    dim, label: v.label, score: v.score, gap: 100 - v.score,
    weightedGap: (100 - v.score) * dimWeights[dim], weight: v.weight,
  }));
  gaps.sort((a, b) => b.weightedGap - a.weightedGap);
  return { critical: gaps[0], allGaps: gaps };
}

/**
 * ⑤ Recommend the best single affordable policy not yet selected.
 *    Uses the ROI ranking, filtered to unselected + within remaining budget.
 */
function recommendBestPolicy(rankedPolicies, selectedPolicies, remainingBudget, criticalGap) {
  const costs = {
    solar: budget.solarCost, smartEnergy: budget.smartEnergyCost,
    rainwater: budget.rainwaterCost, compost: budget.compostCost,
  };
  const candidates = rankedPolicies.filter(r => !selectedPolicies[r.key] && (costs[r.key] || 0) <= remainingBudget);
  if (candidates.length === 0) {
    const anyUnselected = rankedPolicies.filter(r => !selectedPolicies[r.key]);
    return {
      recommended: null,
      reason: anyUnselected.length === 0
        ? 'All available policies are already selected — your campus is fully optimized!'
        : 'Budget is too limited to add any remaining policy. Consider increasing your sustainability budget.',
    };
  }
  const best = candidates[0];
  const addressesGap = {
    solar:       ['carbon', 'renewable'].includes(criticalGap.critical.dim),
    smartEnergy: ['carbon', 'renewable'].includes(criticalGap.critical.dim),
    rainwater:   criticalGap.critical.dim === 'water',
    compost:     ['waste', 'carbon'].includes(criticalGap.critical.dim),
  };
  const gapNote = addressesGap[best.key]
    ? `This also directly addresses your biggest gap: **${criticalGap.critical.label}** (${criticalGap.critical.score}/100).`
    : `Note: your biggest gap is **${criticalGap.critical.label}** (${criticalGap.critical.score}/100) — plan that next.`;
  return {
    recommended: best,
    reason: `${best.icon} **${best.label}** delivers the best ROI — saving ${best.co2Saved} t CO₂e/yr and adding ${best.scoreGain} score points for ₹${fmtK(costs[best.key])}. ${gapNote}`,
    alternativesCount: candidates.length - 1,
  };
}

/**
 * Master driver: runs all five analyses, returns combined result.
 */
function runAIRecommendations(selectedRes, noPolicyRes, budgetObj, selectedPolicies) {
  const remainingBudget = selectedRes.summary.budRem;
  const rankedPolicies  = rankPoliciesByROI(campus, budgetObj, noPolicyRes);
  const criticalGap     = identifyCriticalGap(selectedRes);
  const costPerTon      = calcCostPerTonCO2(selectedRes, noPolicyRes, budgetObj);
  const costPerPoint    = calcCostPerScorePoint(selectedRes, noPolicyRes, budgetObj);
  const bestPolicy      = recommendBestPolicy(rankedPolicies, selectedPolicies, remainingBudget, criticalGap);
  return { rankedPolicies, criticalGap, costPerTon, costPerPoint, bestPolicy };
}


/* ══════════════════════════════════════════════════════════════
   SECTION 10 — RUN & RENDER
   ══════════════════════════════════════════════════════════════ */

function runSim() {
  if (!campus) { toast('Complete Step 1 first'); return; }
  const b = { ...budget, totalBudget: budget._active || budget.totalBudget };
  simResults.selected = simulate(campus, b, { ...selected });
  simResults.nopolicy = simulate(campus, b, { solar:false, smartEnergy:false, rainwater:false, compost:false });
  simResults.full     = simulate(campus, b, { solar:true,  smartEnergy:true,  rainwater:true,  compost:true  });
  aiRecs = runAIRecommendations(simResults.selected, simResults.nopolicy, b, { ...selected });
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
  document.getElementById('tab-selected').classList.add('on');
  render('selected');
  setPage(3);
  toast(`✓ ${SIM_YEARS}-year simulation + AI analysis complete`);
}

function switchTab(key) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
  document.getElementById('tab-' + key).classList.add('on');
  render(key);
}

function render(scenario) {
  const res = simResults[scenario], yrs = res.years, last = yrs[yrs.length - 1];
  const noP = simResults.nopolicy, noPLast = noP.years[noP.years.length - 1];
  const labels = yrs.map(y => 'Year ' + y.year);

  /* KPIs */
  document.getElementById('kpiGrid').innerHTML = [
    kpi(`Year ${SIM_YEARS} Carbon`, last.totalCarbon.toFixed(1), 'metric tons CO₂e', `↓ ${pct(noPLast.totalCarbon, last.totalCarbon)}% vs no policy`, 'g', 'g'),
    kpi(`Year ${SIM_YEARS} Energy`, fmtK(last.energy),           'kWh/year', '', 'n', 'b'),
    kpi(`Year ${SIM_YEARS} Water`,  fmtK(last.water),            'liters/year', `↓ ${pct(noPLast.water, last.water)}% vs no policy`, 'g', 'b'),
    kpi(`Year ${SIM_YEARS} Waste`,  fmtK(last.waste),            'kg/year', `↓ ${pct(noPLast.waste, last.waste)}% vs no policy`, 'g', 'a'),
    kpi('Sustainability Score',      last.score,                  '/ 100', scoreLabel(last.score), 'g', 'g'),
    kpi('Budget Remaining',          '₹ ' + fmtK(last.budRem),  '', '', 'n', 'a'),
    kpi('Carbon Reduction',          res.summary.carbonCut + '%','vs no-policy', '', 'g', 'g'),
    kpi('Policies Active',           res.summary.active.length,  '/ 4', '', 'n', 'b'),
  ].join('');

  /* Score bars */
  const bd = last.breakdown, col = scoreColor(last.score);
  document.getElementById('scoreTotal').textContent = last.score + ' / 100';
  document.getElementById('scoreTotal').style.color = col;
  const dc = { carbon:'#ff4f5e', water:'#3db8ff', waste:'#f5a623', renewable:'#00e87a' };
  document.getElementById('scoreBars').innerHTML = Object.keys(bd).map(k => `
    <div class="prog">
      <div class="prog-row"><span class="prog-lbl">${bd[k].label} (${bd[k].weight})</span><span class="prog-val" style="color:${dc[k]}">${bd[k].score}</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${bd[k].score}%;background:${dc[k]}"></div></div>
    </div>`).join('');

  /* Charts */
  mkChart('cEnergy', labels, [
    { label:'With Policies (MWh/yr)',  data:yrs.map(y=>+(y.energy/1000).toFixed(1)),             color:'#3db8ff' },
    { label:'No Policy + Growth',      data:noP.years.map(y=>+(y.energy/1000).toFixed(1)),        color:'#3d5a73', dash:true },
    { label:'Grown Baseline',          data:yrs.map(y=>+(y.grownBaseline.energy/1000).toFixed(1)),color:'#f5a623', dash:true },
  ], 'MWh/yr');
  mkChart('cWater', labels, [
    { label:'With Policies (kL/yr)',   data:yrs.map(y=>+(y.water/1000).toFixed(1)),              color:'#00e87a' },
    { label:'No Policy + Growth',      data:noP.years.map(y=>+(y.water/1000).toFixed(1)),        color:'#3d5a73', dash:true },
  ], 'kL/yr');
  mkChart('cCarbon', labels, [
    { label:'With Policies (t CO₂e)', data:yrs.map(y=>y.totalCarbon),                           color:'#ff4f5e' },
    { label:'No Policy + Growth',     data:noP.years.map(y=>y.totalCarbon),                     color:'#3d5a73', dash:true },
  ], 't CO₂e');
  mkChart('cScore', labels, [
    { label:'Your Selection',         data:yrs.map(y=>y.score),                                  color:'#00e87a' },
    { label:'No Policies',            data:noP.years.map(y=>y.score),                            color:'#3d5a73', dash:true },
    { label:'All Policies',           data:simResults.full.years.map(y=>y.score),                color:'#f5a623', dash:true },
  ], 'Score');

  /* Score ring */
  document.getElementById('ringWrap').innerHTML = `
    <div class="ring">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r="52" fill="none" stroke="#1e3045" stroke-width="12"/>
        <circle cx="65" cy="65" r="52" fill="none" stroke="${col}" stroke-width="12"
          stroke-dasharray="${2*Math.PI*52}" stroke-dashoffset="${2*Math.PI*52*(1-last.score/100)}"
          stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
      </svg>
      <div class="ring-text"><span class="ring-num">${last.score}</span><span class="ring-lbl">SCORE</span></div>
    </div>
    <div class="score-breakdown">
      ${srow('Carbon',bd.carbon.score,'#ff4f5e')}${srow('Water',bd.water.score,'#3db8ff')}
      ${srow('Waste',bd.waste.score,'#f5a623')}${srow('Renewable',bd.renewable.score,'#00e87a')}
    </div>`;

  /* Reasons */
  document.getElementById('reasons').innerHTML = last.reasons.length === 0
    ? '<div style="color:var(--green);font-family:var(--mono);font-size:12px">🎉 Near-perfect sustainability — all dimensions maxed out!</div>'
    : last.reasons.map(r=>`<div class="reason"><span class="reason-dot">▸</span><span>${r}</span></div>`).join('');

  /* Data table — now includes Maint Cost column */
  document.getElementById('dataTable').innerHTML = `
    <thead><tr>
      <th>Year</th><th>Energy (kWh)</th><th>Water (kL)</th><th>Waste (kg)</th>
      <th>Energy CO₂</th><th>Waste CO₂</th><th>Total CO₂</th><th>Score</th>
      <th>Maint Cost</th><th>Budget Left</th>
    </tr></thead>
    <tbody>${yrs.map(y=>`<tr>
      <td><span class="yr-tag">Y${y.year}</span></td>
      <td>${fmt(y.energy)}</td><td>${fmt(Math.round(y.water/1000))}</td><td>${fmt(y.waste)}</td>
      <td>${y.energyCarbon}</td><td>${y.wasteCarbon}</td>
      <td style="color:${scoreColor(y.score)};font-weight:600">${y.totalCarbon}</td>
      <td style="color:${scoreColor(y.score)};font-weight:700">${y.score}</td>
      <td style="color:var(--amber)">₹${fmtK(y.maintThisYear)}</td>
      <td style="color:var(--amber)">₹${fmtK(y.budRem)}</td>
    </tr>`).join('')}</tbody>`;

  renderReports(res, simResults.nopolicy);
  if (aiRecs) renderAIPanel(aiRecs);
}


/* ══════════════════════════════════════════════════════════════
   SECTION 11 — AI PANEL RENDERER
   ══════════════════════════════════════════════════════════════ */

function renderAIPanel(ai) {
  const el = document.getElementById('aiPanel');
  if (!el) return;
  const { rankedPolicies, criticalGap, costPerTon, costPerPoint, bestPolicy } = ai;

  const bannerColor = bestPolicy.recommended ? 'var(--green)' : 'var(--amber)';
  const bannerIcon  = bestPolicy.recommended ? bestPolicy.recommended.icon : '💡';
  const bannerText  = bestPolicy.reason.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff">$1</strong>');

  const rankColors = ['#ff4f5e','#f5a623','#3db8ff','#7a9ab5'];
  const roiRows = rankedPolicies.map((r, i) => {
    const c = rankColors[i] || '#7a9ab5';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:${c};width:28px;flex-shrink:0">#${r.rank}</div>
      <div style="flex:1">
        <div style="font-weight:600;color:#fff;font-size:13px">${r.icon} ${r.label}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">
          CO₂ saved: <span style="color:var(--green)">${r.co2Saved} t/yr</span> &nbsp;·&nbsp;
          Score gain: <span style="color:var(--blue)">+${r.scoreGain} pts</span> &nbsp;·&nbsp;
          Cost: <span style="color:var(--amber)">₹${fmtK(r.cost)}</span>
        </div>
        <div style="margin-top:6px;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${r.compositeNorm}%;height:100%;background:${c};border-radius:3px;transition:width .8s ease"></div>
        </div>
      </div>
      <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:${c};flex-shrink:0">${r.compositeNorm}<span style="font-size:9px;color:var(--text3)">/100</span></div>
    </div>`;
  }).join('');

  const cg = criticalGap.critical;
  const cgColor = scoreColor(cg.score);
  const costTonTxt   = costPerTon.costPerTon   ? '₹ ' + fmt(costPerTon.costPerTon)    + ' / t CO₂e'    : 'N/A (no policies selected)';
  const costPointTxt = costPerPoint.costPerPoint ? '₹ ' + fmt(costPerPoint.costPerPoint) + ' / score pt' : 'N/A';

  el.innerHTML = `
    <!-- Recommendation Banner -->
    <div style="background:var(--surface);border:2px solid ${bannerColor};border-radius:var(--r);padding:18px 20px;margin-bottom:20px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${bannerColor},transparent 70%)"></div>
      <div style="font-family:var(--mono);font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:10px">🤖 AI RECOMMENDATION</div>
      <div style="font-size:26px;margin-bottom:8px">${bannerIcon}</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.7">${bannerText}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">

      <!-- Policy ROI Ranking -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px">
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:14px">📊 POLICY ROI RANKING</div>
        ${roiRows}
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Critical Gap -->
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px;flex:1">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:14px">🚨 CRITICAL SUSTAINABILITY GAP</div>
          <div style="font-family:var(--display);font-size:18px;font-weight:700;color:#fff;margin-bottom:4px">${cg.label}</div>
          <div style="font-family:var(--mono);font-size:28px;font-weight:700;color:${cgColor};margin-bottom:8px">${cg.score}<span style="font-size:14px;color:var(--text3)">/100</span></div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Gap: <strong style="color:${cgColor}">${cg.gap} pts</strong> &nbsp;·&nbsp; Weight: <strong style="color:#fff">${cg.weight}</strong></div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="width:${cg.score}%;height:100%;background:${cgColor};border-radius:4px;transition:width .8s ease"></div>
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">
            ${criticalGap.allGaps.slice(1).map(g=>`
              <div style="display:flex;align-items:center;gap:8px">
                <div style="font-size:11px;color:var(--text3);width:80px;flex-shrink:0">${g.label}</div>
                <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
                  <div style="width:${g.score}%;height:100%;background:${scoreColor(g.score)};border-radius:2px"></div>
                </div>
                <div style="font-family:var(--mono);font-size:10px;color:var(--text2);width:28px;text-align:right">${g.score}</div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Cost Efficiency -->
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:14px">💸 COST EFFICIENCY</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:1px solid var(--border)">
              <span style="font-size:12px;color:var(--text2)">Cost per ton CO₂ saved</span>
              <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--amber)">${costTonTxt}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:1px solid var(--border)">
              <span style="font-size:12px;color:var(--text2)">Cost per score point gained</span>
              <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--blue)">${costPointTxt}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:12px;color:var(--text2)">Total CO₂ saved vs no-policy</span>
              <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--green)">${costPerTon.co2Saved} t CO₂e</span>
            </div>
          </div>
        </div>

      </div>
    </div>`;
}


/* ══════════════════════════════════════════════════════════════
   SECTION 12 — CHART BUILDER
   ══════════════════════════════════════════════════════════════ */

function mkChart(id, labels, datasets, yLabel) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(d => ({
        label: d.label, data: d.data, borderColor: d.color,
        backgroundColor: d.color + '18', borderDash: d.dash ? [5,4] : [],
        borderWidth: d.dash ? 1.5 : 2.5, pointBackgroundColor: d.color,
        pointRadius: 4, tension: 0.3, fill: !d.dash,
      })),
    },
    options: {
      responsive: true, interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { labels: { color:'#7a9ab5', font:{family:'Syne Mono',size:10}, boxWidth:12 } },
        tooltip: { backgroundColor:'#111820', borderColor:'#1e3045', borderWidth:1, titleColor:'#cde0f0', bodyColor:'#7a9ab5' },
      },
      scales: {
        x: { ticks:{color:'#3d5a73',font:{family:'Syne Mono',size:10}}, grid:{color:'#1e3045'} },
        y: { ticks:{color:'#3d5a73',font:{family:'Syne Mono',size:10}}, grid:{color:'#1e3045'},
             title:{display:true,text:yLabel,color:'#3d5a73',font:{size:10}} },
      },
    },
  });
}


/* ══════════════════════════════════════════════════════════════
   SECTION 13 — AUTOMATED REPORTS
   ══════════════════════════════════════════════════════════════ */

function generateReports(res, noP) {
  const yrs = res.years, last = yrs[yrs.length-1], noPLast = noP.years[noP.years.length-1];
  const active = res.summary.active, bd = last.breakdown;
  const costs = { solar:budget.solarCost, smartEnergy:budget.smartEnergyCost, rainwater:budget.rainwaterCost, compost:budget.compostCost };
  const totalSpent = active.reduce((s,k)=>s+(costs[k]||0),0);

  const baseCarbon = res.summary.baseCarbon, finalCarbon = last.totalCarbon;
  const savedCarbon = +(baseCarbon-finalCarbon).toFixed(2);
  const trend = yrs.map(y=>y.totalCarbon);
  const improving = trend.every((v,i)=>i===0||v<=trend[i-1]);

  const carbonReport = {
    type:'rpt-carbon', icon:'🌫️', label:'Carbon Reduction Summary',
    title: savedCarbon>0 ? `Saving ${savedCarbon} t CO₂e/yr by Year ${SIM_YEARS}` : 'No carbon reduction achieved',
    lines:[
      {key:'Baseline carbon (Year 0)',             val:baseCarbon+' t CO₂e', cls:'b'},
      {key:`Projected carbon (Year ${SIM_YEARS})`, val:finalCarbon+' t CO₂e', cls:finalCarbon<baseCarbon?'g':'r'},
      {key:'Total reduction vs baseline',           val:savedCarbon+' t CO₂e ↓ ('+res.summary.carbonCut+'%)', cls:'g'},
      {key:`Saved vs no-policy (Year ${SIM_YEARS})`,val:+(noPLast.totalCarbon-finalCarbon).toFixed(2)+' t CO₂e ('+pct(noPLast.totalCarbon,finalCarbon)+'%)', cls:'g'},
      {key:'Energy saved vs no-policy',             val:fmtK(+(noP.years[noP.years.length-1].energy-last.energy).toFixed(0))+' kWh/yr', cls:'b'},
      {key:'Water saved vs no-policy',              val:fmtK(Math.round((noP.years[noP.years.length-1].water-last.water)/1000))+' kL/yr', cls:'b'},
      {key:'Growth rates applied',                  val:`Pop ${(GROWTH_RATES.population*100).toFixed(0)}%, Energy ${(GROWTH_RATES.energy*100).toFixed(0)}%, Water ${(GROWTH_RATES.water*100).toFixed(0)}%, Waste ${(GROWTH_RATES.waste*100).toFixed(0)}%`, cls:'b'},
    ],
    note: improving
      ? `Carbon is on a consistent downward trend — policies are overcoming ${(GROWTH_RATES.population*100).toFixed(0)}% annual population growth.`
      : `Carbon is not fully declining. Compound growth is outpacing policy reductions — consider adding more policies.`,
  };

  const allKeys = ['solar','smartEnergy','rainwater','compost'];
  const impacts = {
    solar:{effect:'Reduces grid energy by 40%; adds 40 pts to renewable score'},
    smartEnergy:{effect:'Cuts energy waste by 15%; needed for 100/100 renewable score'},
    rainwater:{effect:'Reduces municipal water dependency by 30%'},
    compost:{effect:'Diverts 80% organic waste; reduces landfill emissions by 35%'},
  };
  const polLines = [];
  allKeys.forEach(k => {
    const on = active.includes(k);
    polLines.push({key:POLICIES[k].icon+' '+POLICIES[k].label, val:on?'✓ Active — ₹'+fmt(costs[k]):'✗ Not selected', cls:on?'g':'r'});
    if(on) polLines.push({key:'   └ Impact',val:impacts[k].effect,cls:'b',small:true});
  });
  const totalMaint = res.years.reduce((s,y)=>s+y.maintThisYear,0);
  const polReport = {
    type:'rpt-policy', icon:'📌', label:'Policy Impact Report',
    title: active.length===0 ? 'No policies selected' : active.length+' of 4 policies active',
    lines:[
      ...polLines,
      {key:'Total capital investment',            val:'₹ '+fmt(totalSpent), cls:'a'},
      {key:`Cumulative maint (${SIM_YEARS} yrs)`, val:'₹ '+fmt(totalMaint)+` (inflated at ${(GROWTH_RATES.inflation*100).toFixed(0)}%/yr)`, cls:'a'},
      {key:'Budget remaining (final year)',        val:'₹ '+fmt(last.budRem), cls:last.budRem>=0?'g':'r'},
      {key:'Cost per ton CO₂e saved',              val:aiRecs?.costPerTon?.costPerTon?'₹ '+fmt(aiRecs.costPerTon.costPerTon):'N/A', cls:'b'},
    ],
    note: active.length===4
      ? `All policies active. Maintenance inflates at ${(GROWTH_RATES.inflation*100).toFixed(0)}%/yr — monitor your remaining budget.`
      : `${4-active.length} policies not yet active. Each addition fights compound demand growth of ${(GROWTH_RATES.population*100).toFixed(0)}%+/yr.`,
  };

  const dimWeights = {carbon:40,water:30,waste:20,renewable:10};
  const gapItems = Object.entries(bd).filter(([,v])=>v.score<100)
    .sort((a,b)=>dimWeights[b[0]]-dimWeights[a[0]])
    .map(([dim,v],i)=>({
      rank:i+1, rankCls:['c1','c2','c3','c3'][i]||'c3',
      dim, label:v.label, score:v.score, weight:v.weight, gap:100-v.score,
      reason: last.reasons.find(r=>r.toLowerCase().includes(dim.replace('renewable','solar'))) || last.reasons[i] || '',
    }));
  const scoreReport = {
    type:'rpt-score', icon:'🎯', label:'Top Reasons to Improve Score',
    title: last.score>=100 ? 'Perfect score achieved!' : `Score is ${last.score}/100 — ${100-last.score} pts gap`,
    gaps: gapItems,
    note: last.score>=100
      ? 'Your campus has achieved a perfect sustainability score across all dimensions.'
      : `Highest-impact fix: ${gapItems[0]?.label||'carbon'} — carries ${gapItems[0]?.weight||'40%'} of total score weight.`,
  };
  return { carbonReport, polReport, scoreReport };
}

function renderReports(res, noP) {
  const { carbonReport, polReport, scoreReport } = generateReports(res, noP);
  function blockHtml(r) {
    const lines = (r.lines||[]).map(l=>`
      <div class="rpt-line" style="${l.small?'padding:3px 0 3px 12px;opacity:.85':''}">
        <span class="rpt-key">${l.key}</span><span class="rpt-val ${l.cls}">${l.val}</span>
      </div>`).join('');
    const gaps = (r.gaps||[]).map(g=>`
      <div class="rpt-reason">
        <span class="rpt-rank ${g.rankCls}">#${g.rank}</span>
        <span><strong style="color:#fff">${g.label}</strong> — currently
          <strong style="color:${g.score>=70?'var(--green)':g.score>=40?'var(--amber)':'var(--red)'}">${g.score}/100</strong>
          (${g.weight} weight, ${g.gap} pts gap)<br>
          <span style="color:var(--text3);font-size:11px">${g.reason}</span>
        </span>
      </div>`).join('');
    return `<div class="report-block ${r.type}">
      <div class="report-head"><span class="report-icon">${r.icon}</span>
        <div><div class="report-label">${r.label}</div><div class="report-title">${r.title}</div></div>
      </div>
      <div class="report-body">${lines}${gaps}</div>
      ${r.note?`<div class="rpt-note">${r.note}</div>`:''}
    </div>`;
  }
  document.getElementById('reportsGrid').innerHTML =
    blockHtml(carbonReport) + blockHtml(polReport) + blockHtml(scoreReport);
}

function downloadReport() {
  if (!simResults.selected) { toast('Run a simulation first'); return; }
  const res = simResults.selected, noP = simResults.nopolicy;
  const { carbonReport, polReport, scoreReport } = generateReports(res, noP);
  const last = res.years[res.years.length-1];
  const now  = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const N='\n', pad=(k,v)=>('  '+k).padEnd(42,' ')+v, sep='-'.repeat(60), bar='='.repeat(60);
  let txt = bar+N+'CAMPUS SUSTAINABILITY SIMULATION REPORT'+N;
  txt += 'Generated  : '+now+N;
  txt += 'Campus     : '+(campus.students+campus.staff)+' people  |  '+SIM_YEARS+'-year projection'+N;
  txt += 'Policies   : '+(res.summary.active.length?res.summary.active.map(k=>POLICIES[k].label).join(', '):'None')+N;
  txt += 'Growth rates: Pop '+((GROWTH_RATES.population)*100).toFixed(0)+'%  Energy '+((GROWTH_RATES.energy)*100).toFixed(0)+'%  Water '+((GROWTH_RATES.water)*100).toFixed(0)+'%  Waste '+((GROWTH_RATES.waste)*100).toFixed(0)+'%  Inflation '+((GROWTH_RATES.inflation)*100).toFixed(0)+'%'+N;
  txt += bar+N+N;
  txt += '1. CARBON REDUCTION SUMMARY'+N+sep+N;
  (carbonReport.lines||[]).forEach(l=>{txt+=pad(l.key,l.val)+N;});
  txt += N+'  NOTE: '+carbonReport.note+N+N;
  txt += '2. POLICY IMPACT REPORT'+N+sep+N;
  (polReport.lines||[]).filter(l=>!l.small).forEach(l=>{txt+=pad(l.key,l.val)+N;});
  txt += N+'  NOTE: '+polReport.note+N+N;
  txt += '3. TOP REASONS TO IMPROVE SCORE'+N+sep+N;
  txt += pad('Overall Score',last.score+' / 100')+N;
  if(scoreReport.gaps.length===0){txt+='  All dimensions at 100/100 — perfect!'+N;}
  else{scoreReport.gaps.forEach(g=>{txt+='  #'+g.rank+'  '+g.label.padEnd(22,' ')+g.score+'/100  ('+g.weight+' weight, '+g.gap+' pts gap)'+N;if(g.reason)txt+='       => '+g.reason+N;});}
  txt+=N;
  if(aiRecs){
    txt+='4. AI RECOMMENDATIONS'+N+sep+N;
    txt+=pad('Best next policy',aiRecs.bestPolicy.recommended?aiRecs.bestPolicy.recommended.label:'None available')+N;
    txt+=pad('Cost per ton CO₂ saved',aiRecs.costPerTon.costPerTon?'₹ '+fmt(aiRecs.costPerTon.costPerTon):'N/A')+N;
    txt+=pad('Cost per score point',aiRecs.costPerPoint.costPerPoint?'₹ '+fmt(aiRecs.costPerPoint.costPerPoint):'N/A')+N;
    txt+=N+'  POLICY ROI RANKING:'+N;
    aiRecs.rankedPolicies.forEach(r=>{txt+='  #'+r.rank+'  '+r.label.padEnd(26,' ')+'CO₂: '+r.co2Saved+'t  Score: +'+r.scoreGain+'pts  ROI: '+r.compositeNorm+'/100'+N;});
    txt+=N;
  }
  txt+=bar+N+'END OF REPORT — Campus Sustainability Simulator v3.0'+N;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
  a.download='sustainability_report.txt'; a.click(); toast('✓ Report downloaded');
}


/* ══════════════════════════════════════════════════════════════
   SECTION 14 — JSON EXPORT
   ══════════════════════════════════════════════════════════════ */

function doExport() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(
    [JSON.stringify({ campus, simYears:SIM_YEARS, growthRates:GROWTH_RATES,
      policies:selected, results:simResults.selected, aiRecommendations:aiRecs }, null, 2)],
    { type:'application/json' }
  ));
  a.download = 'sustainability_simulation.json';
  a.click(); toast('✓ JSON exported');
}


/* ══════════════════════════════════════════════════════════════
   SECTION 15 — UTILITY / FORMAT HELPERS
   ══════════════════════════════════════════════════════════════ */

function kpi(label, value, unit, delta, dCls, barCls) {
  return `<div class="kpi"><div class="kpi-lbl">${label}</div><div class="kpi-val">${value}</div>
    <div class="kpi-unit">${unit}</div>${delta?`<div class="kpi-delta ${dCls}">${delta}</div>`:''}
    <div class="kpi-bar ${barCls}"></div></div>`;
}
function srow(label, s, c) {
  return `<div class="srow"><span class="srow-lbl">${label}</span>
    <div class="srow-track"><div class="srow-fill" style="width:${s}%;background:${c}"></div></div>
    <span class="srow-val">${s}</span></div>`;
}
function scoreColor(s)  { return s>=70?'#00e87a':s>=40?'#f5a623':'#ff4f5e'; }
function scoreLabel(s)  { return s>=70?'🟢 High':s>=40?'🟡 Moderate':'🔴 Low'; }
function pct(base,val)  { return base>0?(((base-val)/base)*100).toFixed(1):'0.0'; }
function fmt(n)         { return Number(n).toLocaleString('en-IN'); }
function fmtK(n)        { return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); }
function g(id)          { return document.getElementById(id).value; }
function toast(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}


/* ══════════════════════════════════════════════════════════════
   SECTION 16 — BOOT
   ══════════════════════════════════════════════════════════════ */

window.addEventListener('load', () => {
  setTimeout(()=>document.getElementById('loader').classList.add('hidden'),1200);
  stampYears(SIM_YEARS);
});