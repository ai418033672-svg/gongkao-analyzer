"""Portable source-book metadata. Entries and active crawl configuration are distinct."""
import json
from pathlib import Path

TEXT_FIELDS=('province','city','publisher','examType','publicationMethod','note')

def load_catalog(root):
    path=Path(root)/'source_catalog.json'
    data=json.loads(path.read_text('utf-8'))
    return data

def source_metadata(source):
    return {key:str(source.get(key,'')).strip()[:600] for key in TEXT_FIELDS}

def parse_source_pack(payload):
    if not isinstance(payload,dict) or payload.get('format')!='gongkao-source-book' or payload.get('version')!=1:
        raise ValueError('不是受支持的来源目录文件')
    sources=payload.get('sources')
    if not isinstance(sources,list) or not 1<=len(sources)<=200:raise ValueError('来源文件需包含1—200个栏目')
    if any(not isinstance(s,dict) for s in sources):raise ValueError('来源记录格式不正确')
    return sources
