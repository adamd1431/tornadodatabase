"""Acquire compact, provenance-tracked operational guidance and USA best tracks.

Public data only. Large raw A-decks are filtered while streaming and are never
stored. Output belongs outside the deployable site (use --output).
"""
import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import re
import time
import urllib.request
from pathlib import Path

CODES = set('CARQ OFCL JTWC WRNG XTRP AVNO AVNI AVN2 AEMN AEMI AEM2 HFSA HFSB HAFA HAFB HFAI HFBI HFA2 HFB2 HWRF HWFI HWF2 HMON HMNI HMN2 EMX EMXI EMX2 ECMF UKM UKMI UKM2 UKX UKXI UKX2 EGRR EGRI EGR2 CMC CMCI CMC2 CEMN CEMI CEM2 NGX NGXI NGX2 NVGM NVGI NVG2 CTCX CTCI CTC2 CHIP CHPI ST5D STID DSHP LGEM SHIP IVCN TVCN HCCA'.split())
BEST_SOURCE = 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv'
NHC = 'https://ftp.nhc.noaa.gov/atcf/archive/'
NCAR = 'https://hurricanes.ral.ucar.edu/repository/data/adecks_open/'

def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'TornadoDatabase retrospective forecast study', 'Accept-Encoding': 'identity'}), timeout=60)

def number(value, minimum, maximum):
    try:
        result = float(value)
        return result if minimum <= result <= maximum else None
    except (ValueError, TypeError):
        return None

def best_tracks(directory, years):
    cache = directory / 'verification-best-tracks.json'
    if cache.exists():
        return json.loads(cache.read_text(encoding='utf-8'))
    points, storms, agencies = {}, {}, set()
    with request(BEST_SOURCE) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding='utf-8', newline=''))
        for row in reader:
            row = {k: v.strip() for k, v in row.items()}
            identifier = row.get('USA_ATCF_ID', '')
            if not re.fullmatch(r'(AL|EP|CP|WP|IO|SH)\d{6}', identifier) or int(identifier[2:4]) >= 50 or int(identifier[4:]) not in years or row.get('TRACK_TYPE') != 'main':
                continue
            latitude, longitude = number(row.get('USA_LAT'), -90, 90), number(row.get('USA_LON'), -180, 180)
            if latitude is None or longitude is None:
                continue
            try:
                at = dt.datetime.fromisoformat(row['ISO_TIME']).replace(tzinfo=dt.timezone.utc)
            except ValueError:
                continue
            # Use agency synoptic fixes, not IBTrACS's interpolated 3-h positions.
            if at.hour % 6 or at.minute:
                continue
            sid = row['SID']
            record = {'validAt': at.isoformat(), 'latitude': latitude, 'longitude': longitude,
                      'windKt': number(row.get('USA_WIND'), 1, 250),
                      'pressureMb': number(row.get('USA_PRES'), 800, 1100),
                      'status': row.get('USA_STATUS'), 'agency': row.get('USA_AGENCY')}
            points.setdefault(sid, {})[record['validAt']] = record
            storms.setdefault(identifier, {'id': identifier, 'sid': sid, 'name': row['NAME'], 'season': int(identifier[4:]), 'basin': identifier[:2]})
            agencies.add(row.get('USA_AGENCY'))
    result = {'source': BEST_SOURCE, 'retrievedAt': utcnow(), 'agencies': sorted(agencies),
              'storms': [{**storm, 'points': sorted(points[storm['sid']].values(), key=lambda p: p['validAt'])} for storm in sorted(storms.values(), key=lambda p: p['id'])]}
    cache.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print('BEST TRACKS', len(result['storms']), 'storm IDs', result['agencies'], flush=True)
    return result

def source_indices(years):
    indices = {}
    for year in years:
        for agency, base in [('nhc', NHC), ('ncar', NCAR)]:
            url = base + str(year) + '/'
            with request(url) as response:
                html = response.read(2000000).decode()
            links = re.findall(r'href=["\']([^"\']+)', html, re.I)
            indices[(agency, year)] = {link for link in links if re.fullmatch(r'a(?:al|ep|cp|wp|io|sh)\d{6}\.dat(?:\.gz)?', link)}
    return indices

def acquire(storm, directory, indices):
    identifier, year = storm['id'], storm['season']
    target = directory / 'guidance' / (identifier + '.csv.gz')
    metadata = target.with_suffix('.meta.json')
    if target.exists() and metadata.exists():
        return json.loads(metadata.read_text(encoding='utf-8'))
    agency = 'nhc' if storm['basin'] in ['AL', 'EP', 'CP'] else 'ncar'
    filename = 'a' + identifier.lower() + '.dat' + ('.gz' if agency == 'nhc' else '')
    url = (NHC if agency == 'nhc' else NCAR) + str(year) + '/' + filename
    result = {k: storm[k] for k in ['id', 'sid', 'name', 'season', 'basin']}
    result.update(sourceUrl=url, retrievedAt=utcnow())
    if filename not in indices[(agency, year)]:
        return {**result, 'error': 'No guidance file in the published annual index'}
    for attempt in range(3):
        try:
            retained, seen, total = [], set(), 0
            with request(url) as response:
                stream = gzip.GzipFile(fileobj=response) if agency == 'nhc' else response
                for raw in stream:
                    total += len(raw)
                    if total > 256000000:
                        raise ValueError('Raw guidance exceeds the 256 MB per-file limit')
                    c = [v.strip() for v in raw.decode('utf-8', errors='replace').split(',')]
                    if len(c) < 11 or c[0] + c[1] != identifier[:4] or c[4] not in CODES:
                        continue
                    try:
                        lead = int(c[5])
                    except ValueError:
                        continue
                    if not (-24 <= lead <= 168) or (lead < 0 and c[4] != 'CARQ'):
                        continue
                    # Standard scalar fields 0..10 plus motion and name. Radii
                    # duplicates disappear without reweighting forecast samples.
                    compact = ','.join(c[:11] + [c[i] if len(c) > i else '' for i in [25, 26, 27]])
                    if compact not in seen:
                        seen.add(compact)
                        retained.append(compact)
                modified = response.headers.get('Last-Modified')
            data = ('\n'.join(retained) + '\n').encode()
            if not retained:
                raise ValueError('No recognized model or operational analysis records')
            target.write_bytes(gzip.compress(data, mtime=0))
            result.update(records=len(retained), rawBytes=total, retainedBytes=len(data), compressedBytes=target.stat().st_size,
                          sha256=hashlib.sha256(data).hexdigest(), lastModified=modified, columns='ATCF 0..10, direction, speed, storm name')
            metadata.write_text(json.dumps(result, indent=2), encoding='utf-8')
            return result
        except Exception as error:
            if attempt == 2:
                return {**result, 'error': str(error)}
            time.sleep(1 + attempt)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--years', nargs='+', type=int, default=[2023, 2024, 2025])
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    directory = Path(args.output).resolve()
    (directory / 'guidance').mkdir(parents=True, exist_ok=True)
    tracks = best_tracks(directory, args.years)
    indices = source_indices(args.years)
    results, start = [], time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, args.workers)) as executor:
        jobs = {executor.submit(acquire, s, directory, indices): s for s in tracks['storms']}
        for job in concurrent.futures.as_completed(jobs):
            result = job.result()
            results.append(result)
            if len(results) % 10 == 0 or 'error' in result:
                print('GUIDANCE', len(results), '/', len(jobs), result['id'], result.get('error', 'OK'), 'elapsed', round(time.monotonic()-start), 's', flush=True)
    report = {'createdAt': utcnow(), 'years': args.years, 'recognizedCodes': sorted(CODES), 'sources': sorted(results, key=lambda r: r['id'])}
    (directory / 'source-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('DONE', len(results), 'files;', sum('error' in r for r in results), 'unavailable;', round(sum(r.get('compressedBytes', 0) for r in results)/1048576, 1), 'MiB retained', flush=True)

if __name__ == '__main__':
    main()
