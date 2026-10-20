/* Custom contextual model. Only HOUSE_DOD_WINDS uses published FR12 bounds.
   Source: https://www.depts.ttu.edu/nwi/Pubs/FScale/EFScale.pdf (Appendix A-3).
   The other anchors, support weights, response scale, and range are site rules. */
(() => {
  'use strict';
  const CEILING = 260;
  const RESPONSE_SCALE = 85;
  const HOUSE_DOD_WINDS = Object.freeze({
    1: Object.freeze({ lb: 53, exp: 65, ub: 80 }),
    2: Object.freeze({ lb: 63, exp: 79, ub: 97 }),
    3: Object.freeze({ lb: 79, exp: 96, ub: 114 }),
    4: Object.freeze({ lb: 81, exp: 97, ub: 116 }),
    5: Object.freeze({ lb: 103, exp: 121, ub: 141 }),
    6: Object.freeze({ lb: 104, exp: 122, ub: 142 }),
    7: Object.freeze({ lb: 113, exp: 132, ub: 153 }),
    8: Object.freeze({ lb: 127, exp: 152, ub: 178 }),
    9: Object.freeze({ lb: 142, exp: 170, ub: 198 }),
    10: Object.freeze({ lb: 165, exp: 200, ub: 220 })
  });
  const clamp = (min, max, value) => Math.min(max, Math.max(min, value));
  const number = (value, fallback = 0) => value === '' || value == null || !Number.isFinite(Number(value)) ? fallback : Number(value);
  function scoreMultiplier(score, penalty, bonus) {
    const value = clamp(1, 10, number(score, 5));
    return value < 5 ? 1 - (5 - value) / 4 * penalty : 1 + (value - 5) / 5 * bonus;
  }
  function calculate(input = {}) {
    const house = HOUSE_DOD_WINDS[input.structDod]?.[input.structBound || 'lb'] || 0;
    const anchor = (level, adjustment = 0) => number(level) > 0 ? clamp(40, 220, number(level) + number(adjustment)) : 0;
    const indicators = [
      { name: 'House', value: house },
      { name: 'Trees', value: anchor(input.treeDamage, input.treeType) },
      { name: 'Ground', value: anchor(input.scouring) },
      { name: 'Vehicles', value: anchor(input.vehicleDi, input.vehicleMass) }
    ];
    const available = indicators.filter(item => item.value > 0);
    if (!available.length) return { hasEvidence: false, indicators };
    const base = Math.max(...available.map(item => item.value));
    // Remove exactly one leading indicator; matching indicators still corroborate it.
    // This stays continuous when an indicator overtakes the current maximum.
    const support = 0.04 * Math.max(0, available.reduce((sum, item) => sum + Math.max(0, item.value - 100), 0) - Math.max(0, base - 100));
    const context = clamp(0, 18, number(input.xSparse)) + clamp(0, 15, number(input.xDebris)) + clamp(0, 16, number(input.xContinuity));
    const calculation = clamp(0, 21, number(input.calcSupport));
    const documentation = clamp(1, 10, number(input.documentationScore, 5));
    const certainty = clamp(1, 10, number(input.certaintyScore, 5));
    const confidenceParts = [
      { name: 'Documentation', multiplier: scoreMultiplier(documentation, 0.06, 0.032) },
      { name: 'Radar', multiplier: scoreMultiplier(input.radarScore, 0.02, 0.026) },
      { name: 'Environment', multiplier: scoreMultiplier(input.environmentScore, 0.025, 0.03) },
      { name: 'Certainty', multiplier: scoreMultiplier(certainty, 0.09, 0.018) }
    ];
    const confidence = confidenceParts.reduce((product, part) => product * part.multiplier, 1);
    const budget = (support + context + calculation) * confidence;
    const headroom = CEILING - base;
    // A single smooth curve replaces the old threshold penalties and stacked boosts.
    // For fixed support, its slope with respect to the base is exp(-budget / 85) > 0.
    const boost = headroom * -Math.expm1(-budget / RESPONSE_SCALE);
    const estimate = base + boost;
    // This is a model sensitivity band, not a statistical confidence interval.
    const spread = 4.5 + 0.75 * (20 - documentation - certainty);
    return {
      hasEvidence: true, indicators, base,
      leaders: available.filter(item => item.value === base).map(item => item.name),
      support, context, calculation, confidence, confidenceParts, budget, headroom, boost, estimate, spread,
      low: Math.max(40, estimate - spread),
      high: Math.min(CEILING, estimate + spread)
    };
  }
  const api = Object.freeze({ calculate, HOUSE_DOD_WINDS, CEILING, RESPONSE_SCALE });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.TornadoEstimateModel = api;
})();
