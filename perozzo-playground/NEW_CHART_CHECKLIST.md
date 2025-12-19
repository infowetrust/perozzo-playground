New Chart Checklist

A short, repeatable process for adding a new plate-style chart (print-worthy SVG + web interaction) with minimal thrash.

0) Start with a one-page spec

Create specs/<chart-id>.md (or a note in your system) before coding.

Use this template:

Chart ID
	•	chart-id:
	•	Source plate / reference image:
	•	Dataset:
	•	Output targets: (SVG export, web embed, print)

Data
	•	Input files:
	•	Axes meaning:
	•	X axis (e.g., year):
	•	Y axis (e.g., age / percentile / …):
	•	Z/value axis (e.g., survivors / income / …):
	•	Units and domain:
	•	X range:
	•	Y range:
	•	Z range:
	•	Step assumptions:
	•	uniform steps? yes/no
	•	step sizes:

Plate layers

List what should render and in what order:
	1.	Architecture

	•	floor lines:
	•	right wall:
	•	back-wall isolines:
	•	frame rectangles:

	2.	Surface

	•	surface quads:
	•	shaded relief: on/off; params

	3.	Data lines

	•	years:
	•	ages:
	•	cohorts:
	•	value isolines:

	4.	Labels

	•	title block text:
	•	age labels:
	•	value labels:
	•	year labels:

	5.	Interaction

	•	hover gating:
	•	hover marker:
	•	tooltip copy:

Style knobs
	•	projection preset:
	•	line widths/opacities:
	•	shading knobs (ambient/diffuse/steps/gamma/bias/inkColor/alphaMax):
	•	typography (font family/size/weight):

Acceptance checks
	•	“Looks like plate”: (what to compare)
	•	SVG export sanity:
	•	Tooltip correctness:
	•	Performance: (hover feels responsive)

Once this spec exists, then code.

⸻

1) Add the dataset
	•	Add CSV (or JSON) under src/data/<chart-id>/...
	•	Confirm it parses into the same “tidy rows” shape used by the system.

Acceptance:
	•	data loads without runtime errors.

2) Regenerate contours (if needed)
	•	Run contour build step for this dataset.
	•	Verify endpoints reach the intended boundary (no renderer hacks).

Acceptance:
	•	contour JSON contains year and age points (and multiple runs per level if gaps exist).

3) Choose projection preset and lock it
	•	Start from levasseur (or your chosen preset).
	•	Tune only:
	•	basis angles (rare)
	•	scales (year/age/value)
	•	origin offsets

Acceptance:
	•	axis directions match reference plate.

4) Wire architecture layers
	•	Floor lines
	•	Back-wall isolines
	•	Right wall (if used)
	•	Frame rectangles (if used)

Acceptance:
	•	everything aligns in shared Frame3D space.

5) Wire surface + shading
	•	Confirm surface quads render
	•	Confirm shaded relief uses shared shading controls
	•	Verify no plane “wins” unintentionally (use alphaScale)

Acceptance:
	•	surface reads as continuous sheet; shading is plate-like, not CGI.

6) Wire data lines
	•	Values (green), ages (gray), years (red), cohorts (blue)
	•	Confirm opacities and widths follow global constants

Acceptance:
	•	hierarchy reads cleanly at a glance.

7) Wire labels
	•	Title block
	•	Age/value/year labels
	•	Use shared AXIS_LABEL_STYLE + AXIS_LABEL_LAYOUT

Acceptance:
	•	labels don’t collide; color teaches the encoding.

8) Wire interaction
	•	Hover gate (silhouette + margin)
	•	Nearest-point selection (with threshold)
	•	Tooltip copy reads like a statement

Acceptance:
	•	hover works slightly outside the sheet, never in empty canvas.
	•	tooltip values match data.

9) Export SVG
	•	Confirm export button works
	•	Confirm exported SVG contains meaningful group ids:
	•	layer-architecture, layer-surface, layer-lines, layer-labels, layer-interaction

Acceptance:
	•	open in Illustrator: layers are intelligible, no missing assets.

10) Ship to charts.infowetrust.com
	•	Embed chart component with showUI={false}
	•	Verify layout, fonts, and performance

Acceptance:
	•	page loads cleanly, tooltip works, SVG export still works in dev build.

⸻

“Intentional spec” habit

Before any coding session, write 5–10 bullets answering:
	•	What layer am I changing?
	•	What’s the single source of truth for geometry? (Frame3D)
	•	What knobs should control it?
	•	What’s the acceptance check screenshot?

If you can’t write those bullets, don’t code yet.