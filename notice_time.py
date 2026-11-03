"""Publication window and registration dates, anchored to registration wording only."""
import re
from datetime import date, datetime, time, timedelta, timezone
from package_import import VisibleHTML

CHINA=timezone(timedelta(hours=8))
DEFAULT_SETTINGS={'period':'30','from':'','to':'','availability':'available'}

def china_now(): return datetime.now(CHINA)
def normalized_settings(value):
    if not isinstance(value,dict): raise ValueError('时间范围设置格式不正确')
    settings={k:str(value.get(k,v)) for k,v in DEFAULT_SETTINGS.items()}
    if settings['period'] not in ('7','30','90','all','custom'): raise ValueError('不支持的公告发布时间范围')
    if settings['availability'] not in ('available','open','upcoming','unknown','closed','all'): raise ValueError('不支持的报名状态')
    for k in ('from','to'):
        if settings[k]:
            if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',settings[k]):raise ValueError('请选择YYYY-MM-DD格式日期')
            try: date.fromisoformat(settings[k])
            except ValueError: raise ValueError('请选择有效日期')
    if settings['period']=='custom':
        if not settings['from'] and not settings['to']: raise ValueError('自定义范围请至少填写起始或结束日期')
        if settings['from'] and settings['to'] and settings['from']>settings['to']: raise ValueError('起始日期不能晚于结束日期')
    return settings

def publication_day(value):
    m=re.search(r'(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})',value or '')
    if not m:return ''
    try:return date(*map(int,m.groups())).isoformat()
    except ValueError:return ''

def publication_in_range(published,settings,today=None):
    day=publication_day(published)
    if not day:return None
    today=today or china_now().date()
    if settings['period']=='all':return True
    lower,upper=(settings['from'],settings['to']) if settings['period']=='custom' else ((today-timedelta(days=int(settings['period'])-1)).isoformat(),today.isoformat())
    return not (lower and day<lower or upper and day>upper)

def visible_text(html):
    parser=VisibleHTML();parser.feed(html)
    return '\n'.join(x.strip() for x in ''.join(parser.parts).splitlines() if x.strip())

DATE=re.compile(r'(?:(?P<y>20\d{2})\s*[年./-]\s*(?P<fm>\d{1,2})\s*[月./-]\s*(?P<fd>\d{1,2})\s*[日号]?|(?<!\d)(?P<m>\d{1,2})月\s*(?P<d>\d{1,2})日|(?<!\d)(?P<day>\d{1,2})日)')
CLOCK=re.compile(r'^\s*[（(]?\s*(?P<part>上午|下午|中午|晚上|早上)?\s*(?:(?P<h>\d{1,2})[:：︰](?P<minute>\d{2})|(?P<hour>\d{1,2})[时点](?:(?P<min>\d{1,2})分?)?)')
ANCHOR=re.compile(r'(?:网上|线上|现场|网络|在线)?报名(?:起止|开始|结束|截止)?(?:时间|日期)|报名(?:截止|截至)|报名(?:自|从|于)|(?:截止|截至)[^。\n]{0,5}报名')
STOP=re.compile(r'缴费(?:时间|截止|截至)|资格(?:审核|审查)(?:时间|截止|截至)|打印准考证|笔试时间|面试时间|体检时间|学历.*截止|经历.*截止')

def extract_registration(html,published='',title=''):
    text=visible_text(html); lines=text.splitlines();windows=[];unresolved=[]
    base_date=date.fromisoformat(publication_day(published)) if publication_day(published) else None
    base_year=base_date.year if base_date else None
    for i,line in enumerate(lines):
        for anchor in ANCHOR.finditer(line):
            chunk=line[anchor.start():][:260]
            if not DATE.search(chunk):
                # A standalone heading may have its dates in the following paragraph.
                if len(chunk)<24:chunk+=' '+ ' '.join(lines[i+1:i+3])[:220]
            chunk=re.split(r'[。；;]',chunk,maxsplit=1)[0]
            stop=STOP.search(chunk)
            if stop:chunk=chunk[:stop.start()]
            found=[];prev=None
            for m in DATE.finditer(chunk):
                y=int(m['y']) if m['y'] else prev.year if prev else base_year
                month=int(m['fm'] or m['m']) if m['fm'] or m['m'] else prev.month if prev else None
                day=int(m['fd'] or m['d'] or m['day'])
                if not y or not month:continue
                if not m['y'] and not prev and base_date and base_date.month==12 and month==1:y+=1
                try:
                    dt=date(y,month,day)
                    # Month/day rollover is only unambiguous after an explicit start.
                    if prev and not m['y'] and dt<prev and month==1 and prev.month==12:dt=date(y+1,month,day)
                except ValueError:continue
                clock=CLOCK.match(chunk[m.end():]);hour=None;minute=0
                if clock:
                    hour=int(clock['h'] or clock['hour']);minute=int(clock['minute'] or clock['min'] or 0)
                    if clock['part'] in ('下午','晚上') and hour<12:hour+=12
                    if clock['part'] in ('上午','早上') and hour==12:hour=0
                    if hour>23 or minute>59:continue
                found.append((dt,hour,minute));prev=dt
                # A single-day window may spell the date once, then two clocks.
                if clock:
                    tail=chunk[m.end()+clock.end():]
                    connector=re.match(r'^\s*(?:至|到|—|－|~|-)\s*',tail)
                    if connector:
                        end_clock=CLOCK.match(tail[connector.end():])
                        if end_clock:
                            eh=int(end_clock['h'] or end_clock['hour']);em=int(end_clock['minute'] or end_clock['min'] or 0)
                            if end_clock['part'] in ('下午','晚上') and eh<12:eh+=12
                            if end_clock['part'] in ('上午','早上') and eh==12:eh=0
                            if eh<=23 and em<=59:found.append((dt,eh,em))
            if not found:continue
            start=None;end=None
            cutoff=bool(re.search(r'报名(?:截止|截至|结束)|(?:截止|截至).{0,6}报名|报名时间.{0,10}(?:截止|截至)',chunk))
            if len(found)>=2:
                start,end=found[0],found[1]
                if len(found)>2:unresolved.append('同段包含多个日期，需核对具体报名批次');continue
            elif cutoff or re.search(r'即日起.{0,12}至|报名.{0,15}至',chunk):end=found[0]
            elif re.search(r'(?:起|开始)',chunk):start=found[0]
            elif found[0][1] is None and re.fullmatch(r'[^:：]*报名(?:时间|日期)\s*[:：为是]?\s*20\d{2}年\d{1,2}月\d{1,2}日\s*',chunk):start=end=found[0]
            else:unresolved.append('只读到一个报名日期，起止含义不明确');continue
            def stamp(item,ending=False):
                if not item:return ''
                d,h,m=item
                return datetime.combine(d,time(h,m) if h is not None else time(23,59,59) if ending else time(0),CHINA).isoformat()
            a,b=stamp(start),stamp(end,True)
            if a and b and a>b:unresolved.append('报名起止时间顺序异常');continue
            if not any(w['start']==a and w['end']==b for w in windows):
                windows.append({'start':a,'end':b,'endPrecision':'minute' if end and end[1] is not None else 'day' if end else '', 'evidence':chunk})
    if re.search('延期|延长|推迟|重新',text) and re.search('另行通知|时间待定',text):unresolved.append('报名时间调整后尚未明确新的截止时间')
    cancelled=any(not re.search('如果|如若|可能|不得|不能|未取消|不取消|未达到|不足|低于|若',s) and re.search(r'(?:现|决定|予以)取消本次(?:公开)?招聘|本次招聘(?:工作)?(?:予以)?取消|(?:现|决定)终止本次(?:公开)?招聘',s) for s in re.split('[。\n]',text))
    return {'windows':windows,'notes':list(dict.fromkeys(unresolved)), 'kind':'update' if re.search('更正|补充|调整|延期|取消',title) else 'stage' if re.search('拟聘|拟录用|资格审核|资格复审|体检|考察|成绩|录用公示|进入面试|面试(?:安排|公告|通知|有关事项|等事项)',title) else 'recruitment','cancelled':cancelled}

def registration_state(timing,current=None):
    timing=timing or {};current=current or china_now()
    if timing.get('cancelled'):return {'state':'closed','label':'招聘已取消','reason':'公告明确取消本次招聘'}
    if timing.get('kind')=='stage':return {'state':'stage','label':'后续招录环节','reason':'面试、体检、拟聘等公告，不作为新的报名机会'}
    windows=timing.get('windows',[])
    ends=[datetime.fromisoformat(w['end']) for w in windows if w.get('end')]
    starts=[datetime.fromisoformat(w['start']) for w in windows if w.get('start')]
    if not timing.get('notes') and windows and len(ends)==len(windows) and all(current>e for e in ends):return {'state':'closed','label':'报名已截止','reason':'已超过识别到的报名截止时间'}
    if timing.get('notes') or len(windows)>1:return {'state':'unknown','label':'时间待核对','reason':'存在多批次或起止时间歧义'}
    if len(starts)==1 and current<starts[0]:return {'state':'upcoming','label':'尚未开始报名','reason':'还未到报名开始时间'}
    if len(windows)==1 and starts and ends and starts[0]<=current<=ends[0]:return {'state':'open','label':'报名期内','reason':'处于公告报名起止范围；每日办理时段以原文为准'}
    return {'state':'unknown','label':'时间待核对','reason':'未识别到明确的完整报名时间；不能据此判断可报名'}

def availability_matches(validity,mode):
    state=validity['state']
    if mode=='all':return True
    if mode=='available':return state in ('open','upcoming','unknown')
    if mode=='closed':return state in ('closed','stage')
    return state==mode
