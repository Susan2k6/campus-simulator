// ── Baseline campus constants ──
const BASELINE = {
    dailyEnergyKWh: 18000,
    dailyWaterLiters: 500000,
    dailyWasteTons: 3,
    organicWasteFraction: 0.60,
    emissionFactorElectricity: 0.82, // kg CO2 per kWh
    emissionFactorOrganicWaste: 0.25, // tons CO2e per ton organic waste
    totalBudget: 50000000,
    simulationYears: 5,
  };
  
  // Annual baseline (daily × 365)
  const ANNUAL_BASELINE = {
    energyKWh:   BASELINE.dailyEnergyKWh   * 365,
    waterLiters: BASELINE.dailyWaterLiters * 365,
    wasteTons:   BASELINE.dailyWasteTons   * 365,
  };
  
  // Policy definitions with costs and reduction values
  const POLICIES = {
    solar:       { cost: 20000000, gridEnergyReduction: 0.30 },
    smartEnergy: { cost: 7000000,  totalEnergyReduction: 0.15 },
    rainwater:   { cost: 10000000, waterDependencyReduction: 0.25 },
    compost:     { cost: 8000000,  organicEmissionReduction: 0.70 },
  };
  
  // Annual growth rates
  const GROWTH = {
    energy: 0.03,
    water:  0.02,
    waste:  0.02,
  };
  
  // Deducts selected policy costs from total budget
  function calculateBudgetAfterPolicies(selectedPolicies) {
    let remaining = BASELINE.totalBudget;
    for (const [key, isSelected] of Object.entries(selectedPolicies)) {
      if (isSelected && POLICIES[key]) remaining -= POLICIES[key].cost;
    }
    return remaining;
  }
  
  // Returns energy and waste carbon in metric tons CO2e
  function calculateCarbon(annualEnergyKWh, annualOrganicWasteTons, compostActive) {
    const energyCarbon = (annualEnergyKWh * BASELINE.emissionFactorElectricity) / 1000;
  
    const organicMultiplier = compostActive
      ? (1 - POLICIES.compost.organicEmissionReduction)
      : 1;
    const wasteCarbon = annualOrganicWasteTons * BASELINE.emissionFactorOrganicWaste * organicMultiplier;
  
    return {
      energyCarbon: +energyCarbon.toFixed(2),
      wasteCarbon:  +wasteCarbon.toFixed(2),
      totalCarbon:  +(energyCarbon + wasteCarbon).toFixed(2),
    };
  }
  
  // Scores the year 0–100 against its BAU baseline
  // Weights: carbon 40%, water 30%, waste 20%, renewable 10%
  function calculateSustainabilityScore(simData, bauData, solarActive) {
    const carbonScore = Math.max(0, (bauData.totalCarbon - simData.totalCarbon) / bauData.totalCarbon) * 100;
    const waterScore  = Math.max(0, (bauData.waterUsage  - simData.waterUsage)  / bauData.waterUsage)  * 100;
    const wasteScore  = Math.max(0, (bauData.wasteCarbon - simData.wasteCarbon) / bauData.wasteCarbon) * 100;
    const renewScore  = solarActive ? 100 : 0;
  
    const total = carbonScore * 0.40 + waterScore * 0.30 + wasteScore * 0.20 + renewScore * 0.10;
    return +Math.min(100, Math.max(0, total)).toFixed(1);
  }
  
  // Main simulation — returns 5-year results array
  function simulateCampus(policies = {}) {
    const selected = {
      solar:       !!policies.solar,
      smartEnergy: !!policies.smartEnergy,
      rainwater:   !!policies.rainwater,
      compost:     !!policies.compost,
    };
  
    const budgetRemaining = calculateBudgetAfterPolicies(selected);
  
    if (budgetRemaining < 0) {
      console.warn(`Budget exceeded by ₹${Math.abs(budgetRemaining).toLocaleString("en-IN")}`);
    }
  
    const results = [];
  
    for (let year = 1; year <= BASELINE.simulationYears; year++) {
      // BAU values after annual growth
      const bauEnergy  = ANNUAL_BASELINE.energyKWh   * Math.pow(1 + GROWTH.energy, year - 1);
      const bauWater   = ANNUAL_BASELINE.waterLiters  * Math.pow(1 + GROWTH.water,  year - 1);
      const bauWaste   = ANNUAL_BASELINE.wasteTons    * Math.pow(1 + GROWTH.waste,  year - 1);
      const bauOrganic = bauWaste * BASELINE.organicWasteFraction;
  
      // BAU carbon for scoring
      const bauCarbon = calculateCarbon(bauEnergy, bauOrganic, false);
  
      // Apply policy reductions
      let simEnergy = bauEnergy;
      if (selected.smartEnergy) simEnergy *= (1 - POLICIES.smartEnergy.totalEnergyReduction);
  
      let gridEnergy = simEnergy;
      if (selected.solar) gridEnergy *= (1 - POLICIES.solar.gridEnergyReduction);
  
      let simWater = bauWater;
      if (selected.rainwater) simWater *= (1 - POLICIES.rainwater.waterDependencyReduction);
  
      const carbon = calculateCarbon(gridEnergy, bauOrganic, selected.compost);
  
      const score = calculateSustainabilityScore(
        { totalCarbon: carbon.totalCarbon, wasteCarbon: carbon.wasteCarbon, waterUsage: simWater },
        { totalCarbon: bauCarbon.totalCarbon, wasteCarbon: bauCarbon.wasteCarbon, waterUsage: bauWater },
        selected.solar
      );
  
      results.push({
        year,
        energyUsage:         +simEnergy.toFixed(0),
        gridEnergyUsage:     +gridEnergy.toFixed(0),
        waterUsage:          +simWater.toFixed(0),
        wasteGenerated:      +bauWaste.toFixed(2),
        energyCarbon:        carbon.energyCarbon,
        wasteCarbon:         carbon.wasteCarbon,
        totalCarbon:         carbon.totalCarbon,
        budgetRemaining:     +budgetRemaining.toFixed(0),
        sustainabilityScore: score,
      });
    }
  
    return results;
  }
  
  // Returns a summary of selected policies and budget impact
  function getPolicySummary(policies = {}) {
    let totalCost = 0;
    const selected = [];
  
    for (const [key, isActive] of Object.entries(policies)) {
      if (isActive && POLICIES[key]) {
        selected.push({ key, cost: POLICIES[key].cost });
        totalCost += POLICIES[key].cost;
      }
    }
  
    return {
      selectedPolicies: selected,
      totalCost,
      budgetAllocated:  BASELINE.totalBudget,
      budgetRemaining:  BASELINE.totalBudget - totalCost,
      withinBudget:     totalCost <= BASELINE.totalBudget,
    };
  }
  export { simulateCampus, getPolicySummary, BASELINE, POLICIES, GROWTH };

