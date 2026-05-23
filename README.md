# SOIL Moderno

Calculadora web del **Hidrograma SCS** (Soil Conservation Service) para cálculo de crecientes. Versión moderna y autocontenida del programa original `SOIL83F.BAS`.

## Uso

Solo abre `SOIL_moderno.html` en cualquier navegador moderno. No requiere instalación, ni servidor, ni conexión a internet — Chart.js y ExcelJS vienen embebidos en el archivo.

## Características

- **Método SCS** para hidrogramas de escurrimiento — réplica fiel del algoritmo original en `SOIL83F.BAS`
- **Calculadora de Tiempo de Concentración** con 8 fórmulas: Kirpich, Kerby-Hathaway, Izzard, onda cinemática, Bransby-Williams, FAA, TR-55 (NRCS) y Témez. Calcula automáticamente las fórmulas para las que existen datos suficientes, con advertencias de rango de validez.
- **Múltiples períodos de retorno** simultáneos, con gráfica comparativa
- **30+ distribuciones de lluvia** preconfiguradas (ACUBUGA, AMAIME, BUITRERA, etc.)
- **Unidades flexibles** — área en km² o hectáreas
- **Exportación a Excel** con formato profesional, multi-hoja y gráfica embebida
- **Exportación a PDF** vía el diálogo de impresión del navegador

## Estructura del repositorio

- `SOIL_moderno.html` — archivo activo (originalmente v0.3)
- `archive/` — versiones históricas (v0.1, v0.2) conservadas como referencia previa al uso de git

## Crédito

Elaborado por Sebastián Barrientos.

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
