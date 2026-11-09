"""Fit on designated storms, select on validation, freeze, then evaluate once.

Requires NumPy. Never fits with either held-out split. The evaluation command
loads the frozen model; it does not tune or refit anything.
"""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import numpy as np

LEADS = [12, 24, 48, 72, 96, 120]
TARGETS = {'track': [0, 1], 'wind': [2], 'pressure': [3]}
KM = np.pi * 6371 / 180
def wrap(x): return (x + 180) % 360 - 180
def distance(a, b):
    p, q = np.radians(a[:, 0]), np.radians(b[:, 0])
    h = np.sin((q-p)/2)**2 + np.cos(p)*np.cos(q)*np.sin(np.radians(wrap(b[:, 1]-a[:, 1]))/2)**2
    return 12742*np.arcsin(np.sqrt(np.clip(h, 0, 1)))

class Study:
    def __init__(self, directory):
        self.root = Path(directory)
        self.audit = json.loads((self.root/'case-audit.json').read_text())
        with gzip.open(self.root/'cases.jsonl.gz', 'rt', encoding='utf-8') as f:
            self.rows = [json.loads(line) for line in f]
        self.n, self.f = len(self.rows), len(self.audit['families'])
        self.ids = [f['id'] for f in self.audit['families']]
        self.initial = np.array([r['initial'] for r in self.rows], dtype=float)
        self.y = np.array([r['y'] for r in self.rows], dtype=float)
        self.truth = np.array([r['truth'] for r in self.rows], dtype=float)
        self.lead = np.array([r['lead'] for r in self.rows])
        self.region = np.array(['nhc' if r['basin'] in ['AL', 'EP', 'CP'] else 'jtwc' for r in self.rows])
        self.split = np.array([r['split'] for r in self.rows])
        self.sid = np.array([r['sid'] for r in self.rows])
        self.raw = np.full((self.n, self.f, 4), np.nan)
        self.offset = np.full_like(self.raw, np.nan)
        for i, row in enumerate(self.rows):
            for x in row['x']:
                self.raw[i, x[0]] = [x[1], x[2], x[5], x[7]]
                self.offset[i, x[0]] = [x[3], x[4], x[6], x[8]]
        self.base = self.project(np.array([r['v1'] for r in self.rows], dtype=float))
        self.official = self.project(np.array([r['official'] if r['official'] else [None]*4 for r in self.rows], dtype=float))
        self.motion = self.project(np.array([r['motion'] if r['motion'] else [None]*4 for r in self.rows], dtype=float))
        self.persistence = np.column_stack([np.zeros((self.n, 2)), self.initial[:, 2:]])
        self.trend = np.nan_to_num(np.array([r['trend'] for r in self.rows], dtype=float))
        self.adjusted_cache = {}

    def project(self, points):
        result = points.copy()
        result[:, 0] = wrap(points[:, 1]-self.initial[:, 1])*KM*np.maximum(.2, np.cos(np.radians(self.initial[:, 0])))
        result[:, 1] = (points[:, 0]-self.initial[:, 0])*KM
        return result

    def unproject(self, points):
        result = points.copy()
        result[:, 0] = self.initial[:, 0]+points[:, 1]/KM
        result[:, 1] = wrap(self.initial[:, 1]+points[:, 0]/(KM*np.maximum(.2, np.cos(np.radians(self.initial[:, 0])))))
        return result

    def adjusted(self, decay):
        if decay not in self.adjusted_cache:
            factor = np.exp(-self.lead/decay) if decay else np.ones(self.n)
            value = self.raw+self.offset*factor[:, None, None]
            value[:, :, 2] = np.maximum(0, value[:, :, 2])
            value[:, :, 3] = np.where((value[:, :, 3]>=800)&(value[:, :, 3]<=1100), value[:, :, 3], np.nan)
            self.adjusted_cache[decay] = value
        return self.adjusted_cache[decay]

    def feature_mask(self, aidset):
        stop = {'physical': 9, 'statistical': 12, 'consensus': 14, 'official': 15}[aidset]
        return np.arange(self.f) < stop

    def errors(self, prediction, target):
        cols = TARGETS[target]
        valid = np.all(np.isfinite(self.y[:, cols]), axis=1)&np.all(np.isfinite(prediction[:, cols]), axis=1)
        if target == 'track':
            values = distance(self.unproject(prediction)[:, :2], self.truth[:, :2])
            signed = np.full(self.n, np.nan)
        else:
            signed = prediction[:, cols[0]]-self.y[:, cols[0]]
            values = np.abs(signed)
        return np.where(valid, values, np.nan), np.where(valid, signed, np.nan)

def project_parameters(values, f, has_trend):
    result = values.copy()
    w = np.maximum(0, result[:f])
    if w.sum() > 1:
        order = np.sort(w)[::-1]
        cumulative = np.cumsum(order)
        rho = np.nonzero(order > (cumulative-1)/(np.arange(f)+1))[0][-1]
        w = np.maximum(0, w-(cumulative[rho]-1)/(rho+1))
    result[:f] = w
    if has_trend:
        result[f] = np.clip(result[f], 0, 1)
    result[f+int(has_trend):] = np.clip(result[f+int(has_trend):], -1, 1)
    return result

def fit_one(study, target, region, lead, config, split_mask):
    cols = TARGETS[target]
    valid = split_mask&(study.region==region)&(study.lead==lead)&np.all(np.isfinite(study.y[:, cols]), axis=1)&np.all(np.isfinite(study.base[:, cols]), axis=1)
    indices = np.flatnonzero(valid)
    if len(indices) < 20 or len(set(study.sid[indices])) < 6:
        return {'weights': {}, 'bias': [0]*len(cols), 'trendGain': 0, 'cases': len(indices), 'storms': len(set(study.sid[indices]))}
    value = study.adjusted(config['decayHours'])[indices][:, :, cols]
    baseline = study.base[indices][:, cols]
    delta = value-baseline[:, None, :]
    allowed = study.feature_mask(config['aidset'])
    for j in range(study.f):
        present = np.all(np.isfinite(delta[:, j, :]), axis=1)
        if sum(present) < 30 or len(set(study.sid[indices][present])) < 6:
            allowed[j] = False
    delta[:, ~allowed, :] = 0
    delta = np.nan_to_num(delta)
    scale = (60+2*lead) if target=='track' else ((10+.1*lead) if target=='wind' else (8+.1*lead))
    dims = len(cols)
    design = (delta/scale).transpose(0, 2, 1).reshape(-1, study.f)
    use_trend = config['trend'] and target!='track'
    if use_trend:
        trend = study.trend[indices, 0 if target=='wind' else 1]*lead/12*np.exp(-lead/24)/scale
        design = np.column_stack([design, trend])
    bias_unit = 100 if target=='track' else 10
    intercept = np.tile(np.eye(dims), (len(indices), 1))*bias_unit/scale
    design = np.column_stack([design, intercept])
    observed = ((study.y[indices][:, cols]-baseline)/scale).reshape(-1)
    counts = collections.Counter(study.sid[indices])
    storm_weight = np.repeat([1/counts[s] for s in study.sid[indices]], dims)
    weight = storm_weight.copy()
    coefficient = np.zeros(design.shape[1])
    penalty = np.full(len(coefficient), config['ridge'])
    penalty[study.f+int(use_trend):] *= 2
    if use_trend:
        penalty[study.f] *= .3
    for _ in range(2):
        gram = design.T@(weight[:, None]*design)/weight.sum()+np.diag(penalty)
        rhs = design.T@(weight*observed)/weight.sum()
        rate = 1/max(np.linalg.eigvalsh(gram)[-1], 1e-8)
        for iteration in range(350):
            next_value = project_parameters(coefficient-rate*(gram@coefficient-rhs), study.f, use_trend)
            if np.max(np.abs(next_value-coefficient)) < 1e-7:
                coefficient = next_value
                break
            coefficient = next_value
        residual = design@coefficient-observed
        weight = storm_weight*np.minimum(1, 2/np.maximum(np.abs(residual), 1e-8))
    return {'weights': {family: round(float(coefficient[j]), 9) for j, family in enumerate(study.ids) if coefficient[j]>1e-6},
            'bias': [round(float(v*bias_unit), 8) for v in coefficient[study.f+int(use_trend):]],
            'trendGain': round(float(coefficient[study.f]), 8) if use_trend else 0,
            'cases': len(indices), 'storms': len(set(study.sid[indices]))}

def predict(study, target, region, config):
    cols = TARGETS[target]
    value = study.adjusted(config['decayHours'])
    prediction = study.base.copy()
    for lead in LEADS:
        indices = np.flatnonzero((study.region==region)&(study.lead==lead))
        parameters = config['leads'][str(lead)]
        baseline = study.base[indices][:, cols]
        delta = np.nan_to_num(value[indices][:, :, cols]-baseline[:, None, :])
        weights = np.array([parameters['weights'].get(f, 0) for f in study.ids])
        result = baseline+np.einsum('nfd,f->nd', delta, weights)+np.array(parameters['bias'])
        if target!='track':
            result[:, 0] += parameters['trendGain']*study.trend[indices, 0 if target=='wind' else 1]*lead/12*np.exp(-lead/24)
            if target=='wind':result[:, 0] = np.maximum(0, result[:, 0])
            else:result[:, 0] = np.where((result[:, 0]>=800)&(result[:, 0]<=1100), result[:, 0], np.nan)
        prediction[np.ix_(indices, cols)] = result
    return prediction

def selection_score(study, prediction, target, region):
    errors, _ = study.errors(prediction, target)
    old, _ = study.errors(study.base, target)
    ratios = []
    for lead in LEADS:
        mask=(study.split=='validation')&(study.region==region)&(study.lead==lead)&np.isfinite(errors)&np.isfinite(old)
        if mask.sum()<10:continue
        sids=sorted(set(study.sid[mask]))
        new_mean=np.mean([errors[mask&(study.sid==s)].mean() for s in sids])
        old_mean=np.mean([old[mask&(study.sid==s)].mean() for s in sids])
        ratios.append(new_mean/old_mean)
    return float(np.mean(ratios)) if ratios else 1e6

def train(study):
    candidates, selected = [], {}
    training = study.split=='train'
    for region in ['nhc','jtwc']:
        selected[region]={}
        for target in TARGETS:
            aidsets = ['physical'] if target=='pressure' else (['physical','consensus','official'] if target=='track' else ['physical','statistical','consensus','official'])
            trends = [False] if target=='track' else [False,True]
            if region=='jtwc':aidsets=[s for s in aidsets if s!='official']
            configs=[]
            for decay,ridge,aidset,trend in itertools.product([0,48,96],[.03,.3],aidsets,trends):
                config={'decayHours':decay,'ridge':ridge,'aidset':aidset,'trend':trend}
                config['leads']={str(lead):fit_one(study,target,region,lead,config,training) for lead in LEADS}
                score=selection_score(study,predict(study,target,region,config),target,region)
                configs.append((score,config))
                candidates.append({'region':region,'target':target,**{k:v for k,v in config.items() if k!='leads'},'validationRelativeMae':score})
            score,winner=min(configs,key=lambda p:p[0])
            # Predeclared validation gate: do not replace a field unless its
            # equal-lead, whole-storm validation MAE improves at least 2 percent.
            winner['promotedFromValidation']=score<.98
            winner['validationRelativeMae']=score
            final_mask=(study.split=='train')|(study.split=='validation')
            winner['leads']={str(lead):fit_one(study,target,region,lead,winner,final_mask) for lead in LEADS}
            selected[region][target]=winner
            print('SELECT',region,target,'validation change',round((1-score)*100,2),'%',{k:winner[k] for k in ['decayHours','ridge','aidset','trend','promotedFromValidation']},flush=True)
    result={'version':'calibrated-consensus-v2','createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'caseSha256':study.audit['sha256'],
            'protocol':'protocol-v2.json','families':study.ids,'trainingSplits':['train','validation'],'excludedSplits':['test2024global','test2025'],
            'rawModelDelayHours':6,'earlyModelDelayHours':3,'model':selected}
    encoded=json.dumps(result,sort_keys=True,indent=2).encode()
    (study.root/'selected-model-frozen.json').write_bytes(encoded)
    (study.root/'model-freeze.sha256').write_text(hashlib.sha256(encoded).hexdigest(),encoding='ascii')
    (study.root/'validation-candidates.json').write_text(json.dumps(candidates,indent=2),encoding='utf-8')
    print('FROZEN',hashlib.sha256(encoded).hexdigest(),'No test-set errors evaluated.',flush=True)

def metric_summary(study,prediction,target,mask):
    error,bias=study.errors(prediction,target)
    mask=mask&np.isfinite(error)
    if not mask.any():return None
    return {'cases':int(mask.sum()),'storms':len(set(study.sid[mask])),'mae':float(error[mask].mean()),'rmse':float(np.sqrt((error[mask]**2).mean())),
            'bias':float(bias[mask].mean()) if np.isfinite(bias[mask]).any() else None,
            'stormWeightedMae':float(np.mean([error[mask&(study.sid==sid)].mean() for sid in sorted(set(study.sid[mask]))]))}

def cluster_interval(study,old,new,mask):
    sids=sorted(set(study.sid[mask]));pairs=np.array([[old[mask&(study.sid==sid)].sum(),new[mask&(study.sid==sid)].sum(),sum(mask&(study.sid==sid))] for sid in sids])
    if len(sids)<3:return None
    rng=np.random.default_rng(20261109);draw=rng.integers(0,len(sids),(1000,len(sids)));totals=pairs[draw].sum(axis=1);improvement=100*(totals[:,0]-totals[:,1])/totals[:,0]
    return [float(v) for v in np.quantile(improvement,[.025,.975])]

def evaluate(study):
    encoded=(study.root/'selected-model-frozen.json').read_bytes();frozen=json.loads(encoded)
    assert hashlib.sha256(encoded).hexdigest()==(study.root/'model-freeze.sha256').read_text().strip(),'Frozen model was changed.'
    assert frozen['caseSha256']==study.audit['sha256'],'Case data changed after selection.'
    prediction=study.base.copy()
    for region in ['nhc','jtwc']:
        for target in TARGETS:
            config=frozen['model'][region][target]
            if not config['promotedFromValidation']:continue
            candidate=predict(study,target,region,config)
            indices=np.flatnonzero(study.region==region)
            prediction[np.ix_(indices,TARGETS[target])]=candidate[np.ix_(indices,TARGETS[target])]
    summaries=[]
    for split in ['validation','test2024global','test2025']:
        for region in ['all','nhc','jtwc']:
            group=(study.split==split)&((study.region==region) if region!='all' else True)
            if not group.any():continue
            for target in TARGETS:
                new_error,_=study.errors(prediction,target);old_error,_=study.errors(study.base,target)
                common=group&np.isfinite(new_error)&np.isfinite(old_error)
                for lead in ['all']+LEADS:
                    mask=common&((study.lead==lead) if lead!='all' else True)
                    old=metric_summary(study,study.base,target,mask);new=metric_summary(study,prediction,target,mask)
                    if not new:continue
                    row={'split':split,'region':region,'target':target,'lead':lead,'v1':old,'v2':new,'improvementPct':100*(old['mae']-new['mae'])/old['mae'],'improvement95ClusterIntervalPct':cluster_interval(study,old_error,new_error,mask)}
                    alternative=study.motion if target=='track' else study.persistence
                    alt_error,_=study.errors(alternative,target);alt_mask=mask&np.isfinite(alt_error)
                    row['persistenceCommon']={'baseline':metric_summary(study,alternative,target,alt_mask),'v2':metric_summary(study,prediction,target,alt_mask)}
                    official_error,_=study.errors(study.official,target);official_mask=mask&np.isfinite(official_error)
                    row['officialCommon']={'official':metric_summary(study,study.official,target,official_mask),'v2':metric_summary(study,prediction,target,official_mask)}
                    summaries.append(row)
                    if lead=='all':print('RESULT',split,region,target,'n',new['cases'],'storms',new['storms'],'v1',round(old['mae'],2),'v2',round(new['mae'],2),'gain',round(row['improvementPct'],2),'%',flush=True)
    report={'version':2,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'frozenModelSha256':hashlib.sha256(encoded).hexdigest(),'caseSha256':study.audit['sha256'],
            'caseCount':len(study.rows),'distinctStorms':len(set(study.sid)),'summaries':summaries,
            'limitations':['Retrospective archived guidance; actual publication times and late revisions cannot be reconstructed. Six-hour raw and three-hour early availability delays are conservative proxies.',
                          'Verification uses final NOAA IBTrACS USA agency fields at synoptic fixes; provisional tracks are excluded. Best-track pressure can be estimated rather than measured.',
                          '2025 final JTWC data were unavailable. A preassigned 2024 whole-storm global holdout complements the 2025 NHC temporal test.',
                          'Cases require both methods and a tropical or subtropical best-track valid time. Results do not verify extratropical forecasts or forecasts after dissipation.',
                          'If official guidance has nonzero fitted weight, the blend is official-informed and its official comparison is not an independent competition.',
                          'Historical model versions differ from present operational systems. No guarantee of real-time skill or perfectly known future intensity is implied.']}
    (study.root/'backtest-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    # Row-level paired results make every summary reproducible without rerunning
    # a source download. Kept locally; only compact aggregate results deploy.
    import csv
    with gzip.open(study.root/'paired-errors.csv.gz','wt',encoding='utf-8',newline='') as file:
        writer=csv.writer(file);writer.writerow(['storm_id','sid','name','split','basin','initial_utc','lead_hours','metric','v1_error','v2_error','official_error'])
        for target in TARGETS:
            old,_=study.errors(study.base,target);new,_=study.errors(prediction,target);official,_=study.errors(study.official,target)
            for i,row in enumerate(study.rows):
                if row['split'] in ['test2024global','test2025'] and np.isfinite(old[i]) and np.isfinite(new[i]):writer.writerow([row['id'],row['sid'],row['name'],row['split'],row['basin'],row['at'],row['lead'],target,old[i],new[i],official[i] if np.isfinite(official[i]) else ''])
    print('Evaluation saved; the frozen model was not refit.',flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--evaluate-test',action='store_true');args=parser.parse_args()
    if not args.evaluate_test and (Path(args.data)/'model-freeze.sha256').exists():
        parser.error('This study is already frozen. Use --evaluate-test, or a new output directory for a separate experiment; do not overwrite a tested model.')
    study=Study(args.data)
    if args.evaluate_test:evaluate(study)
    else:train(study)
if __name__=='__main__':main()
