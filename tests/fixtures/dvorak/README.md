Native temperature scan subsets for Dvorak validation

Retrieved from UW–Madison SSEC McFETCH on 2026-11-11. These losslessly compressed JSON files contain a rectangular native-pixel subset of calibrated TEMP NetCDF, decoded by `mcfetch-netcdf.js`. Temperatures are Celsius; coordinates use east-positive longitude. No access keys or credential-bearing URLs are retained. They are test inputs, not rendered or recolored pictures.

| File | Satellite / band | Actual acquisition (UTC) |
| --- | --- | --- |
| lekima.json.gz | MTSAT-1R / 2 | 2013-10-23 15:30 |
| haiyan.json.gz | MTSAT-1R / 2 | 2013-11-07 17:30 |
| patricia.json.gz | GOES-15 / 4 | 2015-10-23 12:00 |
| bolaven.json.gz | Himawari-9 / 13 | 2023-10-11 09:00 |

The Bolaven subset was retrieved on 2026-11-17 and preserves a 251 × 251 native-pixel rectangle from a 500 × 500 NetCDF request. It tests the supplied scan's measured 21.89 °C eye and the distinction between EIR eye-pattern Data T and basin-dependent ADT raw T. A proposed T8.0 is not a fitted target: the EIR calculation returns E6.5 + 1.0 = 7.5 before any independently verified, history-based banding contribution. EIR measurements follow the [Bureau of Meteorology Dvorak analysis diagram](https://tropic.ssec.wisc.edu/real-time/amsu/herndon/AMSTC_Intensity/DVK_EIR_diagram_600dpi.pdf); native pixel spacing limits geometric precision.

The archive calculator additionally opts into the published [ADT 9.1 guide](https://tropic.ssec.wisc.edu/misc/adt/guides/ADTV9.1_Guide.pdf), sections 5C and 5H and Table 5: three regional coefficient arrays, the table's printed −74 °C breakpoint, and equal-weight movable-annulus sector means and symmetry. This is a single-image implementation of the documented eye-scene calculation, not the vendor's complete ADT 9.1 package. Bolaven's computed value is T7.8; its original archived 9.1 raw value is T7.6 at the archive's own center and temperature measurements. Neither is replaced with the proposed T8.0. The legacy 8.2.1 calculation remains the default for trained intensity model features, whose fit and validation depend on that definition.

Independent temperature checks use the eye centers and temperatures in [Lekima's CIMSS ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2013/28W-list.txt) and [Haiyan's CIMSS ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2013/31W-list.txt). The archived algorithms' Final T and CI are not used as targets for a single-image calculation. Patricia's [ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2015/20E-list.txt) uses GOES-13 near this time; different satellites' eye temperatures are not assumed identical.

The annulus and symmetry checks follow [SSEC's ADT sampling implementation](https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Data.java). Research peak values in [Velden et al. (2017)](https://doi.org/10.1175/MWR-D-16-0312.1) include additional bias corrections and do not establish exact scan-time values.
