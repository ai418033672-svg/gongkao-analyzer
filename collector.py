"""Bounded, manual public-notice collection. Original bytes and versions stay local."""
import hashlib
import http.client
import ipaddress
import json
import re
import socket
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote, quote, parse_qs
from urllib.robotparser import RobotFileParser
from source_book import source_metadata,parse_source_pack
from notice_time import DEFAULT_SETTINGS, normalized_settings, publication_day, publication_in_range, extract_registration, registration_state, availability_matches, china_now

AGENT = 'GongkaoAnalyzer/1.0'
EXTENSIONS = {'.xls','.xlsx','.csv','.pdf','.doc','.docx','.txt','.zip','.rar','.7z'}
DEFAULT_SOURCES = [
 {'province':'广东','publisher':'广东组织工作网','examType':'公务员','publicationMethod':'组织部门栏目公告与附件','id':'guangdong-gwy','name':'广东组织工作网 · 公务员录用','url':'https://www.gdzz.gov.cn/gwygz/lypytzgg/index.html','keywords':'公务员,录用,更正,延期','enabled':True},
 {'province':'广东','city':'汕头','publisher':'汕头市政府','examType':'公务员 / 事业单位','publicationMethod':'政府招考栏目公告与附件','id':'shantou-zk','name':'汕头市政府 · 招考录用','url':'https://www.shantou.gov.cn/cnst/zwgk/jcxxgk/rsxx/zkly/index.html','keywords':'招聘,录用,招考,更正,延期','enabled':False},
]

def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(url):
    p=urlsplit(url.strip())
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password:
        raise ValueError('仅支持不含账号密码的公开HTTP/HTTPS地址')
    if p.port not in (None,443 if p.scheme=='https' else 80): raise ValueError('只支持协议对应的标准80/443端口')
    host=p.hostname.encode('idna').decode('ascii').lower()
    if ':' in host:host='['+host+']'
    return urlunsplit((p.scheme,host,quote(p.path or '/',safe='/%:@-._~!$&\x27()*+,;='),quote(p.query,safe='/%?:@-._~!$&\x27()*+,;='),''))

def public_addresses(host, port, allow_virtual=False):
    addresses=list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)))
    # Some local VPN clients resolve public names to RFC2544 fake IPs. Permit
    # that transport only for HTTPS *.gov.cn; TLS still verifies the real name.
    def permitted(x):
        ip=ipaddress.ip_address(x)
        return ip.is_global or (allow_virtual and ip.version==4 and ip in ipaddress.ip_network('198.18.0.0/15'))
    if not addresses or any(not permitted(x) for x in addresses):
        raise ValueError('采集地址必须指向公网，不能访问本机或内网')
    return addresses

class Fetcher:
    """Validate every redirect and pin the connection to the validated public IP."""
    def __init__(self):
        self.robots={}; self.last={}; self.bytes=0; self.requests=0

    def raw(self,url,limit=20*1024*1024):
        for _ in range(6):
            url=canonical(url); p=urlsplit(url); port=443 if p.scheme=='https' else 80
            ips=public_addresses(p.hostname,port,p.scheme=='https' and p.hostname.endswith('.gov.cn'))
            delay=.7-(time.monotonic()-self.last.get(p.hostname,0))
            if delay>0: time.sleep(delay)
            self.last[p.hostname]=time.monotonic(); self.requests+=1
            if self.requests>100: raise ValueError('达到本次100次请求上限，请分批检查')
            conn=(http.client.HTTPSConnection if p.scheme=='https' else http.client.HTTPConnection)(p.hostname,port,timeout=12)
            conn._create_connection=lambda address,timeout,source_address=None: socket.create_connection((ips[0],port),timeout,source_address)
            try:
                conn.request('GET',urlunsplit(('', '',p.path or '/',p.query,'')),headers={'User-Agent':AGENT,'Accept-Encoding':'identity','Accept':'*/*'})
                response=conn.getresponse(); status=response.status; headers={k.lower():v for k,v in response.getheaders()}
                if status in (301,302,303,307,308):
                    if not headers.get('location'): raise ValueError('网站重定向缺少目标地址')
                    target=canonical(urljoin(url,headers['location']))
                    if urlsplit(target).hostname!=p.hostname:
                        raise ValueError('网站重定向到其他域名，请以目标官网地址另建来源')
                    url=target; continue
                if headers.get('content-encoding','identity') not in ('','identity'): raise ValueError('网站返回压缩响应，暂不支持此来源')
                if int(headers.get('content-length','0'))>limit: raise ValueError('文件超过单次下载大小上限')
                data=response.read(limit+1); self.bytes+=len(data)
                if len(data)>limit or self.bytes>100*1024*1024: raise ValueError('达到下载体积上限（单文件20MB，本次100MB）')
                return {'url':url,'data':data,'headers':headers,'status':status}
            finally: conn.close()
        raise ValueError('网站重定向过多')

    def get(self,url,limit=20*1024*1024):
        url=canonical(url); p=urlsplit(url); origin=f'{p.scheme}://{p.netloc}'
        if origin not in self.robots:
            robots=self.raw(origin+'/robots.txt',512*1024)
            if robots['status'] in (404,410): text='User-agent: *\nAllow: /'
            elif robots['status']==200:
                text=robots['data'].decode('utf-8','replace')
                if '<html' in text.lower(): raise ValueError('robots.txt返回网页，暂不能确认访问规则')
            else: raise ValueError(f'访问规则暂不可用（HTTP {robots["status"]}），本次未继续采集')
            rp=RobotFileParser(); rp.parse(text.splitlines()); self.robots[origin]=rp
        rp=self.robots[origin]
        if not rp.can_fetch(AGENT,url): raise ValueError('网站robots.txt不允许采集此路径')
        crawl_delay=rp.crawl_delay(AGENT) or 0
        if crawl_delay>30: raise ValueError('网站要求较长抓取间隔，请改为手动下载')
        delay=crawl_delay-(time.monotonic()-self.last.get(p.hostname,0))
        if delay>0: time.sleep(delay)
        result=self.raw(url,limit)
        if result['status']!=200: raise ValueError(f'网站返回HTTP {result["status"]}')
        return result

def html_text(result):
    data=result['data']; content_type=result['headers'].get('content-type','')
    encoding=re.search(r'charset\s*=\s*["\x27]?([\w-]+)',content_type,re.I)
    if not encoding: encoding=re.search(br'charset\s*=\s*["\x27]?([\w-]+)',data[:4000],re.I)
    if encoding:
        enc=encoding.group(1); enc=enc.decode('ascii') if isinstance(enc,bytes) else enc
        try: return data.decode(enc)
        except (UnicodeError,LookupError): pass
    for enc in ('utf-8-sig','gb18030'):
        try: return data.decode(enc)
        except UnicodeError: pass
    raise ValueError('网页编码无法识别')

class Links(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True); self.links=[]; self.current=None; self.hidden=0; self.meta={}
        self.feed(text)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='meta': self.meta[(a.get('name') or a.get('property') or '').lower()]=a.get('content','')
        if tag in ('script','style','noscript'): self.hidden+=1
        if tag=='a' and not self.hidden:
            if self.current: self.finish()
            self.current={'href':a.get('href',''),'title':a.get('title',''),'parts':[]}
    def handle_data(self,text):
        if self.current and not self.hidden: self.current['parts'].append(text)
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'): self.hidden=max(0,self.hidden-1)
        if tag=='a': self.finish()
    def finish(self):
        if self.current:
            a=self.current; a['text']=re.sub(r'\s+',' ',''.join(a.pop('parts'))).strip() or a['title']
            self.links.append(a); self.current=None

class DatedLinks(Links):
    def __init__(self,text):
        self.rows=[];super().__init__(text)
    def handle_starttag(self,tag,attrs):
        if tag in ('li','tr'):self.rows.append({'tag':tag,'parts':[],'links':[]})
        super().handle_starttag(tag,attrs)
    def handle_data(self,text):
        super().handle_data(text)
        if not self.hidden:
            for row in self.rows:row['parts'].append(text)
    def finish(self):
        before=len(self.links);super().finish()
        if len(self.links)>before:
            for row in self.rows:row['links'].append(self.links[-1])
    def handle_endtag(self,tag):
        super().handle_endtag(tag)
        if self.rows and tag==self.rows[-1]['tag']:
            row=self.rows.pop();dates=set(re.findall(r'20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}', ''.join(row['parts'])))
            if len(dates)==1:
                day=publication_day(next(iter(dates)))
                if day:
                    for link in row['links']:link.setdefault('publishedAt',day)

def extension(url):
    p=urlsplit(url);ext=Path(unquote(p.path)).suffix.lower()
    if ext in EXTENSIONS:return ext
    for key,values in parse_qs(p.query).items():
        if key.lower() in ('filename','file','downloadfilename'):
            candidate=Path(values[0]).suffix.lower()
            if candidate in EXTENSIONS:return candidate
    return ext

def notice_links(text,base,keywords):
    words=[x.strip() for x in re.split('[,，;；\n]',keywords) if x.strip()]
    out=[]; seen=set(); root=urlsplit(base).hostname
    for a in DatedLinks(text).links:
        title=a['title'] or a['text']
        if len(title)<8 or not any(w in title for w in words): continue
        try: url=canonical(urljoin(base,a['href']))
        except ValueError: continue
        if urlsplit(url).hostname!=root or url==canonical(base) or extension(url) in EXTENSIONS: continue
        if re.search(r'^(javascript|mailto):',a['href'],re.I) or url in seen: continue
        if re.search(r'/index(?:_\d+)?\.(?:html?|shtml)$',urlsplit(url).path): continue
        seen.add(url); out.append({'id':digest(url.encode()),'url':url,'title':title[:300],'publishedAt':a.get('publishedAt','')})
    return out[:30]

def attachment_links(text,base):
    out=[]; seen=set()
    # Some official TRS pages emit literal attachment anchors with document.write.
    # Read only literal anchor markup; never execute JavaScript or infer API calls.
    emitted=''.join(m.group(2) for m in re.finditer(r'''document\.write\(\s*(['"])(<a\s[^\r\n]*?</a>.*?)\1\s*\)''',text,re.I))
    for a in Links(text).links+Links(emitted).links:
        try: url=canonical(urljoin(base,a['href']))
        except ValueError: continue
        ext=extension(url)
        if ext not in EXTENSIONS or url in seen: continue
        seen.add(url)
        label=a['text'] or a['title'] or unquote(urlsplit(url).path.rsplit('/',1)[-1])
        label=re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',label).strip()[:160] or '附件'
        if not label.lower().endswith(ext): label+=ext
        out.append({'url':url,'filename':label})
    return out

class ArticleHTML(HTMLParser):
    """Only known article containers; never silently assume the whole page is body."""
    VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self,text):
        super().__init__(convert_charrefs=False);self.depth=0;self.parts=[];self.found=False
        self.feed(text)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);classes=set(a.get('class','').lower().split())
        if not self.found and tag in ('div','article','main') and (a.get('id','').lower() in {'zoom','zoomcon','ucap-content','article-content','ndetails'} or classes & {'zw','trs_editor','article-content'}):
            self.found=True;self.depth=1;self.parts.append(self.get_starttag_text());return
        if self.depth:
            self.parts.append(self.get_starttag_text())
            if tag not in self.VOID:self.depth+=1
    def handle_endtag(self,tag):
        if self.depth:
            self.parts.append(f'</{tag}>')
            if tag not in self.VOID:self.depth-=1
    def handle_data(self,text):
        if self.depth:self.parts.append(text)
    def handle_entityref(self,name):
        if self.depth:self.parts.append('&'+name+';')
    def handle_charref(self,name):
        if self.depth:self.parts.append('&#'+name+';')

class Collector:
    def __init__(self,root,fetcher_factory=Fetcher):
        self.root=Path(root); self.lock=threading.RLock(); self.fetcher_factory=fetcher_factory
        self.state={'sources':json.loads(json.dumps(DEFAULT_SOURCES)),'notices':[]}; self.job=None
        path=self.root/'state.json'
        if path.exists():
            self.state=json.loads(path.read_text('utf-8'))
            self.job=self.state.get('lastRun')
            if self.job and self.job.get('status')=='running':
                self.job={**self.job,'status':'error','message':'上次采集未完成，请重新检查更新'}
        for source in self.state['sources']:
            default=next((d for d in DEFAULT_SOURCES if d['url']==source['url']),{})
            for key,value in source_metadata(default).items():
                if key not in source:source[key]=value
        self.state.setdefault('settings',dict(DEFAULT_SETTINGS))
        # Enrich old downloaded records locally; never download them just to migrate.
        for n in self.state['notices']:
            if 'timing' in n:continue
            if not n.get('revisions'):
                n['timing']=extract_registration('',n.get('publishedAt',''),n['title']);continue
            try:
                f=n['revisions'][-1]['files'][0]
                text=(self.root/'files'/f['sha']).read_text('utf-8')
                n['timing']=extract_registration(text,n.get('publishedAt',''),n['title'])
            except (OSError,UnicodeError,KeyError,IndexError):pass

    def save(self):
        self.root.mkdir(parents=True,exist_ok=True)
        tmp=self.root/'state.tmp'; tmp.write_text(json.dumps(self.state,ensure_ascii=False,indent=2),'utf-8'); tmp.replace(self.root/'state.json')

    def view(self):
        with self.lock:
            for n in self.state['notices']:
                if not n.get('timing'):n['timing']=extract_registration('',n.get('publishedAt',''),n['title'])
            notices=[{**n,'validity':registration_state(n.get('timing')),'inPublicationRange':publication_in_range(n.get('publishedAt',''),self.state['settings'])} for n in self.state['notices']]
            return json.loads(json.dumps({**self.state,'notices':notices,'job':self.job,'today':china_now().date().isoformat(),'currentTime':china_now().isoformat(),'storage':'data/collector','limits':'仅栏目当前页，最多发现30条；按有效期筛选后每源最多复查3条，不代表全站覆盖'}))

    def configure_settings(self,value):
        settings=normalized_settings(value)
        with self.lock:self.state['settings']=settings;self.save()
        return self.view()

    def configure(self,sources):
        if not isinstance(sources,list) or not 1<=len(sources)<=200: raise ValueError('请配置1—200个来源（最多启用10个）')
        cleaned=[]
        for s in sources:
            if not isinstance(s,dict):raise ValueError('来源记录格式不正确')
            url=canonical(str(s.get('url',''))); name=str(s.get('name','')).strip()[:100]
            keywords=str(s.get('keywords','公告,招聘,录用')).strip()[:300]
            if not name or not keywords: raise ValueError('来源名称和关键词不能为空')
            cleaned.append({'id':digest(url.encode())[:20],'name':name,'url':url,'keywords':keywords,'enabled':s.get('enabled') is True,**source_metadata(s)})
        if sum(s['enabled'] for s in cleaned)>10:raise ValueError('最多同时启用10个来源；其他来源可保存但停用')
        if len({s['url'] for s in cleaned})!=len(cleaned): raise ValueError('来源网址不能重复')
        with self.lock:
            if self.job and self.job['status']=='running': raise ValueError('采集中暂不能修改来源')
            for s in cleaned:
                previous=next((x for x in self.state['sources'] if x['url']==s['url']),{})
                for k in ('lastSuccessAt','lastAttemptAt','error','discovered'):
                    if k in previous:s[k]=previous[k]
            self.state['sources']=cleaned; self.save()
        return self.view()

    def import_sources(self,payload):
        imported=parse_source_pack(payload)
        with self.lock:
            merged=[dict(s) for s in self.state['sources']]
            urls={canonical(s['url']) for s in merged}
            for source in imported:
                url=canonical(str(source.get('url','')))
                if url in urls:continue
                merged.append({**source,'url':url,'enabled':False});urls.add(url)
            return self.configure(merged)

    def start_link(self,url,mode='notice'):
        url=canonical(str(url))
        if mode not in ('notice','list'):raise ValueError('请选择公告/附件或公告栏目')
        # Reject literal private targets before persisting; DNS and redirects are
        # independently checked at connection time by Fetcher.
        host=urlsplit(url).hostname
        try:literal=ipaddress.ip_address(host)
        except ValueError:literal=None
        if literal is not None and not literal.is_global:raise ValueError('不能采集本机或内网地址')
        if host.lower()=='localhost' or host.lower().endswith('.localhost'):raise ValueError('不能采集本机地址')
        with self.lock:
            if self.job and self.job['status']=='running':raise ValueError('已有采集任务正在运行')
            if mode=='list':
                source=next((s for s in self.state['sources'] if s['url']==url),None)
                if not source:
                    self.configure([*self.state['sources'],{'name':host+' · 用户栏目','url':url,'keywords':'公告,招聘,录用,招考,职位,更正,延期','enabled':False}])
                    source=next(s for s in self.state['sources'] if s['url']==url)
                return self.start(source_id=source['id'])
            notice=next((n for n in self.state['notices'] if n['url']==url),None)
            if not notice:
                if len(self.state['notices'])>=5000:raise ValueError('本机记录达到5000条上限')
                notice={'id':digest(url.encode()),'url':url,'title':unquote(urlsplit(url).path.rsplit('/',1)[-1]) or host,
                        'sourceName':'链接导入 · '+host,'sourceId':'direct','direct':True,'status':'found','firstSeenAt':now(),'revisions':[]}
                self.state['notices'].append(notice)
            return self.start(notice_id=notice['id'])

    def material_catalog(self):
        data=json.loads((Path(__file__).parent/'material_catalog.json').read_text('utf-8'))
        for item in data['entries']:
            n=next((n for n in self.state['notices'] if n['url']==item['url']),None)
            item['downloaded']=bool(n and self.local_complete(n))
            item['noticeId']=n['id'] if n else ''
        return data

    def start_materials(self,ids):
        with self.lock:
            if self.job and self.job['status']=='running':raise ValueError('已有采集任务正在运行')
            if not isinstance(ids,list) or not 1<=len(ids)<=20 or any(not isinstance(i,str) for i in ids):raise ValueError('每批请选择1—20项资料')
            catalog={item['id']:item for item in self.material_catalog()['entries']}
            if any(i not in catalog for i in ids):raise ValueError('资料清单已变化，请重新选择')
            selected=[catalog[i] for i in dict.fromkeys(ids)]
            missing=sum(not any(n['url']==item['url'] for n in self.state['notices']) for item in selected)
            if len(self.state['notices'])+missing>5000:raise ValueError('本机记录达到5000条上限')
            self.job={'status':'running','startedAt':now(),'message':'准备抓取所选资料…','logs':[],
                      'settings':dict(self.state['settings']),'selectedIds':[item['id'] for item in selected]}
            self.state['lastRun']=self.job;self.save()
            threading.Thread(target=self.run_materials,args=(selected,),daemon=True).start()
        return self.view()

    def run_materials(self,selected):
        try:
            fetcher=self.fetcher_factory()
            for i,item in enumerate(selected,1):
                self.log(f'所选资料 {i}/{len(selected)}：'+item['title'])
                with self.lock:
                    notice=next((n for n in self.state['notices'] if n['url']==item['url']),None)
                    if not notice:
                        notice={'id':digest(item['url'].encode()),'url':item['url'],'title':item['title'],
                                'direct':True,'sourceId':'materials','sourceName':item['province']+' '+item['year']+' 省考资料清单',
                                'firstSeenAt':now(),'status':'found','revisions':[],'publishedAt':item['publishedAt']}
                        self.state['notices'].append(notice)
                    notice.update(curatedTitle=item['title'],expectedAttachments=item.get('expectedAttachments',False))
                if self.local_complete(notice):
                    self.log('已在本机，跳过联网下载：'+item['title']);continue
                self.collect(notice,fetcher,force=False)
            with self.lock:
                errors=any(l['error'] for l in self.job['logs'])
                self.job.update(status='partial' if errors else 'done',finishedAt=now(),message='所选资料处理结束；部分失败，请查看记录' if errors else '所选资料处理完成；已有资料已复用')
                self.save()
        except Exception as exc:
            with self.lock:
                self.log(str(exc),True);self.job.update(status='error',finishedAt=now());self.save()

    def collect_attachment(self,notice,result,filename):
        ext=Path(filename).suffix.lower()
        if ext in ('.rar','.7z'):raise ValueError('暂不支持RAR/7Z，请下载解压后导入')
        data=result['data']
        if re.search(br'<(?:html|!doctype)\b',data[:500],re.I):raise ValueError('附件链接返回网页，请粘贴公告地址或从官网下载')
        sha=self.blob(data)
        file={'filename':filename,'url':result['url'],'sha':sha,'size':len(data)}
        fingerprint=digest(json.dumps(file,sort_keys=True).encode())
        with self.lock:
            old=notice.get('revisions',[])
            if not old or old[-1]['id']!=fingerprint:
                old.append({'id':fingerprint,'collectedAt':now(),'rawSha':sha,'files':[file],'errors':[],'directAttachment':True})
                notice['change']='新增附件' if len(old)==1 else '附件有变化，旧版本保留'
            else:notice['change']='内容未变化'
            notice.update(title=filename,revisions=old,status='downloaded',lastCheckedAt=now(),error='',timing=extract_registration('','',''))
            self.save()
        self.log(filename+'：'+notice['change']+'；单独附件未提供公告报名时间')

    def start(self,notice_id=None,source_id=None):
        with self.lock:
            if self.job and self.job['status']=='running': raise ValueError('已有采集任务正在运行')
            if notice_id and source_id:raise ValueError('不能同时指定公告与栏目')
            if source_id and not any(s['id']==source_id for s in self.state['sources']):raise ValueError('栏目不存在')
            if notice_id and not any(n['id']==notice_id for n in self.state['notices']): raise ValueError('公告不存在')
            if not notice_id and not source_id and not any(s['enabled'] for s in self.state['sources']): raise ValueError('请至少启用一个来源')
            self.job={'status':'running','startedAt':now(),'message':'准备联网检查…','logs':[]}
            self.state['lastRun']=self.job
            self.job['settings']=dict(self.state['settings'])
            self.save()
            threading.Thread(target=self.run,args=(notice_id,source_id),daemon=True).start()
        return self.view()

    def log(self,text,error=False):
        with self.lock:
            self.job['message']=text; self.job['logs'].append({'time':now(),'text':text,'error':error})
            self.job['logs']=self.job['logs'][-100:]

    def blob(self,data):
        sha=digest(data); path=self.root/'files'/sha
        path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists() or digest(path.read_bytes())!=sha: path.write_bytes(data)
        return sha

    def local_complete(self,notice):
        revisions=notice.get('revisions',[])
        return bool(revisions and not revisions[-1].get('errors') and revisions[-1].get('files') and all(self.local_file(f) for f in revisions[-1]['files']))

    def local_file(self,file):
        path=self.root/'files'/file['sha']
        return path.is_file() and digest(path.read_bytes())==file['sha']

    def collect(self,notice,fetcher,force=True):
        self.log('读取公告：'+notice['title'])
        try:
            result=fetcher.get(notice['url'],20*1024*1024 if notice.get('direct') else 4*1024*1024)
            filename=unquote(urlsplit(result['url']).path.rsplit('/',1)[-1])
            disposition=result['headers'].get('content-disposition','')
            match=re.search(r"filename\*=UTF-8''([^;]+)|filename=[\"']?([^;\"']+)",disposition,re.I)
            if match:filename=unquote(match.group(1) or match.group(2)).strip()
            filename=re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',filename)[:180]
            if Path(filename).suffix.lower() in EXTENSIONS:
                self.collect_attachment(notice,result,filename);return
            text=html_text(result)
            if not re.search(r'<(?:html|body|div|p|article)\b',text,re.I): raise ValueError('未读到可识别的公告网页')
            if re.search(r'<title[^>]*>[^<]*(?:验证码|访问验证|安全验证|Access Denied|403)',text,re.I): raise ValueError('网站要求访问验证，请手动打开官网下载')
            # Keep original HTML bytes, and a UTF-8 copy for the existing importer.
            article=ArticleHTML(text)
            imported=('<html><body><h1>'+escape(notice['title'])+'</h1>'+''.join(article.parts)+'</body></html>') if article.found and article.depth==0 else text
            meta=Links(text).meta
            if notice.get('direct'):
                heading=re.search(r'<h1\b[^>]*>(.*?)</h1>|<title\b[^>]*>(.*?)</title>',text,re.I|re.S)
                title=meta.get('articletitle') or (re.sub('<[^>]+>','',heading.group(1) or heading.group(2)).strip() if heading else '')
                if title:notice['title']=notice.get('curatedTitle') or title[:300]
                visible=re.sub(r'<script\b.*?</script>|<style\b.*?</style>','',text,flags=re.I|re.S)
                visible=re.sub('<[^>]+>','',visible).strip()
                if len(visible)<80 and re.search(r'id=["\']app["\']',text):raise ValueError('页面需要浏览器加载，请打开官网后下载附件导入')
                if article.found and article.depth==0:imported='<html><body><h1>'+escape(notice['title'])+'</h1>'+''.join(article.parts)+'</body></html>'
            published=meta.get('pubdate') or meta.get('publishdate') or meta.get('article:published_time') or notice.get('publishedAt','')
            timing=extract_registration(imported,published,notice['title'])
            settings=self.job.get('settings',self.state['settings'])
            with self.lock:
                notice.update(publishedAt=published,timing=timing,lastCheckedAt=now())
                validity=registration_state(timing)
                outside=publication_in_range(published,settings) is False
                if outside or not availability_matches(validity,settings['availability']):
                    notice.update(status='skipped',skipReason='公告发布时间不在所选范围' if outside else validity['label'],error='')
                    self.save();self.log(notice['title']+'：'+notice['skipReason']+'，未下载附件');return
                notice.pop('skipReason',None)
            raw=self.blob(result['data']);body=self.blob(imported.encode('utf-8'))
            files=[{'filename':re.sub(r'[\\/:*?"<>|]','_',notice['title'])[:150]+'.html','sha':body,'url':result['url'],'size':len(imported.encode('utf-8'))}]
            errors=[]; links=attachment_links(text,result['url'])
            if notice.get('expectedAttachments') and not links:errors.append('未识别到预期附件，请打开官网核对或手动补齐')
            previous=notice.get('revisions',[])
            reusable=previous[-1]['files'][1:] if previous and previous[-1].get('rawSha')==raw and not force else []
            if len(links)>12: errors.append(f'发现{len(links)}份附件，本次只下载前12份，其余请手动补齐')
            for a in links[:12]:
                cached=next((f for f in reusable if f['url']==a['url'] and self.local_file(f)),None)
                if cached:
                    files.append(cached);self.log('复用本机附件：'+a['filename']);continue
                self.log('下载附件：'+a['filename'])
                try:
                    if extension(a['url']) in ('.rar','.7z'): raise ValueError('暂不支持RAR/7Z，请从官网下载并解压后导入')
                    asset=fetcher.get(a['url']); data=asset['data']
                    if b'<html' in data[:500].lower() and extension(a['url']) not in ('.txt',): raise ValueError('附件链接返回网页，可能已失效或要求验证')
                    files.append({**a,'url':asset['url'],'sha':self.blob(data),'size':len(data)})
                except Exception as exc:
                    errors.append(a['filename']+'：'+str(exc)); self.log(errors[-1],True)
            fingerprint=digest(json.dumps({'raw':raw,'files':files,'errors':errors},ensure_ascii=False,sort_keys=True).encode())
            with self.lock:
                old=notice.get('revisions',[])
                if not old or old[-1]['id']!=fingerprint:
                    old.append({'id':fingerprint,'collectedAt':now(),'rawSha':raw,'files':files,'errors':errors,'bodyExtracted':article.found and article.depth==0})
                    notice['revisions']=old
                    notice['change']='新增资料' if len(old)==1 else '网页或附件有变化，旧版本保留'
                else: notice['change']='内容未变化'
                notice.update(status='partial' if errors else 'downloaded',lastCheckedAt=now(),error='',publishedAt=published)
                self.save()
            self.log(notice['title']+'：'+notice['change']+('；附件未完整下载' if errors else ''))
        except Exception as exc:
            with self.lock:
                notice.update(status='error',error=str(exc),lastAttemptAt=now()); self.save()
            self.log(notice['title']+'：'+str(exc),True)

    def run(self,notice_id=None,source_id=None):
        failed=False
        try:
            fetcher=self.fetcher_factory()
            if notice_id:
                self.collect(next(n for n in self.state['notices'] if n['id']==notice_id),fetcher)
            else:
                for source in self.state['sources']:
                    if source_id and source['id']!=source_id:continue
                    if not source_id and not source['enabled']: continue
                    self.log('检查栏目：'+source['name'])
                    try:
                        result=fetcher.get(source['url'],4*1024*1024)
                        candidates=notice_links(html_text(result),result['url'],source['keywords'])
                        if not candidates: raise ValueError('未识别到匹配公告；可能没有关键词命中、网页结构变化或需要浏览器加载')
                        settings=self.job.get('settings',self.state['settings'])
                        in_range=[c for c in candidates if publication_in_range(c.get('publishedAt',''),settings) is not False]
                        self.log(f'栏目匹配{len(candidates)}条，发布时间范围外跳过{len(candidates)-len(in_range)}条')
                        with self.lock:
                            # Refresh dates of existing history without fetching old pages.
                            for item in candidates:
                                existing=next((n for n in self.state['notices'] if n['id']==item['id']),None)
                                if existing and item.get('publishedAt'):
                                    if publication_day(existing.get('publishedAt',''))!=publication_day(item['publishedAt']):
                                        existing['publishedAt']=item['publishedAt'];existing['timing']=extract_registration('',item['publishedAt'],item['title'])
                            for item in in_range:
                                existing=next((n for n in self.state['notices'] if n['id']==item['id']),None)
                                if not existing:
                                    if len(self.state['notices'])>=5000: raise ValueError('本机记录达到5000条上限')
                                    self.state['notices'].append({**item,'sourceId':source['id'],'sourceName':source['name'],'firstSeenAt':now(),'status':'found','revisions':[],'timing':extract_registration('',item.get('publishedAt',''),item['title'])})
                                else:
                                    existing['title']=item['title']
                                    if item.get('publishedAt'):
                                        if publication_day(existing.get('publishedAt',''))!=publication_day(item['publishedAt']):existing['timing']=extract_registration('',item['publishedAt'],item['title'])
                                        existing['publishedAt']=item['publishedAt']
                            source.update(lastSuccessAt=now(),error='',discovered=len(candidates)); self.save()
                        eligible=[]
                        for item in in_range:
                            n=next(n for n in self.state['notices'] if n['id']==item['id'])
                            if n.get('timing') and registration_state(n['timing'])['state']!='unknown' and not availability_matches(registration_state(n['timing']),settings['availability']):
                                self.log(n['title']+'：'+registration_state(n['timing'])['label']+'，本次跳过');continue
                            eligible.append(n)
                        for n in eligible[:3]:self.collect(n,fetcher,force=False)
                    except Exception as exc:
                        failed=True
                        with self.lock: source.update(lastAttemptAt=now(),error=str(exc)); self.save()
                        self.log(source['name']+'：'+str(exc),True)
            with self.lock:
                errors=any(x['error'] for x in self.job['logs'])
                self.job.update(status='partial' if failed or errors else 'done',finishedAt=now(),message='本次检查结束；有失败或未完整下载项' if failed or errors else '本次检查完成')
                self.state['lastRun']=self.job; self.save()
        except Exception as exc:
            self.log(str(exc),True)
            with self.lock:
                self.job.update(status='error',finishedAt=now())
                self.state['lastRun']=self.job; self.save()

    def import_revision(self,notice_id,revision_id,parse,sheets,import_files):
        with self.lock:
            notice=next((n for n in self.state['notices'] if n['id']==notice_id),None)
            if not notice: raise ValueError('公告不存在')
            rev=next((r for r in notice['revisions'] if r['id']==revision_id),None)
            if not rev: raise ValueError('版本不存在')
            rev=json.loads(json.dumps(rev)); title=notice['title']; notice_url=notice['url']
        entries=[]
        for f in rev['files']:
            data=(self.root/'files'/f['sha']).read_bytes()
            if digest(data)!=f['sha']: raise ValueError('本机采集文件校验失败，请重新下载')
            parsed=import_files(data,f['filename'],parse,sheets)
            for entry in parsed['files']:
                entry.update(sourceUrl=f['url'],collection={'noticeUrl':notice_url,'title':title,'revisionId':rev['id'],'collectedAt':rev['collectedAt'],'sha':f['sha']})
                entry['warnings'].append('联网采集文件：自动提取正文和条件，复杂条款仍保留依据与待核对项')
                if rev.get('directAttachment'):
                    entry['warnings'].append('单独附件链接：未包含主公告，报名时间和共性资格需由配套资料补充')
                if f==rev['files'][0] and not rev.get('bodyExtracted') and not rev.get('directAttachment'):
                    entry['warnings'].append('未定位到已适配的正文区域，已保留整页可见文字，请剔除导航及无关内容')
                if rev['errors']:
                    entry['warnings'].append('本次附件下载不完整：'+'；'.join(rev['errors']))
                    if entry['kind']=='document': entry['status']='partial'
                entries.append(entry)
        return {'files':entries,'warnings':rev['errors']}

    def saved_file(self,notice_id,revision_id,sha):
        with self.lock:
            notice=next((n for n in self.state['notices'] if n['id']==notice_id),None)
            rev=next((r for r in (notice or {}).get('revisions',[]) if r['id']==revision_id),None)
            file=next((f for f in (rev or {}).get('files',[]) if f['sha']==sha),None)
            if not file: raise ValueError('本机采集文件不存在')
            data=(self.root/'files'/file['sha']).read_bytes()
            if digest(data)!=file['sha']: raise ValueError('文件指纹校验失败，请重新下载')
            return file['filename'],data
