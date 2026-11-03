"""Read one upload (or archive) into explicit, reviewable file entries."""
import hashlib
import io
import re
import shutil
import subprocess
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_FILE = 20 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024
MAX_ENTRIES = 100
PROVINCES = ['广东','江苏','上海','四川','浙江','山东','北京','天津','重庆','河北','河南','湖北','湖南','安徽','福建','江西','广西','海南','贵州','云南','西藏','陕西','山西','甘肃','青海','宁夏','新疆','辽宁','吉林','黑龙江','内蒙古']

def guess_context(name, text=''):
    # Filename/title clues are suggestions, never confirmation of jurisdiction.
    clue = name + '\n' + text[:350]
    provinces = [p for p in PROVINCES if p in clue]
    years = list(dict.fromkeys(re.findall(r'20\d{2}', name))) or list(dict.fromkeys(re.findall(r'20\d{2}(?=年|年度)', text[:350])))
    return {'province': provinces[0] if len(provinces) == 1 else '', 'year': years[0] if len(years) == 1 else ''}

def guess_role(name):
    if re.search('更正|补充说明|调整|勘误', name): return 'correction'
    if re.search('专业.*目录|专业.*参考', name): return 'catalog'
    if re.search('公安|司法行政|法官助理|检察官助理|监狱|戒毒',name) and re.search('简章|公告',name): return 'special'
    if re.search('报考指南|政策问答', name): return 'guide'
    if re.search('简章|公告|报考条件', name): return 'notice'
    if re.search('大纲|电话|技术问答|考务问答|须知', name): return 'reference'
    return 'unknown'

class VisibleHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.hidden=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript'): self.hidden += 1
        if not self.hidden and tag in ('p','div','br','tr','h1','h2','h3','li'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript'): self.hidden=max(0,self.hidden-1)
        if not self.hidden and tag in ('p','div','tr','li'): self.parts.append('\n')
    def handle_data(self, text):
        if not self.hidden: self.parts.append(text)

def decode(data):
    encodings=('utf-16',) if data.startswith((b'\xff\xfe',b'\xfe\xff')) else ('utf-8-sig','gb18030')
    for enc in encodings:
        try: return data.decode(enc)
        except UnicodeError: pass
    raise ValueError('无法识别文本编码，请另存为UTF-8文本')

def document_blocks(data, name):
    ext=Path(name).suffix.lower(); pages=[]; warnings=[]
    if ext == '.pdf':
        try: from pypdf import PdfReader
        except ImportError as exc: raise ValueError('当前Python缺少PDF读取库，请使用项目启动器或安装requirements.txt') from exc
        reader=PdfReader(io.BytesIO(data))
        if reader.is_encrypted: raise ValueError('加密PDF需先解密再导入')
        if len(reader.pages)>500: raise ValueError('PDF不能超过500页')
        for n,page in enumerate(reader.pages,1):
            text=page.extract_text() or ''
            if len(re.sub(r'\s','',text))<8: warnings.append(f'第{n}页没有可可靠读取的文字，可能需要OCR或人工补录')
            pages.append((f'第{n}页',text))
    elif ext == '.docx':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(x.file_size for x in z.infolist())>MAX_EXPANDED: raise ValueError('DOCX解压体积过大')
            root=ET.fromstring(z.read('word/document.xml'))
            ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            paragraphs=[]
            def collect(node):
                if node.tag.endswith('}p'):
                    paragraphs.append(''.join(t.text or '' for t in node.findall('.//w:t',ns)))
                elif node.tag.endswith('}tbl'):
                    for row in node.findall('.//w:tr',ns):
                        paragraphs.append('\t'.join(''.join(t.text or '' for t in cell.findall('.//w:t',ns)) for cell in row.findall('w:tc',ns)))
                else:
                    for child in node: collect(child)
            collect(root.find('w:body',ns))
            pages=[('正文','\n'.join(paragraphs))]
            extra=[x for x in z.namelist() if re.match(r'word/(footnotes|endnotes|header\d+|footer\d+)\.xml',x)]
            for part in extra:
                content=ET.fromstring(z.read(part))
                pages.append((part.split('/')[-1], '\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in content.findall('.//w:p',ns))))
    elif ext == '.doc':
        converter=shutil.which('textutil') if sys.platform=='darwin' else None
        if not converter: raise ValueError('本机没有DOC转换器，请另存为DOCX或粘贴原文后导入TXT')
        result=subprocess.run([converter,'-convert','txt','-stdout','-stdin','-format','doc'],input=data,capture_output=True,timeout=30)
        if result.returncode: raise ValueError('DOC转换失败，请另存为DOCX或TXT')
        pages=[('转换正文',result.stdout.decode('utf-8'))]
        warnings.append('DOC已转换为文字；表格版式、文本框等请对照原文件核对')
    elif ext in ('.txt','.md','.html','.htm'):
        text=decode(data)
        if ext in ('.html','.htm'):
            parser=VisibleHTML(); parser.feed(text); text=''.join(parser.parts)
        pages=[('正文',text)]
    else: raise ValueError('暂不支持此文件格式，可另存为TXT、DOCX或PDF')
    blocks=[]; chars=0
    for location,text in pages:
        for n,line in enumerate(text.splitlines(),1):
            line=line.strip()
            if not line: continue
            chars+=len(line)
            if chars>1_000_000: raise ValueError('文档文字超过100万字，请拆分文档')
            blocks.append({'id':str(len(blocks)), 'location':f'{location}·段落{n}', 'text':line,
                           'candidate':bool(re.search(r'报考|应届|毕业|学历|学位|专业|户籍|生源|周岁|年龄|经历|资格|证书|党员|团员|服务|限|不得|除外|国籍|犯罪|处分|辞退|在职|退役|体检|考察|回避|截止',line))})
    if not blocks: raise ValueError('没有读取到正文；扫描件需要OCR，可粘贴人工核对后的文字')
    return blocks,warnings

def import_files(data,name,parse_workbook,read_sheets=None):
    entries=[]; budget={'size':0,'count':0}
    def read(blob,filename,archive='',depth=0):
        digest=hashlib.sha256(blob).hexdigest()
        entry={'id':digest,'filename':filename,'archive':archive,'size':len(blob),'kind':'error','status':'error',
               'role':'unknown','confirmed':False,'coverageConfirmed':False,'selectedBlockIds':[],
               'scope':{'city':'','system':'','codes':''},'sourceUrl':'','warnings':[],'context':guess_context(filename)}
        budget['count']+=1
        if budget['count']>MAX_ENTRIES: raise ValueError('一次导入最多100个文件/压缩包条目')
        try:
            if len(blob)>MAX_FILE: raise ValueError('单个文件不能超过20MB')
            ext=Path(filename).suffix.lower()
            if ext=='.json':
                import json
                from major_policy import validate_policy
                policy=validate_policy(json.loads(blob.decode('utf-8-sig')))
                context=policy['context']
                entry.update(kind='document',status='parsed',role='catalog',majorPolicy=policy,context=dict(context),
                             blocks=[{'id':'0','location':'规则文件说明','text':policy['source']['title']+'\n'+policy['source']['url'],'candidate':False}])
                entries.append(entry)
                return
            if ext=='.zip':
                if depth>=2: raise ValueError('ZIP嵌套超过2层，请解压后分别选择')
                with zipfile.ZipFile(io.BytesIO(blob)) as z:
                    items=[i for i in z.infolist() if not i.is_dir() and not i.filename.startswith('__MACOSX/') and Path(i.filename).name!='.DS_Store']
                    if budget['count']+len(items)>MAX_ENTRIES: raise ValueError('压缩包条目过多')
                    expanded=sum(i.file_size for i in items)
                    if budget['size']+expanded>MAX_EXPANDED: raise ValueError('压缩包展开内容不能超过100MB')
                    budget['size']+=expanded
                    for i in items:
                        # Read in memory, never extract archive paths to the filesystem.
                        if i.file_size>MAX_FILE or i.flag_bits&1:
                            entries.append({**entry,'id':hashlib.sha256((digest+i.filename).encode()).hexdigest(),'filename':i.filename,'archive':filename,'error':'条目超过20MB或已加密，未读取'})
                        else: read(z.read(i),i.filename,archive+' / '+filename if archive else filename,depth+1)
                if not items: raise ValueError('压缩包内没有可导入文件')
                return
            if ext in ('.xls','.xlsx','.csv'):
                try:
                    parsed=parse_workbook(blob,filename)
                except ValueError:
                    if not read_sheets: raise
                    tables=read_sheets(blob,filename); blocks=[]
                    for sheet,rows in tables:
                        for n,row in enumerate(rows,1):
                            text='\t'.join(str(v) for v in row if str(v).strip())
                            if text: blocks.append({'id':str(len(blocks)),'location':f'{sheet}·第{n}行','text':text,'candidate':True})
                    if not blocks: raise ValueError('表格没有可读取的内容')
                    entry.update(kind='document',status='parsed',role=guess_role(filename),blocks=blocks,warnings=['未识别为岗位数据，已按表格文字读取，请确认其用途'])
                    entry['context']=guess_context(filename,'\n'.join(b['text'] for b in blocks[:4]))
                else:
                    entry.update(kind='jobs',status='parsed',role='jobs',jobs=parsed['jobs'],sheets=parsed['sheets'])
                    clue='\n'.join(n for j in parsed['jobs'][:1] for n in j.get('notes',[]))
                    entry['context']=guess_context(filename,clue)
                    entry['warnings']=[f'{s["sheet"]}：{s["warning"]}' for s in parsed['sheets'] if s.get('warning')]
            else:
                blocks,warnings=document_blocks(blob,filename)
                entry.update(kind='document',status='partial' if warnings else 'parsed',role=guess_role(filename),blocks=blocks,warnings=warnings)
                entry['context']=guess_context(filename,'\n'.join(b['text'] for b in blocks[:4]))
            entry.pop('error',None)
        except Exception as exc:
            entry.update(kind='error',status='error',error=str(exc))
        entries.append(entry)
    read(data,name)
    return {'files':entries}
