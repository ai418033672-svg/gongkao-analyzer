#!/usr/bin/env python3
"""Audit the Git index and optionally export its current source files. No publishing."""
import argparse
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
ROOT_FILES={'.gitignore','README.md','THIRD_PARTY_NOTICES.md','requirements.txt','server.py','collector.py','source_book.py','source_catalog.json','material_catalog.json','notice_time.py','package_import.py','major_policy.py','启动公考分析器.command','启动公考分析器.bat','LICENSE'}
DIRS={'web','tests','docs','examples','scripts','.github'}
BLOCKED={'local-history','__pycache__','node_modules','.venv','.vendor'}


def tracked_files():
    result=subprocess.run(['git','ls-files','--cached','-z'],cwd=ROOT,check=True,capture_output=True)
    return [Path(name) for name in result.stdout.decode().split('\0') if name]


def audit(paths):
    errors=[]
    for relative in paths:
        path=ROOT/relative
        allowed=str(relative)=='data/.gitkeep' or len(relative.parts)==1 and relative.name in ROOT_FILES or relative.parts[0] in DIRS
        if not allowed or any(part in BLOCKED for part in relative.parts) or relative.suffix.lower() in {'.pyc','.zip','.pdf','.xls','.xlsx','.doc','.docx','.png','.jpg','.jpeg'}:
            errors.append(f'不应提交的文件：{relative}');continue
        if path.is_symlink() or not path.is_file():errors.append(f'文件不存在或是符号链接：{relative}');continue
        if path.stat().st_size>2*1024*1024:errors.append(f'文件超过源码包限制：{relative}');continue
        try:text=path.read_text('utf-8-sig')
        except UnicodeError:errors.append(f'非文本文件需另行审核：{relative}');continue
        if re.search(r'[/]Users[/][^/\s]+/|[A-Z]:\\Users\\',text):errors.append(f'包含个人电脑路径：{relative}')
        if re.search(r'\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',text):
            errors.append(f'疑似密钥：{relative}')
    for required in ('README.md','requirements.txt','server.py','web/index.html','examples/fictional-major-policy.json'):
        if Path(required) not in paths:errors.append(f'缺少必要文件：{required}')
    return errors


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--export',metavar='ZIP');args=parser.parse_args()
    try:paths=tracked_files()
    except subprocess.CalledProcessError:
        print('请先初始化 Git 并暂存准备上传的文件。',file=sys.stderr);return 1
    errors=audit(paths)
    if errors:
        print('\n'.join(errors),file=sys.stderr);return 1
    print(f'仓库检查通过：{len(paths)} 个待上传文件；无本机资料、历史导出或常见密钥模式。')
    print('此检查只覆盖常见风险，上传前仍应人工检查暂存区内容。')
    if args.export:
        target=Path(args.export).resolve()
        if target in [(ROOT/p).resolve() for p in paths]:raise ValueError('输出不能覆盖源码')
        target.parent.mkdir(parents=True,exist_ok=True)
        with ZipFile(target,'w',ZIP_DEFLATED) as archive:
            for relative in paths:archive.write(ROOT/relative,Path('gongkao-analyzer')/relative)
        print(f'已导出当前文件内容：{target}')
    return 0


if __name__=='__main__':raise SystemExit(main())
