NOAA PSL 20CRv3 ensemble-mean mean sea-level pressure, 2005-02-16 06:00 UTC.

Source: https://psl.noaa.gov/thredds/dodsC/Datasets/20thC_ReanV3/miscMO/prmsl.2005.nc.ascii?prmsl%5B370:1:370%5D%5B0:1:180%5D%5B0:1:359%5D

The `.ascii.gz` fixture is a deterministic, lossless gzip of that complete single-time response. Units are Pa; latitude is -90 to +90 and longitude 0 to359 at 1° increments. No storm observations are embedded in the pressure field.

Independent QA with ContourPy 1.4 and geodesic radial intersections:

- Olaf minimum: 12°S,171°W. At1000mb the mean contour radius is325.3651nmi.
- At1002mb, the mean radius is429.8965nmi; minimum297.738, maximum608.725nmi.
- At1004mb, the closed loop includes both Olaf and Nancy. Thus the fixed2mb isolated-contour method selects1002mb, approximately430nmi.
- A separate direct bilinear-pressure/geodesic-ray calculation gives430.335nmi at1002mb. Numerical agreement does not imply observational precision at the source grid scale.

Data provided by NOAA PSL, Boulder,Colorado,USA. NOAA/CIRES/DOE Twentieth Century Reanalysis version3, supported by U.S.DOE Office of Science, NOAA Climate Program Office,and NOAA Physical Sciences Laboratory.
