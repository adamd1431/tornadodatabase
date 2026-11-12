Native temperature scan subsets for Dvorak validation

Retrieved from UW–Madison SSEC McFETCH on 2026-11-11. These losslessly compressed JSON files contain a rectangular native-pixel subset of calibrated TEMP NetCDF, decoded by `mcfetch-netcdf.js`. Temperatures are Celsius; coordinates use east-positive longitude. No access keys or credential-bearing URLs are retained. They are test inputs, not rendered or recolored pictures.

| File | Satellite / band | Actual acquisition (UTC) |
| --- | --- | --- |
| lekima.json.gz | MTSAT-1R / 2 | 2013-10-23 15:30 |
| haiyan.json.gz | MTSAT-1R / 2 | 2013-11-07 17:30 |
| patricia.json.gz | GOES-15 / 4 | 2015-10-23 12:00 |

Independent temperature checks use the eye centers and temperatures in [Lekima's CIMSS ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2013/28W-list.txt) and [Haiyan's CIMSS ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2013/31W-list.txt). The archived algorithms' Final T and CI are not used as targets for a single-image calculation. Patricia's [ADT history](https://tropic.ssec.wisc.edu/real-time/adt/archive2015/20E-list.txt) uses GOES-13 near this time; different satellites' eye temperatures are not assumed identical.

The annulus and symmetry checks follow [SSEC's ADT sampling implementation](https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Data.java). Research peak values in [Velden et al. (2017)](https://doi.org/10.1175/MWR-D-16-0312.1) include additional bias corrections and do not establish exact scan-time values.
