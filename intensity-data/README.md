# Satellite Intensity SI-1

This is an independent experimental implementation, not GHOST, and is not an official analysis. It includes a real CPU-trained boosted-tree wind and pressure member, an SSEC single-image eye-scene baseline, and an optional published CKZ wind-pressure cross-check. There is no trained vision transformer in this release.

## Reproduce the model

From the repository root, run `node scripts/train-satellite-intensity.mjs` (Node 22+). The script reads the existing NOAA IBTrACS snapshots and downloads public CIMSS ADT archives, caching the latter in the ignored `.cache/intensity-training/` directory. No McFETCH access key or paid service is needed for training. It writes:

- `tree-model.json`: fitted regression trees, empirical priors, feature domain, data hash and season splits.
- `benchmark.json`: source availability and held-out error metrics.
- `.cache/intensity-training/examples.jsonl`: per-example feature/label audit with source URLs and ADT versions.

Wind and pressure models learn residual corrections to an empirical eye-scene wind prior and the Brown et al. (2006) all-Atlantic wind–pressure fit. These are **empirical priors**, not a first-principles atmosphere model. The pressure prior is part of the trained regression; the optional CKZ calculation remains a separate consistency check. Brown et al.: https://ams.confex.com/ams/pdfpapers/107190.pdf

Features are eye temperature, mean-cloud temperature, absolute latitude, eye/cloud contrast and Atlantic-vs-East-Pacific basin. They contain no official/recon intensity. Training uses regular-eye scenes, at most one frame per storm-hour, with equal total weight per storm. Entire seasons are separated: training 2013–2016, 2018–2022; selection 2023; evaluation 2024. Thirty, sixty and one hundred trees at depth two or three are compared on 2023 only. Selection flags are frozen before computing the 2024 report. The 2024 set is a reserved evaluation season, not a claim of independently blinded operational verification.

Labels are IBTrACS USA best-track one-minute wind/central pressure, linearly interpolated across gaps no longer than six hours. They are **not independent aircraft-verified surface winds**. Satellite information can contribute to best track. Benchmark features are CIMSS archived temperature measurements; applying the trained member to locally sampled pixels introduces additional measurement and centering differences. Published errors must be described as archive best-track benchmark errors, never as calibrated uncertainty for a particular scan.

Model bounds and basin/scene gates prevent unvalidated extrapolation. A failed eye scene produces no estimate. Neither a satellite cloud ring nor an eye diameter is called RMW. Flight-level winds in the recon comparison remain flight-level winds. Central-pressure matchup uses an explicit maximum 90-minute offset, prints both timestamps, and never changes the satellite estimate.

`patricia-2015.json.gz` is a small real calibrated SSEC McFETCH infrared subset also used by the repository’s Dvorak tests. It is a demonstration and training-season case, not a held-out accuracy example. No generated cyclone imagery is used.

SST and shear are displayed as available live environmental context, but are not trained predictors in SI-1. Adding environmental predictors or a ViT requires a matched training dataset and another whole-storm/season evaluation. Model outputs are not changed to match user expectations or known storm names.

Sources: https://tropic.ssec.wisc.edu/ · https://mcfetch.ssec.wisc.edu/ · https://www.ncei.noaa.gov/products/international-best-track-archive · https://rammb2.cira.colostate.edu/wp-content/uploads/2024/07/CourtneyKnaff_2009.pdf
