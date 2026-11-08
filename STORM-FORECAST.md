# Experimental Forecast Lab

The first forecast on `live-storms.html` is a **change-consensus baseline**, not a
trained intensity model. The page labels it experimental and unvalidated. It
collects forecast environmental fields along its projected path, but does not
pretend that untrained environmental coefficients improve its predictions.

## Guidance and calculation

`storm-forecast-model.js` parses the public [NCAR ATCF A-deck mirror](https://hurricanes.ral.ucar.edu/repository/data/adecks_open/).
Model identifiers follow the [NHC technique list](https://ftp.nhc.noaa.gov/atcf/docs/nhc_techlist.dat).
One representative is selected per GFS/GEFS, HAFS, ECMWF, UKMET, Canadian and NAVGEM
family when available. The newest eligible cycle wins; deterministic codes are
preferred to their ensemble-mean alternatives within the same cycle. HAFS-A and
HAFS-B do not receive two separate votes. Official forecasts and individual
ensemble members are excluded from the blend.

Guidance must match the storm, have a cycle no later than both the advisory and
retrieval time, be no more than 24 hours old relative to that cutoff, bracket the
advisory position in time, initialize within 500 km, and extend at least 12 hours
beyond the advisory. A cycle timestamp is not a proof of publication availability
at that time: this is a latest-available live product, not a historical hindcast.

For model i at forecast time t, the baseline applies:

```
V_i_corrected(t) = max(0, V_advisory + V_i(t) - V_i(t0))
P_i_corrected(t) = P_advisory + P_i(t) - P_i(t0)
latitude_i_corrected(t) = latitude_advisory + latitude_i(t) - latitude_i(t0)
longitude_i_corrected(t) = longitude_advisory + wrapped model longitude change
```

Wind and pressure use an equal-weight arithmetic mean of valid contributors;
positions use a spherical mean. Pressure is anchored only to a published advisory
or an exact-time B-deck record with matching position and wind. No pressure–wind
inversion fills missing pressure. Wind and pressure contributors can differ.
Track offsets are fixed coordinate offsets; no bias-decay timescale has been
fitted. The mean of models can miss their individual landfalls or recurvatures.

The page samples 0–120 hours at six-hour steps. It linearly interpolates scalar
guidance and wrapped longitude within gaps no larger than 24 hours; it does not
extrapolate a missing tail. Model counts accompany every point. Min/max ranges
describe disagreement between these correlated models, **not calibrated
confidence intervals**. There is no probability cone or RI probability.
Official NHC/CPHC/JTWC guidance is a separate unadjusted comparison with its own
cycle/valid times. A three-hour difference between an advisory and the forecast
cycle is retained rather than relabelled.

## Environmental data

- **Atmosphere:** [NOAA GFS through Open-Meteo](https://open-meteo.com/en/docs/gfs-api),
  explicitly requesting `gfs_global` pressure-level fields in knots. At each
  24-hour forecast location/time, eight evenly spaced points on a geodesic
  500-km ring sample winds at 850/500/200 hPa and RH at 700/500 hPa.
  Shear is `hypot(mean(u200-u850), mean(v200-v850))`; it is neither a difference
  of wind-speed magnitudes nor the mean of eight scalar shear magnitudes.
  RH averages the two levels and ring points. At least six valid samples are
  required. Ring-mean 500-hPa flow is shown as a diagnostic, not a steering-track
  integration. This sparse ring is not the SHIPS 200–800-km area average.
- **Ocean forecast:** [E.U. Copernicus Marine / Météo-France through Open-Meteo](https://open-meteo.com/en/docs/marine-weather-api),
  SST at each future valid time and forecast location. Uses nearest-grid rather
  than preferential sea-cell selection and rejects returned cells more than
  25 km from the request. Missing/land values remain null; a service outage is
  separately labelled. Coarse ocean and atmospheric runs are not a coupled
  cyclone simulation. The current-conditions SST map remains the separate JPL
  MUR daily analysis, with its own analysis timestamp and availability.

Open-Meteo can interpolate time and spatial samples and does not return a model
cycle in these responses. The UI therefore reports retrieval and valid times
without inventing a cycle. Attribution and the CC BY 4.0 licence link are visible
on the page. The free endpoints are for noncommercial use; provider quotas apply.

## Operation and verification

`api/live-storms.js` adds `view=forecast` and `view=environment` for active storm
IDs only. Forecasts cache for 30 minutes; environmental samples for one hour.
A content fingerprint binds environmental cache entries and client requests to
the same guidance path. Source failures leave other products working. Fetches
have bounded bodies and timeouts; the A-deck request reads a bounded recent tail
with HTTP Range, so the product lists available contributors rather than
claiming exhaustive model coverage. No database, uploaded imagery, credentials,
paid service, or additional persistent storage is needed.

Run `node --test --test-reporter=spec tests/storm-forecast.test.cjs` for parsing,
anchoring, missing data, cycle cutoffs, family deduplication, dateline behavior,
southern season IDs, vector shear, sampling geometry, ocean timestamps, cache
identity and failure isolation. These are software checks, not meteorological
skill verification. Live QA also exercises the map, six-hour slider, unit
switching, storm changes, mobile layout and CSV export.

Before training or advertising forecast skill, assemble issuance-time snapshots
and historical forecast predictors, split by whole storms/seasons, freeze a
held-out evaluation set, and compare track great-circle error plus wind/pressure
MAE and bias on common cases with persistence and official guidance. Archived
A-decks can contain late additions/revisions: cycle time alone is insufficient
to recreate operational availability. Any environment-based correction, weights,
uncertainty calibration or RI classifier needs that validation first. See
[NHC forecast verification](https://www.nhc.noaa.gov/verification/verify6.shtml)
and the [SHIPS predictor documentation](https://rammb-data.cira.colostate.edu/ships/data/ships_predictor_file.pdf).
