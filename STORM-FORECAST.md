# Tropical cyclone forecast: calibrated consensus V2

The Live Storms Forecast Lab uses a frozen, retrospectively tested guidance calibration. It is not a new numerical weather prediction model. Satellite imagery and displayed environmental fields remain diagnostics. Official forecasts are displayed alongside it.

## Held-out results

The experiment collected 205 storm IDs in six ATCF basins. After final-agency, tropical-status and guidance-coverage checks, 197 distinct IBTrACS SIDs contributed 13,217 forecast–lead pairs at 12, 24, 48, 72, 96 and 120 hours. Two untouched test sets contributed 59 storms and 3,568 pairs.

| Test set | Storms / pairs | Track MAE, km: previous → V2 | Wind MAE, kt: previous → V2 | Pressure MAE, hPa: previous → V2 |
| --- | --- | --- | --- | --- |
| 2024 global whole-storm holdout | 27 / 1,699 | 136.27 → 135.05 | 13.99 → 11.83 | 10.25 → 9.01 |
| 2025 final NHC / CPHC temporal test | 32 / 1,869 | 95.41 → 95.41 | 16.13 → 10.80 | 11.84 → 8.71 |

Wind and pressure improvement on the global holdout was 15.4% and 12.1%. Their 95% whole-storm bootstrap intervals were 7.7–23.6% and 4.6–19.2%. Track improvement was only 0.9%, with an interval of −5.3–8.1%; meaningful track skill improvement is not established. The NHC-region track failed the predeclared validation gate and keeps the original method.

Official forecasts remain the reference. On identical 2025 cases, official track MAE was 88.92 km versus 95.41 km, and official wind MAE was 10.30 kt versus 10.80 kt. NHC-region V2 intensity can itself use official guidance, so its comparison is not an independent competition. Official pressure forecasts are not available in the sample. Results are not a guarantee of future skill, particularly rapid intensification.

[Interactive results, all horizons and source downloads](storm-forecast-validation.html) · [Full aggregate report](forecast-study/backtest-report.json).

## Inputs and availability

Initialization uses the archived operational CARQ analysis, with OFCL/JTWC/WRNG analysis fallback. Final best-track values never enter the predictors. Verification uses final IBTrACS USA agency fields at native six-hour synoptic fixes; provisional agency rows and interpolated three-hour fixes are excluded. Wind is one-minute maximum sustained wind in knots. Pressure is in hPa, often estimated rather than measured.

Nominal issue time is analysis +3h. A raw model cycle needs a conservative six-hour availability delay, and an early/interpolated/consensus cycle needs three hours. Cycles later than initialization, older than 24h, or with remote initial track centers are excluded. Model records are interpolated over gaps no longer than 24h, without extrapolating tails. Separate eligible cycles may supply a family's track, wind and pressure. Wind-only guidance cannot create a fictitious track at 0°N, 0°E.

Live inference uses the same native analysis and nominal cutoff as the backtest. The native analysis can precede the public advisory by up to three hours. If a nearby, consistent native analysis is unavailable, the page explicitly returns the uncalibrated baseline instead. Unknown initial pressure stays unknown. Environmental cache IDs include the resulting path, frozen model identity and guidance values.

Archive cycle stamps cannot reconstruct actual publication times or late revisions. This is a retrospective archive evaluation, not exact prospective operational verification. The conservative delays reduce but cannot eliminate this limitation. Historical model versions differ from the current systems.

## Calibration and split

V1 is the original equal-weight change consensus from GFS/GEFS, HAFS, ECMWF, UKMET, Canadian and NAVGEM. Its comparison uses the same availability constraints as V2. V2 candidates also include HWRF, HMON, COAMPS-TC, LGEM, Decay-SHIPS, CHIPS, operational track/intensity consensus and, in the NHC region, official guidance. Consensus inputs overlap and are not independent members.

* Training: eligible 2023 storms.
* Validation: eligible 2024 storms outside the global holdout.
* Global holdout: 2024 SIDs whose SHA-256 first byte is at least 192, with at least one SID per available basin. Assigned before error analysis.
* Temporal holdout: final 2025 NHC / CPHC storms. Final 2025 JTWC records were not yet in the NOAA snapshot, so no 2025 global claim is made.

All aliases of one SID stay in one split. The coverage-based amendment reserving 2024 global test storms was made before computing errors. Frozen assignments and the original protocol are retained in `forecast-study/protocol-v2.json`. Its general refit wording is implemented as training + validation only: the 2024 global holdout is always excluded.

For each region, target and tested lead, the correction is:

`V2 = V1 + sum(w_family × (adjusted_family − V1)) + bounded_bias + optional_past_tendency`

Weights are nonnegative and sum to at most one. Missing-family corrections are zero, returning that weight to V1. Candidates use constant, 48h or 96h initial-bias decay, ridge 0.03 or 0.3, constrained bias (±100 km per axis or ±10 kt/hPa), and optional causal 12h intensity tendency. Two robust fitting passes reduce outlier influence. Training weights each storm equally. Candidate selection averages storm-weighted MAE ratios equally over leads; a target must improve at least 2% on validation to be promoted.

Selected hyperparameters were refit using training + validation only. Coefficients were frozen before test evaluation. The deployed model matches Python inference to numerical precision at every tested lead in both regions. Six-hour display steps interpolate coefficients; the initial point is exact. Wind and pressure are forecast separately, not inverted through a pressure–wind relationship.

Metrics include MAE, RMSE, signed intensity bias and storm-weighted MAE. The UI's aggregate MAE weights forecast–lead pairs equally. Comparators use identical available cases. Paired 95% intervals use 1,000 bootstrap resamples of whole SIDs. Valid future fixes must remain tropical or subtropical; post-dissipation and extratropical performance is not measured. Validation rows exported after refitting are in-sample and must not be presented as additional held-out results.

Member ranges show model disagreement, not calibrated probability intervals. No rapid-intensification probability, calibrated cone, explicit inner-core cycle or coupled ocean simulation is produced. LGEM/SHIPS/CHIPS provide established environmental guidance; the separately displayed GFS shear, humidity, 500-hPa flow and ocean samples do not directly adjust V2.

## Reproduction and local data

Run from the website repository with Node and Python + NumPy. Store the study directory outside the deployable repository. The committed source manifest records the exact source URLs, retrieval dates and retained-content checksums; upstream archives can change after that snapshot.

```text
python scripts/collect-forecast-study.py --output <external-study-directory>
node scripts/extract-forecast-study.mjs --data <external-study-directory>
python scripts/fit-forecast-study.py --data <external-study-directory>
python scripts/fit-forecast-study.py --data <external-study-directory> --evaluate-test
python scripts/publish-forecast-study.py --data <external-study-directory>
node scripts/verify-forecast-runtime.mjs --data <external-study-directory>
node --test --test-reporter=dot
```

Extraction applies the committed fixed SID assignments and fails on new/unassigned storms. Training refuses to overwrite a frozen experiment. Evaluation checks model SHA-256 and case SHA-256 and never refits. The local study retains compact guidance, case-level paired errors and verification records. The website deploys only small coefficients, aggregate scores and provenance; no raw model grids or full case dataset are added to Supabase or website hosting.

Frozen model SHA-256: `285e016e9dd83e849f84ecac7fbd480a90d2952f640d0e47db04a2ca7040fb5a`.

## Primary references

* [NOAA IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) and [data change log](https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/doc/IBTrACS_v04r01_change_log.txt).
* [NHC annual ATCF archives](https://ftp.nhc.noaa.gov/atcf/archive/) and [technique definitions](https://ftp.nhc.noaa.gov/atcf/docs/nhc_techlist.dat).
* [NCAR open A-deck archive](https://hurricanes.ral.ucar.edu/repository/data/adecks_open/) and [operational/final track distinctions](https://hurricanes.ral.ucar.edu/realtime/).
* [NHC verification methodology](https://www.nhc.noaa.gov/verification/verify6.shtml) and [2025 verification report](https://www.nhc.noaa.gov/verification/pdfs/Verification_2025.pdf).
* [CIRA SHIPS predictor documentation](https://rammb-data.cira.colostate.edu/ships/data/ships_predictor_file.pdf).
* [GFS environmental fields via Open-Meteo](https://open-meteo.com/en/docs/gfs-api) and [marine fields](https://open-meteo.com/en/docs/marine-weather-api), CC BY 4.0.
