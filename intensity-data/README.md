# Satellite Intensity SI-2

This experimental estimator combines real CPU-trained boosted regression trees, an SSEC single-image eye-scene baseline and a separate published CKZ consistency check. It is an independent implementation, not GHOST or an official analysis. No vision transformer is included.

## Reproduction

Run `node scripts/train-satellite-intensity.mjs` from the repository root (Node 22+). The script reads the included NOAA IBTrACS snapshots and public CIMSS ADT text archives, cached in the ignored `.cache/intensity-training/` directory. No McFETCH key or paid compute is required for training. Outputs:

- `tree-model.json`: actual fitted trees, feature domain, source references, data digest and season splits.
- `benchmark.json`: source availability, all validation trials, selection criterion and withheld-season errors.
- `.cache/intensity-training/examples-v2.jsonl`: feature/label audit, observation timestamps, ADT versions and source URLs.

`node scripts/check-satellite-intensity-cases.mjs` reproduces `case-checks.json` after the three calibrated native peak scans have been cached under `.cache/intensity-training/native/`. It loads the unchanged published SI-1 model from git commit `9565fa4` for the before comparison and records native-file hashes. These three reported problem cases are **development checks in training seasons**, not an independent accuracy sample.

## Predictors and training

The twelve predictors are eye temperature, cloud temperature, absolute latitude, eye/cloud contrast, Atlantic-vs-East-Pacific basin, the image-derived Raw T diagnostic, an IR structural-radius regression and its availability flag, six-hour cloud/eye/Raw-T changes and a history-availability flag. Final T, CI, best-track/recon wind and observed central pressure are never inference inputs. No storm-name or identity feature is used.

Thermal history uses the latest regular-eye observation at or **before** the six-hour lag, with at most 90 minutes of extra age. The endpoint returns only the timestamp and three thermal measurements. It does not send the archived intensity analysis into the trained model. Training includes explicit missing-history examples, so an archive outage does not require switching to the stronger single-image baseline.

IR structure follows SSEC's four-direction -45.15 C crossing retrieval and its empirical radius regression (`2.8068 + 0.8361 × eye radius`). Our additional conservative three-pixel resolution check leaves poorly resolved eyes missing. This is an internal image predictor, **not a measured RMW**. The displayed cold-cloud ring is also never labeled RMW. Source: [SSEC Data.java](https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Data.java).

Wind and pressure trees learn residual corrections to empirical SSEC eye-scene wind and Brown et al. (2006) Atlantic wind-pressure priors. They are empirical regressions, not a first-principles atmosphere model. The optional CKZ cross-check remains separate, with **EP = POCI** and no +2 mb adjustment. [Brown et al.](https://ams.confex.com/ams/pdfpapers/107190.pdf)

Regular EYE scenes are sampled at most once per storm-hour. Total training weight is balanced by storm. Entire seasons are separate: training **2013-2021 and 2025**, optional bias calibration **2022**, model selection **2023**, retrospective test **2024**. Since training includes 2025, the 2024 result is a **withheld-season retrospective comparison, not a chronological operational hindcast**. Depth 3/4, 100/200/300 trees, ordinary/doubled strong-storm weighting, correction scale and optional bias are selected using 2023 MAE plus 0.35 times the MAE for reference winds ≥130 kt. Bias candidates are fitted only on 2022. The selected wind and pressure members both use 200 depth-3 trees, ordinary weighting and no extra bias. The 2024 season is never used for fitting or candidate selection.

## Evaluation and limits

The withheld 2024 archive benchmark has 333 hourly frames from 13 storms. SI-2 wind MAE is **7.58 kt** and pressure MAE **7.06 mb**; the published SI-1 values were 10.18 kt and 9.50 mb. On 78 frames with reference wind ≥130 kt, wind MAE is **9.82 kt**, bias **-8.76 kt**, and pressure MAE **11.02 mb**, bias **+6.20 mb**. Strong-storm underestimation remains. This release is an improvement, not a claim of maximum possible accuracy.

Labels are IBTrACS USA best-track one-minute winds and central pressure, interpolated only across gaps ≤6 hours. They are **not independently verified aircraft surface winds**; best track can incorporate satellite analysis. Benchmark inputs are archived CIMSS measurements, while website estimates sample calibrated native pixels locally. Different satellites, centering and resolution introduce additional differences. These errors are not calibrated uncertainty intervals for individual website estimates.

The three development checks use unchanged real peak-time pixels. Winds change from 161.2→174.7 kt for Patricia (reference 185), 128.5→140.7 kt for Humberto (140), and 176.0→167.6 kt for Melissa (165). Pressure comparisons use the wind-peak record, rather than substituting a lifetime pressure minimum. See `case-checks.json` for exact values, time offsets, feature vectors and missing-history results. Patricia remains underestimated.

Domain gates restrict fitted trees to Atlantic/Eastern Pacific regular-eye scenes. A 10% training-span neighborhood permits small native/archive measurement differences instead of causing abrupt method jumps at a numerical boundary. Far-outside scenes use the explicitly labeled baseline; failed/non-eye scenes produce no estimate. Special pinhole/large-eye settings do not use the trees. Flights shown for comparison retain flight-level winds; those are not treated as surface truth. Recon pressure matches require a maximum 90-minute offset and never change the estimate.

`patricia-2015.json.gz` is a real calibrated SSEC McFETCH subset used by existing Dvorak tests and the page's demonstration. It is a training/development case. No generated cyclone imagery is used. SST and shear remain optional live context, not trained features.

Sources: [CIMSS](https://tropic.ssec.wisc.edu/) · [SSEC McFETCH](https://mcfetch.ssec.wisc.edu/) · [NOAA IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) · [Courtney & Knaff (2009)](https://rammb2.cira.colostate.edu/wp-content/uploads/2024/07/CourtneyKnaff_2009.pdf)
