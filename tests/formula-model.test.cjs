// Run with: node --test tests/formula-model.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, HOUSE_DOD_WINDS, CEILING } = require('../formula-model.js');

test('house bounds use the published FR12 values', () => {
  assert.deepEqual(HOUSE_DOD_WINDS[1], { lb: 53, exp: 65, ub: 80 });
  assert.deepEqual(HOUSE_DOD_WINDS[5], { lb: 103, exp: 121, ub: 141 });
  assert.deepEqual(HOUSE_DOD_WINDS[9], { lb: 142, exp: 170, ub: 198 });
  assert.deepEqual(HOUSE_DOD_WINDS[10], { lb: 165, exp: 200, ub: 220 });
});

test('missing indicators cannot become a wind estimate through contextual points', () => {
  assert.equal(calculate().hasEvidence, false);
  assert.equal(calculate({ xSparse: 18, xDebris: 15, xContinuity: 16, calcSupport: 21 }).hasEvidence, false);
  assert.equal(calculate({ treeType: 5, vehicleMass: 10 }).hasEvidence, false);
  const rural = calculate({ treeDamage: 165 });
  assert.equal(rural.hasEvidence, true);
  assert.equal(rural.estimate, 165);
});

test('confidence changes support without multiplying the base wind speed', () => {
  for (const score of [1, 5, 10]) {
    const result = calculate({ structDod: 10, structBound: 'exp', documentationScore: score, radarScore: score, environmentScore: score, certaintyScore: score });
    assert.equal(result.base, 200);
    assert.equal(result.estimate, 200);
  }
  const weak = calculate({ treeDamage: 165, xDebris: 15, documentationScore: 1, certaintyScore: 1 });
  const strong = calculate({ treeDamage: 165, xDebris: 15, documentationScore: 10, certaintyScore: 10 });
  assert.ok(strong.boost > weak.boost);
  assert.ok(strong.spread < weak.spread);
});

test('matching indicators count and overtaking the leader is continuous', () => {
  const single = calculate({ treeDamage: 165 });
  const tied = calculate({ treeDamage: 165, vehicleDi: 165 });
  assert.equal(tied.support, 2.6);
  assert.ok(tied.estimate > single.estimate);
  const below = calculate({ treeDamage: 165, vehicleDi: 164.999999 });
  const above = calculate({ treeDamage: 165, vehicleDi: 165.000001 });
  assert.ok(above.estimate >= below.estimate);
  assert.ok(above.estimate - below.estimate < 0.00001);
});

test('stronger inputs never reduce an estimate and every range contains its estimate', () => {
  const options = {
    structDod: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    structBound: ['lb', 'exp', 'ub'], treeDamage: [0, 115, 140, 165, 185, 205],
    treeType: [-5, 0, 5], scouring: [0, 135, 160, 185, 210],
    vehicleDi: [0, 115, 145, 170, 195, 215], vehicleMass: [-5, 0, 5, 10],
    xSparse: [0, 5, 11, 18], xDebris: [0, 4, 9, 15], xContinuity: [0, 5, 10, 16],
    calcSupport: [0, 4, 9, 15, 21], documentationScore: [1, 5, 10],
    radarScore: [1, 5, 10], environmentScore: [1, 5, 10], certaintyScore: [1, 5, 10]
  };
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let sample = 0; sample < 1000; sample++) {
    const input = Object.fromEntries(Object.entries(options).map(([key, values]) => [key, values[Math.floor(random() * values.length)]]));
    for (const [key, values] of Object.entries(options)) {
      let previous = -Infinity;
      for (const value of values) {
        const result = calculate({ ...input, [key]: value });
        if (!result.hasEvidence) continue;
        assert.ok(Number.isFinite(result.estimate));
        assert.ok(result.estimate >= previous - 1e-9, `${key}=${value}: ${result.estimate} < ${previous}`);
        assert.ok(result.base <= result.estimate && result.estimate < CEILING);
        assert.ok(result.low <= result.estimate && result.estimate <= result.high);
        assert.ok(result.low >= 40 && result.high <= CEILING);
        previous = result.estimate;
      }
    }
  }
});

test('high-end support and invalid numeric inputs remain finite', () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, 'bad', '']) {
    const result = calculate({ structDod: 10, xDebris: value, documentationScore: value });
    assert.ok(Number.isFinite(result.estimate));
  }
  const maximum = calculate({ structDod: 10, structBound: 'ub', treeDamage: 205, treeType: 5, scouring: 210, vehicleDi: 215, vehicleMass: 10, xSparse: 18, xDebris: 15, xContinuity: 16, calcSupport: 21, documentationScore: 10, radarScore: 10, environmentScore: 10, certaintyScore: 10 });
  assert.ok(maximum.estimate > 230 && maximum.estimate < CEILING);
  assert.ok(maximum.high >= maximum.estimate);
});
