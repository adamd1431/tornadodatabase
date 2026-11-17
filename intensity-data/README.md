# Satellite Intensity SI-3

This experimental estimator combines real CPU-trained boosted regression trees, an SSEC single-image eye-scene baseline and a separate published CKZ consistency check. It is an independent implementation, not GHOST or an official analysis. No vision transformer is included.

## Reproduction

Run `node scripts/train-satellite-intensity.mjs` from the repository root (Node 22+). The script reads the included NOAA IBTrACS snapshots and public CIMSS ADT text archives, cached in the ignored `.cache/intensity-training/` directory. No McFETCH key or paid compute is required for training. Outputs:

- `tree-model.json`: actual fitted trees, feature domain, source references, data digest and season splits.
- `benchmark.json`: source availability, all validation trials, selection criterion and withheld-season errors.
- `.cache/intensity-training/examples-v2.jsonl`: feature/label audit, observation timestamps, ADT versions and source URLs.

`node scripts/check-satellite-intensity-cases.mjs` reproduces `case-checks.json` after the three calibrated native peak scans have been cached under `.cache/intensity-training/native/`. It loads the unchanged published SI-1 model from git commit `9565fa4` for the before comparison and records native-file hashes. These three reported problem cases are **development checks in training seasons**, not an independent accuracy sample.

`native-training.json` contains 64 native-image feature/label pairs from the three hourly development windows. Raw grids remain in the ignored local cache. Labels are time-matched IBTrACS values, including interpolation only within six-hour gaps. Each entry records its source and cached-scan digest. The three storms are already training-season storms; none enters the 2024 test.

The wrapper runs archive training followed by `train-satellite-intensity-native.mjs`. The native stage tests relative native-example weights of 1, 2 or 4 and 100/200/300 depth-3 trees, with an optional bias fitted only on 2022. It retains SI-2 unless both the 2023 overall MAE and the predeclared strong-storm objective improve. The selected SI-3 wind member has 100 trees and native weight 2; pressure has 200 trees and native weight 4. Neither uses an added bias.

`node scripts/check-satellite-intensity-hourly.mjs --fetch --publish` checks every requested hour in each development window, caches calibrated grids locally, reads current approved owner estimates, and publishes `hourly-checks.json`. Repeating without `--fetch` uses the cached images. Typed arrays are restored before analysis and preserved as arrays in new caches. `prepare-intensity-native.mjs` derives the compact native training file from these observations.

## Predictors and training

The twelve predictors are eye temperature, cloud temperature, absolute latitude, eye/cloud contrast, Atlantic-vs-East-Pacific basin, the image-derived Raw T diagnostic, an IR structural-radius regression and its availability flag, six-hour cloud/eye/Raw-T changes and a history-availability flag. Final T, CI, best-track/recon wind and observed central pressure are never inference inputs. No storm-name or identity feature is used.

Thermal history uses the latest regular-eye observation at or **before** the six-hour lag, with at most 90 minutes of extra age. The endpoint returns only the timestamp and three thermal measurements. It does not send the archived intensity analysis into the trained model. Training includes explicit missing-history examples, so an archive outage does not require switching to the stronger single-image baseline.

IR structure follows SSEC's four-direction -45.15 C crossing retrieval and its empirical radius regression (`2.8068 + 0.8361 × eye radius`). Our additional conservative three-pixel resolution check leaves poorly resolved eyes missing. This is an internal image predictor, **not a measured RMW**. The displayed cold-cloud ring is also never labeled RMW. Source: [SSEC Data.java](https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Data.java).

Wind and pressure trees learn residual corrections to empirical SSEC eye-scene wind and Brown et al. (2006) Atlantic wind-pressure priors. They are empirical regressions, not a first-principles atmosphere model. The optional CKZ cross-check remains separate, with **EP = POCI** and no +2 mb adjustment. [Brown et al.](https://ams.confex.com/ams/pdfpapers/107190.pdf)

Regular EYE scenes are sampled at most once per storm-hour. Total training weight is balanced by storm. Entire seasons are separate: training **2013-2021 and 2025**, optional bias calibration **2022**, model selection **2023**, retrospective test **2024**. Since training includes 2025, the 2024 result is a **withheld-season retrospective comparison, not a chronological operational hindcast**. Depth 3/4, 100/200/300 trees, ordinary/doubled strong-storm weighting, correction scale and optional bias are selected using 2023 MAE plus 0.35 times the MAE for reference winds ≥130 kt. Bias candidates are fitted only on 2022. The archive stage selects 200 depth-3 trees for each member; the native stage then selects the final SI-3 members described above. The 2024 season is never used for fitting or candidate selection.

## Evaluation and limits

The withheld 2024 archive benchmark has 333 hourly frames from 13 storms. SI-3 wind MAE is **7.29 kt** and pressure MAE **6.70 mb**, compared with SI-2's 7.58 kt and 7.06 mb. On 78 frames with reference wind ≥130 kt, wind MAE is **9.73 kt**, bias **-9.21 kt**, and pressure MAE **9.42 mb**, bias **+4.98 mb**. Strong-storm wind underestimation remains. This release is an improvement, not a claim of maximum possible accuracy.

Labels are IBTrACS USA best-track one-minute winds and central pressure, interpolated only across gaps ≤6 hours. They are **not independently verified aircraft surface winds**; best track can incorporate satellite analysis. Benchmark inputs are archived CIMSS measurements, while website estimates sample calibrated native pixels locally. Different satellites, centering and resolution introduce additional differences. These errors are not calibrated uncertainty intervals for individual website estimates.

The primary development comparison now uses **the owner's saved website peak estimates**. Those are personal reference estimates, not independently measured ground truth and not per-hour labels. The hourly search selects the greatest modeled wind and lowest modeled pressure independently, without reading the target values. The two extrema can occur at different times. Exact name/year matching prevents importing another season or an ambiguous cyclone.

The three ±12-hour development searches checked 75 requested hours and accepted 64 distinct clear-eye scans. SI-3 wind maxima are 177.9 kt (Patricia, 07Z), 140.4 kt (Humberto, 21:00:19Z) and 170.0 kt (Melissa, 11:00:20Z). Their independently selected pressure minima are 874.2, 917.9 and 886.4 mb. Owner targets at extraction were 217.1/171.9/194.8 mph and 870.5/914.3/890.0 mb respectively. Patricia and Humberto winds remain underestimated against those targets. `case-checks.json` retains fixed best-track-time diagnostics; `hourly-checks.json` is the primary owner-peak comparison.

The page's **Find hourly peak** checks each hour around the selected time. If a selected extremum lies at the available sequence edge, it extends in that direction, up to ±24 hours. It deduplicates actual acquisition times, records rejected scenes, supports cancellation and opens the strongest accepted wind image after completion. Search-window limits and boundary peaks are disclosed; the strongest available image in a window is not guaranteed to be the true lifetime maximum. Peak comparisons and all hourly rows are included in the analysis export.

Domain gates restrict fitted trees to Atlantic/Eastern Pacific regular-eye scenes. A 10% training-span neighborhood permits small native/archive measurement differences instead of causing abrupt method jumps at a numerical boundary. Far-outside scenes use the explicitly labeled baseline; failed/non-eye scenes produce no estimate. Special pinhole/large-eye settings do not use the trees. Flights shown for comparison retain flight-level winds; those are not treated as surface truth. Recon pressure matches require a maximum 90-minute offset and never change the estimate.

`patricia-2015.json.gz` is a real calibrated SSEC McFETCH subset used by existing Dvorak tests and the page's demonstration. It is a training/development case. No generated cyclone imagery is used. SST and shear remain optional live context, not trained features.

Sources: [CIMSS](https://tropic.ssec.wisc.edu/) · [SSEC McFETCH](https://mcfetch.ssec.wisc.edu/) · [NOAA IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) · [Courtney & Knaff (2009)](https://rammb2.cira.colostate.edu/wp-content/uploads/2024/07/CourtneyKnaff_2009.pdf)
