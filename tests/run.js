// =============================================================================
// SOIL Moderno — pruebas de propiedades para el núcleo matemático
// =============================================================================
//
// Uso:  node tests/run.js   (desde la raíz del repo)
//
// Estas pruebas NO comparan contra valores de referencia "verdaderos" (no los
// tenemos sin validación del experto). En lugar de eso verifican propiedades
// matemáticas que deben cumplirse SIEMPRE — el caudal nunca es negativo, la
// precipitación efectiva no puede exceder la precipitación total, mayor CN
// implica mayor caudal pico, etc. Si una fórmula se rompe en una refactori-
// zación, al menos una propiedad debería fallar.
//
// Cuando tengas valores validados por el experto, agrégalos en la sección
// REFERENCE-CASES más abajo.
//
// El runner extrae el código entre marcadores TEST-CORE-START/END de
// SOIL_moderno.html y lo evalúa en un sandbox de Node — así las pruebas
// corren contra el código real desplegado, sin duplicar nada.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 1. Extraer el código testeable del HTML
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "..", "SOIL_moderno.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

const SENTINEL_RE = /\/\/\s*=+\s*TEST-CORE-START\s*=+\s*\n([\s\S]*?)\n\s*\/\/\s*=+\s*TEST-CORE-END\s*=+/g;
const blocks = [];
let m;
while ((m = SENTINEL_RE.exec(html)) !== null) blocks.push(m[1]);

if (blocks.length === 0) {
  console.error("ERROR: no se encontraron bloques TEST-CORE-START/END en SOIL_moderno.html");
  process.exit(2);
}

// Las declaraciones `const`/`let` dentro de `vm.runInContext` NO se exponen
// como propiedades del sandbox (sólo `var` y function declarations). Por eso
// envolvemos en una IIFE que retorna explícitamente los bindings que
// necesitamos.
const wrappedCode = `
  (function () {
    ${blocks.join("\n\n")}
    return { SOIL_HAD, RAINFALL_DISTS, TC_FORMULAS, CN_CATALOG, interpolate, computeHydrograph };
  })();
`;

let exports;
try {
  exports = vm.runInContext(wrappedCode, vm.createContext({}));
} catch (e) {
  console.error("ERROR al evaluar el código extraído:", e);
  process.exit(2);
}

const { SOIL_HAD, RAINFALL_DISTS, TC_FORMULAS, CN_CATALOG, interpolate, computeHydrograph } = exports;

// ---------------------------------------------------------------------------
// 2. Mini framework de pruebas
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}\n`);
  }
}

function group(label, fn) {
  console.log(`\n${label}`);
  fn();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertNear(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) {
    throw new Error((msg || "values not near") + ` — got ${a}, expected ≈ ${b} (±${eps})`);
  }
}

// Caso base reutilizable — cuenca de tamaño medio, valores típicos.
function baseInputs(overrides = {}) {
  return {
    area: 25.5,                          // km²
    CN: 75,
    Tc: 1.2,                             // hrs
    rainMax: 3,                          // hrs
    FRR: 1,
    FSS: 1,
    Pmax: 100,                           // mm
    unitHydro: SOIL_HAD,
    rainDist: RAINFALL_DISTS["BUITRERA"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 3. Pruebas de interpolate
// ---------------------------------------------------------------------------

group("interpolate()", () => {
  const pts = [[0, 0], [1, 10], [2, 30], [3, 60]];

  test("retorna y exacto en un x tabulado", () => {
    assertNear(interpolate(pts, 1), 10, 1e-9);
    assertNear(interpolate(pts, 2), 30, 1e-9);
  });

  test("interpola linealmente entre dos puntos", () => {
    // entre (1,10) y (2,30): en x=1.5 debe dar 20
    assertNear(interpolate(pts, 1.5), 20, 1e-9);
    // entre (2,30) y (3,60): en x=2.5 debe dar 45
    assertNear(interpolate(pts, 2.5), 45, 1e-9);
  });

  test("devuelve 0 más allá del último punto", () => {
    assertNear(interpolate(pts, 10), 0, 1e-9);
  });

  test("es determinista (mismo input → mismo output)", () => {
    const a = interpolate(pts, 1.7);
    const b = interpolate(pts, 1.7);
    assert(a === b, "interpolate no es determinista");
  });
});

// ---------------------------------------------------------------------------
// 4. Pruebas de computeHydrograph — invariantes físicos / matemáticos
// ---------------------------------------------------------------------------

group("computeHydrograph() — invariantes", () => {
  test("ningún caudal es negativo (clamp físico)", () => {
    const r = computeHydrograph(baseInputs());
    for (const q of r.flows) assert(q >= 0, `caudal negativo encontrado: ${q}`);
  });

  test("PE ≤ PM (la lluvia efectiva no puede exceder la total)", () => {
    const r = computeHydrograph(baseInputs());
    assert(r.PE <= r.PM + 1e-9, `PE=${r.PE} > PM=${r.PM}`);
  });

  test("Qmax > 0 para una lluvia razonable", () => {
    const r = computeHydrograph(baseInputs());
    assert(r.Qmax > 0, `Qmax esperado > 0, obtuve ${r.Qmax}`);
  });

  test("TP, QP, TD, SZ son todos positivos", () => {
    const r = computeHydrograph(baseInputs());
    assert(r.TP > 0, "TP no es positivo");
    assert(r.QP > 0, "QP no es positivo");
    assert(r.TD > 0, "TD no es positivo");
    assert(r.SZ > 0, "SZ no es positivo");
  });

  test("times es monótonamente creciente y misma longitud que flows", () => {
    const r = computeHydrograph(baseInputs());
    assert(r.times.length === r.flows.length, "times/flows con longitud distinta");
    for (let i = 1; i < r.times.length; i++) {
      assert(r.times[i] > r.times[i - 1], `times no creciente en i=${i}`);
    }
  });

  test("Vol ≈ Σ(flows) · TD · 3600", () => {
    const r = computeHydrograph(baseInputs());
    const sumFlows = r.flows.reduce((a, b) => a + b, 0);
    const expectedVol = sumFlows * r.TD * 3600;
    assertNear(r.Vol, expectedVol, 1e-3, "Volumen no coincide con la integral de Q·dt");
  });

  test("es determinista (mismos inputs → mismos outputs)", () => {
    const r1 = computeHydrograph(baseInputs());
    const r2 = computeHydrograph(baseInputs());
    assertNear(r1.Qmax, r2.Qmax, 1e-12, "Qmax cambia entre corridas");
    assertNear(r1.PE,   r2.PE,   1e-12, "PE cambia entre corridas");
    assertNear(r1.Vol,  r2.Vol,  1e-12, "Vol cambia entre corridas");
  });
});

group("computeHydrograph() — monotonicidad y casos límite", () => {
  test("mayor CN → mayor Qmax (cuenca más impermeable produce más pico)", () => {
    const low  = computeHydrograph(baseInputs({ CN: 60 }));
    const mid  = computeHydrograph(baseInputs({ CN: 75 }));
    const high = computeHydrograph(baseInputs({ CN: 90 }));
    assert(low.Qmax < mid.Qmax,  `Qmax no monótono: CN60=${low.Qmax} ≥ CN75=${mid.Qmax}`);
    assert(mid.Qmax < high.Qmax, `Qmax no monótono: CN75=${mid.Qmax} ≥ CN90=${high.Qmax}`);
  });

  test("mayor CN → mayor PE (más escurrimiento)", () => {
    const low  = computeHydrograph(baseInputs({ CN: 60 }));
    const high = computeHydrograph(baseInputs({ CN: 90 }));
    assert(low.PE < high.PE, `PE no monótono: CN60→${low.PE}, CN90→${high.PE}`);
  });

  test("mayor área → mayor Qmax y mayor Volumen", () => {
    const small = computeHydrograph(baseInputs({ area: 10 }));
    const big   = computeHydrograph(baseInputs({ area: 50 }));
    assert(small.Qmax < big.Qmax, "Qmax no crece con el área");
    assert(small.Vol  < big.Vol,  "Volumen no crece con el área");
  });

  test("mayor Pmax → mayor Qmax (más lluvia, más caudal)", () => {
    const dry = computeHydrograph(baseInputs({ Pmax: 50 }));
    const wet = computeHydrograph(baseInputs({ Pmax: 150 }));
    assert(dry.Qmax < wet.Qmax, "Qmax no crece con Pmax");
  });

  test("CN = 100 (impermeable total) → PE ≈ PM", () => {
    const r = computeHydrograph(baseInputs({ CN: 100, Pmax: 100 }));
    // SZ = (1000/100) - 10 = 0; PE = PM cuando SZ=0
    assertNear(r.PE, r.PM, 1e-6, "CN=100 debería dar PE = PM");
  });

  test("CN muy bajo + lluvia pequeña → PE = 0 (todo se infiltra)", () => {
    // CN=40, Pmax=10mm: SZ = (1000/40)-10 = 15 pulg = 381mm; 0.2*SZ ≈ 76mm
    // → 10mm de lluvia es mucho menor que la abstracción inicial → PE = 0
    const r = computeHydrograph(baseInputs({ CN: 40, Pmax: 10 }));
    assertNear(r.PE, 0, 1e-9, "PE debería ser 0 cuando la lluvia es menor que la abstracción inicial");
  });

  test("FRR=0 anula la lluvia efectiva", () => {
    const r = computeHydrograph(baseInputs({ FRR: 0 }));
    assertNear(r.PM, 0, 1e-9, "PM debería ser 0 con FRR=0");
    assertNear(r.PE, 0, 1e-9, "PE debería ser 0 con FRR=0");
    assertNear(r.Qmax, 0, 1e-9, "Qmax debería ser 0 con FRR=0");
  });
});

// ---------------------------------------------------------------------------
// 5. Pruebas de las fórmulas de Tiempo de Concentración
// ---------------------------------------------------------------------------

group("TC_FORMULAS — entradas válidas", () => {
  // Cada fórmula tiene su propio rango de validez (Izzard y TR-55 son para
  // flujo superficial muy corto; Témez es para cuencas medianas/grandes;
  // etc.). Usamos inputs apropiados por fórmula en vez de un único set
  // genérico, porque éste sería inválido para algunas.
  const inputsPerFormula = {
    kirpich:   { L: 1500, S: 0.020 },
    kerby:     { L: 150,  S: 0.020, N_kerby: 0.40 },     // flujo corto
    izzard:    { L: 50,   S: 0.020, cr_izzard: 0.046, i: 50 },  // muy corto, pavimento
    kinematic: { L: 200,  S: 0.020, n: 0.035, i: 50 },
    bransby:   { L: 2000, S: 0.020, A: 25.5 },
    faa:       { L: 800,  S: 0.020, C: 0.70 },
    tr55:      { L: 25,   S: 0.020, n: 0.035, P2: 75 },  // sheet flow L≤30m
    temez:     { L: 2000, S: 0.020 },                     // cuenca mediana
  };

  for (const f of TC_FORMULAS) {
    const inp = inputsPerFormula[f.id];
    if (!inp) continue;
    test(`${f.id} retorna un valor positivo finito en su rango de validez`, () => {
      const tc = f.compute(inp);
      assert(tc !== null && isFinite(tc) && tc > 0,
        `${f.id} devolvió ${tc} con inputs ${JSON.stringify(inp)}`);
    });
  }

  test("todas las fórmulas son deterministas", () => {
    for (const f of TC_FORMULAS) {
      const inp = inputsPerFormula[f.id];
      if (!inp) continue;
      const a = f.compute(inp);
      const b = f.compute(inp);
      assert(a === b, `${f.id} no es determinista`);
    }
  });
});

group("TC_FORMULAS — fuera de rango documentado", () => {
  test("Izzard devuelve null cuando i·L ≥ 500 (en unidades inglesas)", () => {
    const izzard = TC_FORMULAS.find(f => f.id === "izzard");
    // i_in * Lft >= 500 → i*0.0393701 * L*3.28084 ≥ 500 → i*L (SI) ≥ ~3870
    const r = izzard.compute({ L: 5000, S: 0.02, cr_izzard: 0.046, i: 200 });
    assert(r === null, "Izzard debería devolver null fuera de rango");
  });

  test("FAA devuelve null cuando C ≥ 1.1", () => {
    const faa = TC_FORMULAS.find(f => f.id === "faa");
    const r = faa.compute({ L: 1500, S: 0.02, C: 1.2 });
    assert(r === null, "FAA debería devolver null con C ≥ 1.1");
  });
});

group("TC_FORMULAS — coherencia entre fórmulas", () => {
  test("Kirpich y Témez (mismas L y S) están en el mismo orden de magnitud", () => {
    // Ambas dependen sólo de L y S, así que para una cuenca típica deben
    // dar resultados comparables (no necesariamente iguales, pero sí dentro
    // del mismo orden de magnitud).
    const inputs = { L: 2000, S: 0.03 };
    const kirpich = TC_FORMULAS.find(f => f.id === "kirpich").compute(inputs);
    const temez   = TC_FORMULAS.find(f => f.id === "temez").compute(inputs);
    const ratio = Math.max(kirpich, temez) / Math.min(kirpich, temez);
    assert(ratio < 10, `Kirpich (${kirpich}) y Témez (${temez}) difieren en más de un orden de magnitud (ratio ${ratio.toFixed(2)})`);
  });
});

// ---------------------------------------------------------------------------
// 6. Pruebas del catálogo CN
// ---------------------------------------------------------------------------

group("CN_CATALOG — integridad", () => {
  test("cada fila tiene exactamente 4 valores (grupos A, B, C, D)", () => {
    for (const row of CN_CATALOG) {
      assert(Array.isArray(row.values) && row.values.length === 4,
        `Fila "${row.name}" no tiene 4 valores`);
    }
  });

  test("todos los CN están en [1, 100]", () => {
    for (const row of CN_CATALOG) {
      for (const v of row.values) {
        assert(Number.isFinite(v) && v >= 1 && v <= 100,
          `CN inválido ${v} en "${row.name}"`);
      }
    }
  });

  test("los CN crecen de A a D (peor drenaje → más escurrimiento)", () => {
    for (const row of CN_CATALOG) {
      const [a, b, c, d] = row.values;
      assert(a <= b && b <= c && c <= d,
        `CN no monótono A→D en "${row.name}": [${row.values.join(", ")}]`);
    }
  });

  test("todas las filas tienen nombre y grupo no vacíos", () => {
    for (const row of CN_CATALOG) {
      assert(row.name && row.name.length > 0, "fila sin nombre");
      assert(row.group && row.group.length > 0, `fila "${row.name}" sin grupo`);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. REFERENCE-CASES — placeholders para casos validados por el experto
// ---------------------------------------------------------------------------
//
// Cuando trabajes con tu papá y tengas cálculos de los que confíe el resultado,
// agrégalos aquí. Ejemplo del formato:
//
//   {
//     label: "Caso validado por E.B. 2026-06-15: Río Cauca - Puente La Balsa",
//     inputs: { area: 30, CN: 78, Tc: 1.5, rainMax: 3, FRR: 1, FSS: 1, Pmax: 110, dll: "BUITRERA" },
//     expect: { Qmax: 0, PE: 0, Vol: 0 },  // <-- valores que dio el papá
//     tol:    { Qmax: 0.5, PE: 1, Vol: 1000 },  // <-- tolerancia aceptable
//   },

const REFERENCE_CASES = [
  // (vacío por ahora — agregar casos aquí cuando estén validados)
];

if (REFERENCE_CASES.length > 0) {
  group("Casos de referencia validados", () => {
    for (const c of REFERENCE_CASES) {
      test(c.label, () => {
        const r = computeHydrograph({
          ...c.inputs,
          unitHydro: SOIL_HAD,
          rainDist: RAINFALL_DISTS[c.inputs.dll],
        });
        if (c.expect.Qmax !== undefined) assertNear(r.Qmax, c.expect.Qmax, c.tol.Qmax, "Qmax");
        if (c.expect.PE   !== undefined) assertNear(r.PE,   c.expect.PE,   c.tol.PE,   "PE");
        if (c.expect.Vol  !== undefined) assertNear(r.Vol,  c.expect.Vol,  c.tol.Vol,  "Vol");
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 8. Resumen final
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(50)}`);
if (failed === 0) {
  console.log(`\x1b[32m✓ Todas las pruebas pasaron\x1b[0m  (${passed}/${passed})`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✗ ${failed} prueba(s) fallaron\x1b[0m  (${passed} pasaron, ${failed} fallaron)`);
  process.exit(1);
}
