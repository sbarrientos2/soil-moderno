# CLAUDE.md

Project-specific guidance for Claude when working in this repo.

## What this is

`SOIL_moderno.html` is a single-file, offline web port of `SOIL83F.BAS` — an SCS-method runoff hydrograph calculator used in Colombian hydrology engineering. The user (Sebastian) develops it; his **father is the end user and the domain authority**. Feature requests typically arrive as "my dad says X" — treat those as real engineering reports from a domain expert, not casual asks. Default to **Spanish for UI strings** and user-facing text; English is fine for code identifiers and most comments.

## Reading the HTML file (important)

`SOIL_moderno.html` is ~1.3MB because Chart.js and ExcelJS are embedded inline. This is deliberate — the tool must run fully offline. **Reading the whole file fails the 256KB / 25K-token limit.** Always use `offset`/`limit`, or grep for an anchor first.

Useful anchors (`grep -n`):
- Embedded libraries: lines ~7–76 — **do not reformat, do not modify, do not extract to CDN**
- `<style>` block: starts ~line 77 ; search `@media print` for the PDF stylesheet
- Embedded data (`SOIL_HAD`, `RAINFALL_DISTS`, `TC_FORMULAS`): search `const SOIL_HAD`
- Core algorithm: search `function computeHydrograph`
- UI bootstrap: search `function init`
- Excel export: search `async function downloadExcel`

## Versioning and structure

- Active file: `SOIL_moderno.html` (single source of truth — no new `v0.4.html`, etc.)
- `archive/SOIL_moderno_v0.1.html`, `v0.2.html`: pre-git history. Do not edit.
- `index.html`: meta-refresh stub for the Pages root URL. No logic belongs there.
- Git is the version history going forward.

## Invariants that exist for a reason

- `computeHydrograph` clamps flow with `Math.max(0, ...)` — negative caudal is physically impossible. Don't remove.
- The calculation core works in SI (m, m/m, km², mm). Unit conversions happen at the formula boundary inside `TC_FORMULAS[].compute`, not in the convolution loop.
- The `@media print` block **is** the entire PDF export pipeline. No `jsPDF`, no `html2canvas` — rasterization was deliberately rejected to keep output as vector text and avoid bundle bloat.

## Workflow

- Commit small fixes directly to `main`; branch for risky or speculative changes.
- Local repo identity: `Sebastian Barrientos <sebastianbarrientosa@gmail.com>`. The machine's global git config is `criptocbas` (a different GitHub account) — don't push without confirming `gh auth status` shows `sbarrientos2` active.
- GitHub Pages auto-deploys `main` to https://sbarrientos2.github.io/soil-moderno/ in ~30s after each push.

## Verification

**Automated tests cover the math core only.** Run `node tests/run.js` from the repo root — it extracts the code between `TEST-CORE-START`/`END` sentinels in `SOIL_moderno.html`, evaluates it in a Node `vm` sandbox, and runs property-based assertions on `computeHydrograph`, `interpolate`, `TC_FORMULAS`, and `CN_CATALOG`. No dependencies, no `package.json`. Don't fabricate "expected" numbers — the tests check mathematical invariants (caudal ≥ 0, PE ≤ PM, higher CN → higher Qmax, etc.). When you have values validated by the domain expert, add them to the `REFERENCE_CASES` array at the bottom of `tests/run.js`.

**UI/chart/Excel/print still need manual browser verification:**
1. Fill in the form, hit *Calcular Hidrograma* — chart and tables should render.
2. Hit *Descargar Excel* — open the file, confirm the chart image and detail table look right.
3. Hit *Guardar como PDF* (or Ctrl/Cmd+P) — in the print preview, confirm the *Tabla detallada* shows **all** rows (not a truncated screenshot) and column headers repeat across pages.
4. If editing dual-CN mode: also tick *Comparar con condición futura*, repeat the above with two CNs.
