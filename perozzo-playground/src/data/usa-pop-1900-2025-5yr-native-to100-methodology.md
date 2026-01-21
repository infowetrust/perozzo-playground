# Methodology: Expanding Top-Coded Age Buckets to 100+

## Why this was needed

The source dataset is a 5‑year age‑bucket time series for U.S. population (native). In later years, ages are reported through **100+**, but in earlier years the elderly population is **top-coded** into a single open‑ended bucket:

- Some early years end at **75** (meaning **75+**)
- Later early years end at **85** (meaning **85+**)
- Later early years end at **95** (meaning **95+**)
- Later years already include **100** (meaning **100+**)

For modeling purposes, we wanted a consistent set of age buckets for *every* year:

- **0, 5, 10, …, 95, 100 (100 = 100+)**

## Hard constraints we enforced

1) **Do not change any existing age buckets** below the original top-coded bucket for that year.

2) **Do not touch years that already go to 100+** (years where Age=100 exists in the original data).

3) **Mass conservation:** the new split buckets must sum **exactly** to the original top-coded population for that year.

4) **Non-negativity:** all reconstructed buckets must be \>= 0.

## What “Age” means in this dataset

The “Age” column represents the *start* of a 5‑year interval:

- 85 means **85–89** when finer buckets exist
- but in early years where it is the last row, 85 means **85+** (an open-ended top bucket)

Likewise:

- 75 can mean **75+** in very early years
- 95 can mean **95+** in some years
- 100 always means **100+**

## Overview of the approach

We treated each top-coded bucket as a **total mass** to be redistributed into finer bins using **template shares** derived from nearby years where the distribution is observed.

To avoid imposing modern longevity patterns on early decades, we used a **hierarchical (stepwise) split**:

- Split **75+** into 75–79, 80–84, 85+
- Split **85+** into 85–89, 90–94, 95+
- Split **95+** into 95–99, 100+

and we **only** used template years that are the **closest later years** where each split is directly observable.

## Template-year rule (closest 3 later years)

For each split, we used the **closest 3 later years** that contain the required bins.

### Template A: splitting 75+
Used for years that end at 75+.

- **Template years:** 1940, 1945, 1950
- **Provides:** (75–79, 80–84, 85+) composition within 75+

### Template B: splitting 85+
Used for years that end at 85+ (and also inside the reconstructed 85+ from Template A).

- **Template years:** 1980, 1985, 1990
- **Provides:** (85–89, 90–94, 95+) composition within 85+

### Template C: splitting 95+
Used for years that end at 95+ (and also inside the reconstructed 95+ from Template B).

- **Template years:** 1990, 1995, 2000
- **Provides:** (95–99, 100+) composition within 95+

## How template shares were computed

For each template year and split, we computed **within-top-bucket shares**, then averaged across the three template years.

Example: for the 85+ split in a given template year:

- Let \(T_{85+} = Pop(85) + Pop(90) + Pop(95+)\)
- Shares are:
  - \(s_{85} = Pop(85) / T_{85+}\)
  - \(s_{90} = Pop(90) / T_{85+}\)
  - \(s_{95+} = Pop(95+) / T_{85+}\)

When a template year already has Age=100 (100+), we defined:

- \(Pop(95+) = Pop(95) + Pop(100)\)

After averaging, we normalized shares to sum to 1.

### The actual averaged shares used

These are the mean shares computed from the dataset (averaged across the template years listed above):

- **75+ template (1940/1945/1950):**
  - 75–79 (Age=75): **0.5629986**
  - 80–84 (Age=80): **0.2923138**
  - 85+ (Age=85+ internal mass): **0.1446876**

- **85+ template (1980/1985/1990):**
  - 85–89 (Age=85): **0.6800439**
  - 90–94 (Age=90): **0.2533943**
  - 95+ (Age=95+ internal mass): **0.0665617**

- **95+ template (1990/1995/2000):**
  - 95–99 (Age=95): **0.8488685**
  - 100+ (Age=100): **0.1511315**

## How each year was modified

We only modified years where the original data was top-coded below 100.

### Case 1: years ending at 95+ (1980 and 1985)

Original top-coded bucket:

- Age=95 means **95+**

Replacement:

- Age=95 becomes **95–99**
- New Age=100 is **100+**

Allocation uses Template C.

### Case 2: years ending at 85+ (1940–1975)

Original top-coded bucket:

- Age=85 means **85+**

Replacement:

- Age=85 becomes **85–89**
- New Age=90 becomes **90–94**
- New Age=95 becomes **95–99**
- New Age=100 becomes **100+**

Allocation is hierarchical:

1) Use Template B to allocate the original 85+ mass into (85–89, 90–94, 95+).
2) Use Template C to split the allocated 95+ into (95–99, 100+).

### Case 3: years ending at 75+ (1900–1935)

Original top-coded bucket:

- Age=75 means **75+**

Replacement:

- Age=75 becomes **75–79**
- New Age=80 becomes **80–84**
- New Age=85 becomes **85–89**
- New Age=90 becomes **90–94**
- New Age=95 becomes **95–99**
- New Age=100 becomes **100+**

Allocation is hierarchical:

1) Use Template A to allocate the original 75+ mass into (75–79, 80–84, 85+).
2) Use Template B to split the allocated 85+ into (85–89, 90–94, 95+).
3) Use Template C to split the allocated 95+ into (95–99, 100+).

### Case 4: years already including Age=100 (1990+)

No changes were made.

## Integer rounding (to preserve totals exactly)

Template shares produce decimals; the input dataset uses integer counts.

We converted reconstructed values back to integers using a **largest-remainder method**:

1) Compute each new bucket as a decimal.
2) Take the floor of each value.
3) Compute the leftover remainder needed to match the original total.
4) Add +1 to the buckets with the largest fractional parts until the sum matches exactly.

This guarantees that the sum of the reconstructed buckets equals the original top-coded bucket **exactly** for every modified year.

## Status column handling

The dataset includes a `Status` value (e.g., `estimate`, `projection`).

For newly created age buckets within a year, we copied the year’s existing `Status` (equivalently, copied from the original top-coded row), keeping the dataset consistent within each year.

## Validation and auditing

We produced an audit file that records, for each modified year:

- the original top-coded bucket value
- the reconstructed split values (75/80/85/90/95/100 as applicable)
- a checksum difference (should be 0)

Additionally, we verified:

- All ages below the original top-coded bucket are unchanged.
- Years with existing Age=100 are unchanged.
- Each year now has a complete age grid through 100.

## Output files

- `usa-pop-1900-2025-5yr-native-to100.csv` — the transformed dataset (all years go to 100+).
- `usa-pop-1900-2025-5yr-native-to100-audit.csv` — audit/checksum summary for modified years.

## Notes and limitations

- This is a **shape-borrowing** method, not a full mortality model. It assumes that the *within-top-bucket distribution* in the closest later years is a reasonable proxy for earlier years.
- Choosing the **closest 3 later years** for each split reduces the risk of importing modern longevity patterns into early decades.
- If needed, the methodology can be adapted (e.g., different template windows, weighted averages, or a parametric tail), but this version prioritizes simplicity, reproducibility, and minimizing unintended changes.
