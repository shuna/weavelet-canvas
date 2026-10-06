"""Mechanical checks only; semantic/state/style judgments are separate."""
import json, re, sys, collections
from pathlib import Path
root=Path(__file__).resolve().parent
file=sys.argv[1]
records=json.loads((root/file).read_text())
rows=[]
for r in records:
 if r.get('finish_reason')!='stop' or not r.get('usage') or r.get('condition','').startswith('summary'): continue
 t=r['output'].strip(); checks={}
 if r['case_id']=='T05': checks['characters_le_200']=len(t)<=200
 if r['case_id']=='T06':
  try: checks['result_itself_null']=json.loads(re.sub(r'^```(?:json)?\s*\n([\s\S]*?)\n```$',r'\1',t)) is None
  except ValueError: checks['result_itself_null']=False
 if r['case_id'] in ['D02','D03','R01'] or (r['case_id']=='R03' and r.get('probe')==0):checks['two_sentences']=t.count('。')==2
 if r['case_id'] in ['T10','T14','R02']:checks['no_script_labels']=not bool(re.search(r'(?:^|\n)(?:アキ|ユイ|ミナ|レン)\s*[「：:]',t))
 if r['case_id']=='R04': checks['sentences_le_3']=t.count('。')<=3; checks['no_table']='|' not in t
 if r['case_id']=='R02': checks['dialogues_le_4']=t.count('「')<=4
 if r['case_id'] in ['T13']:checks['two_paragraphs']=len(re.split(r'\n\s*\n',t))==2
 rows.append({'response_id':r['response_id'],'case_id':r['case_id'],'condition':r['condition'],'repeat':r['repeat'],'probe':r.get('probe'),'checks':checks})
counts=collections.defaultdict(lambda:collections.defaultdict(lambda:[0,0]))
for r in rows:
 for k,v in r['checks'].items():
  c=counts[f"{r['case_id']} probe{r['probe']} {r['condition']}"][k];c[0]+=int(v);c[1]+=1
finished=[r for r in records if r.get('usage')]
result={'completed':len(finished),'input_tokens':sum(r['usage']['prompt_tokens'] for r in finished),'output_tokens':sum(r['usage']['completion_tokens'] for r in finished),'api_cost':sum(r['usage'].get('cost',0) for r in finished),'accounted_cost':sum(r.get('accounted_cost',0) for r in records),'checks':dict(counts),'rows':rows}
(root/file.replace('results','metrics')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False,indent=2))
