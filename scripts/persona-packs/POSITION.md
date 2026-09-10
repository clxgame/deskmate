# Optional default position (YUME 0.3.7+)

Place a `placement.json` beside a persona's `persona.md` in `public/personas/<id>`:

```json
{ "anchor": "drawing-center", "x": 0.5, "y": 0.8 }
```

`pack-personas.ts` validates this file and writes it to the corresponding
`pack.json` persona entry as `defaultPosition`. The installed manifest is the
runtime source of truth. Omit the file for the existing generic placement.

Both ratios must be finite numbers from 0 through 1. Unknown properties and
anchor modes are rejected. The anchor is the center of the nominal drawing
frame, excluding GIF animation envelope padding. Coordinates are relative to
the current monitor's work area; the primary monitor is the fallback.
Transparent envelope padding may extend outside the work area. The drawing
anchor remains inside it, including on monitors with negative coordinates.

Startup priority: existing global `petPosition`, then the selected installed
persona's `defaultPosition`, then YUME's bottom-right placement. Updating a pack
does not replace a saved position. Old packs without the field remain supported.
GIF envelope resizing preserves the drawing anchor after startup.

Xiaoxiongchong 1.2.0 captures window origin (2208, 1166), physical size 480x280,
work area (0, 0, 2560, 1390), nominal drawing width 200, and bottom padding
16.51376146788994. Its drawing center is (2448, 1329.48623853211), giving ratios
(0.95625, 0.9564649198072734). This intentionally preserves the original visual
placement rather than pulling the transparent window fully into the work area.
