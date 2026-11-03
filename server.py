"""Loopback-only job workbook reader. No external service or persistent uploads."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import csv, io, json, sys, re, argparse, webbrowser, hashlib
from urllib.parse import urlparse, parse_qs, quote
from package_import import import_files
from collector import Collector
from source_book import load_catalog
sys.path.insert(0, str(Path(__file__).parent / '.vendor'))
ROOT = Path(__file__).resolve().parent
collector = Collector(ROOT/'data'/'collector')
ALIASES = {
 'agency':['招考单位','招录机关','招录单位','用人单位','招聘单位','部门名称'],
 'title':['招考职位','职位名称','招聘岗位','岗位名称','招录职位'],
 'code':['职位代码','岗位代码','职位编码'], 'count':['录用人数','招考人数','招录人数','招聘人数','计划人数'],
 'education':['学历','学历要求'], 'degree':['学位','学位要求'],
 'majorGrad':['研究生专业名称及代码','研究生专业'], 'majorBachelor':['本科专业名称及代码','本科专业'],
 'majorCollege':['大专专业名称及代码','大专专业','专科专业'], 'major':['专业','专业要求','专业名称'],
 'experience':['是否要求2年以上基层工作经历','基层工作最低年限','基层工作经历','基层工作年限'],
 'fresh':['是否限应届毕业生报考','招考对象','招录对象','招聘对象','人员类别'],
 'other':['其他要求','其他条件','备注','备注说明','职位备注','岗位备注','报考条件','资格条件','附加条件','特殊要求','其他资格条件','其他报考条件','与岗位有关的其他条件','与岗位有关的其它条件'],
 'city':['考区','工作地点','工作地区','地区'], 'type':['职位类型','职位类别'], 'description':['职位简介','岗位简介','工作内容']}
def norm(v):
 return re.sub(r'\s+', '', str(v or ''))
def value(v):
 return str(int(v)) if isinstance(v,float) and v.is_integer() else str(v or '').strip()
def sheets(data, name):
 if len(data)>20*1024*1024: raise ValueError('文件不能超过20MB')
 if name.lower().endswith('.xls'):
  import xlrd
  book=xlrd.open_workbook(file_contents=data)
  if book.nsheets>30: raise ValueError('工作表不能超过30个')
  if sum(s.nrows for s in book.sheets())>100000 or any(s.ncols>200 for s in book.sheets()): raise ValueError('表格超过10万行或200列')
  return [(s.name,[s.row_values(r) for r in range(s.nrows)]) for s in book.sheets()]
 if name.lower().endswith('.xlsx'):
  from zipfile import ZipFile
  from xml.etree import ElementTree as E
  from posixpath import normpath
  z=ZipFile(io.BytesIO(data))
  if sum(i.file_size for i in z.infolist())>100*1024*1024: raise ValueError('解压后的文件过大')
  ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(e.itertext()) for e in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
  rel={e.attrib['Id']:e.attrib['Target'] for e in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  out=[]
  for s in E.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns):
   target=rel[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
   path=target.lstrip('/') if target.startswith('/') else normpath('xl/'+target)
   rows=[]
   for r in E.fromstring(z.read(path)).findall('m:sheetData/m:row',ns):
    row=[]
    for c in r.findall('m:c',ns):
     idx=0
     for ch in re.sub('[^A-Z]','',c.attrib.get('r','A')): idx=idx*26+ord(ch)-64
     if idx>200: raise ValueError('列数不能超过200')
     while len(row)<idx: row.append('')
     v=c.find('m:v',ns); text=v.text if v is not None else ''
     if c.attrib.get('t')=='s': text=strings[int(text)]
     if c.attrib.get('t')=='inlineStr': text=''.join(c.find('m:is',ns).itertext())
     row[idx-1]=text or ''
    rows.append((int(r.attrib.get('r',len(rows)+1)),row))
   # Preserve source row numbers, including omitted blank rows.
   dense=[]
   for n,row in rows:
    if n>100000: raise ValueError('行号超出100000限制')
    while len(dense)<n: dense.append([])
    dense[n-1]=row
   out.append((s.attrib['name'],dense))
  if len(out)>30: raise ValueError('工作表不能超过30个')
  return out
 if name.lower().endswith('.csv'):
  try: text=data.decode('utf-8-sig')
  except UnicodeDecodeError: text=data.decode('gb18030')
  rows=[]
  for row in csv.reader(io.StringIO(text)):
   if len(rows)>=100000 or len(row)>200: raise ValueError('CSV超过10万行或200列')
   rows.append(row)
  return [('CSV',rows)]
 raise ValueError('支持 .xls、.xlsx、.csv 文件')
def parse(data,name):
 jobs=[]; report=[]; total=0; dataset_id=hashlib.sha256(data).hexdigest()
 for sheet, rows in sheets(data,name):
  total+=len(rows)
  if total>100000: raise ValueError('总行数不能超过100000')
  if any(len(r)>200 for r in rows): raise ValueError('列数不能超过200')
  best=None
  # Recognize ordinary and two-row headers. Keep the detected mapping visible.
  for i,row in enumerate(rows[:30]):
   for span in (1,2):
    if i+span>len(rows): continue
    heads=[]
    for col in range(max(len(r) for r in rows[i:i+span])):
     parts=[norm(r[col]) if col<len(r) else '' for r in rows[i:i+span]]
     heads.append(''.join(dict.fromkeys(p for p in parts if p)))
    mapping={}
    for k,aliases in ALIASES.items():
     for n,h in enumerate(heads):
      if h in aliases: mapping[k]=n; break
    if best is None or len(mapping)>len(best[2]): best=(i+span,heads,mapping)
  if not best or len(best[2])<3 or not ('title' in best[2] or 'code' in best[2]):
   report.append({'sheet':sheet,'count':0,'warning':'未识别职位表，已跳过；请整理表头后重新导入','mapping':{}}); continue
  start,heads,mapping=best
  # All condition columns matter; never choose just the first alias.
  condition_headers=set(ALIASES['other']+['性别','性别要求','政治面貌','政治面貌要求','户籍','户籍要求','生源要求','年龄','年龄要求','资格证书','资格要求','最低服务年限','是否开展心理素质测评'])
  known_cols=set(mapping.values())
  condition_cols=[c for c,h in enumerate(heads) if h in condition_headers or (c not in known_cols and re.search(r'要求|限制|条件|备注|资格|证书|户籍|生源|性别|年龄|身体|视力|身高|政治|党|团|定向|身份|年限|面向|学历|学位',h))]
  if condition_cols and 'other' not in mapping: mapping['other']=condition_cols[0]
  notes=[' / '.join(value(x) for x in r if value(x)) for r in rows[:start-1] if any(value(x) for x in r)]
  before=len(jobs)
  for n,row in enumerate(rows[start:],start+1):
   get=lambda k: value(row[mapping[k]]) if k in mapping and mapping[k]<len(row) else ''
   code=get('code'); title=get('title')
   if not code and not title: continue
   if title.startswith(('注：','注:','备注：','合计','总计')) or (code and not re.search(r'\d',code)): continue
   threshold=re.search(r'(\d+)年以上',heads[mapping['experience']]) if 'experience' in mapping else None
   conditions=[{'column':heads[c],'text':value(row[c])} for c in condition_cols if c<len(row) and value(row[c])]
   j={k:get(k) for k in ALIASES}; j['other']='；'.join(f'【{s["column"]}】{s["text"]}' for s in conditions)
   j.update(id=f'{sheet}:{n}',sheet=sheet,row=n,notes=notes,datasetId=dataset_id,conditionSources=conditions,available=list(mapping),experienceThreshold=int(threshold.group(1)) if threshold else None,
    raw={f'{h or "未命名列"} [{c+1}]':value(row[c]) if c<len(row) else '' for c,h in enumerate(heads)})
   jobs.append(j)
  report.append({'sheet':sheet,'count':len(jobs)-before,'headerRow':start,'mapping':{k:heads[c] for k,c in mapping.items()},'conditionColumns':[heads[c] for c in condition_cols],'missing':[k for k in ['education','fresh','experience','other'] if k not in mapping]})
 if not jobs: raise ValueError('没有识别到职位。需包含职位名称/代码及学历、专业等列；支持前30行内表头，可先整理成单行表头。')
 return {'filename':name,'jobs':jobs,'sheets':report,'total':len(jobs),'recruits':sum(int(j['count']) for j in jobs if j['count'].isdigit())}
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT/'web'),**kw)
 def end_headers(self):
  if not self.path.startswith('/api/'):
   self.send_header('Cache-Control','no-store')
  super().end_headers()
 def reply(self,status,obj):
  body=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
 def do_GET(self):
  if urlparse(self.path).path=='/api/collector/file':
   try:
    q=parse_qs(urlparse(self.path).query)
    name,body=collector.saved_file(q.get('noticeId',[''])[0],q.get('revisionId',[''])[0],q.get('sha',[''])[0])
    self.send_response(200); self.send_header('Content-Type','application/octet-stream'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(name)); self.end_headers(); self.wfile.write(body)
   except Exception as e: self.reply(404,{'error':str(e)})
   return
  if self.path=='/api/info': return self.reply(200,{'version':'package-v1','localOnly':True,'collector':True})
  if self.path=='/api/collector/catalog': return self.reply(200,load_catalog(ROOT))
  if self.path=='/api/collector/materials': return self.reply(200,collector.material_catalog())
  if self.path=='/api/collector': return self.reply(200,collector.view())
  if self.path=='/api/sample':
   try:
    p=ROOT/'data'/'广东2027职位表.xls'
    real=p.exists()
    if not real:p=ROOT/'tests'/'fixtures'/'广东2027虚构岗位A.csv'
    result=import_files(p.read_bytes(),p.name,parse,sheets)
    result['sampleKind']='local-real' if real else 'fictional'
    self.reply(200,result)
   except Exception as e: self.reply(400,{'error':str(e)})
  else: super().do_GET()
 def do_POST(self):
  route=urlparse(self.path).path
  if route not in ('/api/import','/api/collector/sources','/api/collector/settings','/api/collector/check','/api/collector/import','/api/collector/link','/api/collector/source-pack','/api/collector/materials'): return self.reply(404,{'error':'接口不存在'})
  origin=self.headers.get('Origin','')
  if origin and origin not in [f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}']: return self.reply(403,{'error':'仅允许本地页面导入'})
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<=20*1024*1024: raise ValueError('请求体需在20MB以内')
   if route.startswith('/api/collector/'):
    if size>1024*1024: raise ValueError('采集配置请求过大')
    payload=json.loads(self.rfile.read(size))
    if route.endswith('/materials'): return self.reply(200,collector.start_materials(payload.get('ids')))
    if route.endswith('/link'): return self.reply(200,collector.start_link(payload.get('url',''),payload.get('mode','notice')))
    if route.endswith('/source-pack'): return self.reply(200,collector.import_sources(payload))
    if route.endswith('/sources'): return self.reply(200,collector.configure(payload.get('sources')))
    if route.endswith('/settings'): return self.reply(200,collector.configure_settings(payload.get('settings')))
    if route.endswith('/check'): return self.reply(200,collector.start(payload.get('noticeId'),payload.get('sourceId')))
    if route.endswith('/import'): return self.reply(200,collector.import_revision(payload.get('noticeId'),payload.get('revisionId'),parse,sheets,import_files))
   name=parse_qs(urlparse(self.path).query).get('name',['职位表.xls'])[0]
   self.reply(200,import_files(self.rfile.read(size),Path(name).name,parse,sheets))
  except Exception as e: self.reply(400,{'error':f'导入失败：{e}'})
if __name__=='__main__':
 a=argparse.ArgumentParser(); a.add_argument('--port',type=int); a.add_argument('--open',action='store_true'); args=a.parse_args()
 import errno
 http=None
 for port in ([args.port] if args.port else range(8765,8776)):
  try: http=ThreadingHTTPServer(('127.0.0.1',port),Handler); break
  except OSError as exc:
   if exc.errno!=errno.EADDRINUSE or args.port: raise
 if http is None: raise SystemExit('8765—8775端口均被占用，可用 --port 指定其他端口')
 url=f'http://127.0.0.1:{http.server_port}'; print('公考分析器已启动：'+url,flush=True)
 if args.open: webbrowser.open(url)
 try: http.serve_forever()
 except KeyboardInterrupt: print('\n分析器已停止。')
 finally: http.server_close()
