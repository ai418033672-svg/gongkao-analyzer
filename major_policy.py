"""Validate portable, evidence-bearing professional catalog policies; no execution."""
import re


def validate_policy(value):
    def require(condition, message):
        if not condition:
            raise ValueError(message)
    def text(value):
        return isinstance(value, str) and bool(value.strip())
    require(isinstance(value, dict) and value.get('format') == 'gongkao-major-policy' and type(value.get('version')) is int and value['version'] == 1, '专业规则文件格式或版本不支持')
    context=value.get('context', {})
    require(isinstance(context, dict) and all(text(context.get(k)) for k in ('province', 'year', 'examType')) and re.fullmatch(r'20\d{2}', context['year']), '专业规则需指定省份、年度和考试类型')
    source=value.get('source', {})
    require(isinstance(source, dict) and text(source.get('title')) and text(source.get('url')) and re.match(r'https?://', source['url']), '专业规则需提供文件名称及公开依据链接')
    nodes,edges,strategy=value.get('nodes'),value.get('edges'),value.get('strategy')
    require(strategy in ('hierarchy', 'enumeration', 'exact') and isinstance(nodes, list) and 0<len(nodes)<=20000 and isinstance(edges, list) and len(edges)<=50000, '专业规则策略或规模不正确')
    by_id={}; names=set();codes=set()
    for node in nodes:
        require(isinstance(node, dict) and text(node.get('id')) and node['id'] not in by_id and text(node.get('name')) and node.get('education') in ('大专','本科','硕士','博士','研究生') and node.get('kind') in ('category','major'), '专业节点格式不正确或ID重复')
        require('code' not in node or text(node['code']), '专业代码格式不正确')
        require('aliases' not in node or isinstance(node['aliases'],list) and all(text(a) for a in node['aliases']), '专业别名格式不正确')
        name=(node['education'],re.sub(r'\s','',node['name']).replace('（','(').replace('）',')'))
        require(name not in names, '同学历专业名称重复');names.add(name)
        if node.get('code'):
            code=(node['education'], re.sub(r'\s','',node['code']).upper())
            require(code not in codes, '同学历专业代码重复');codes.add(code)
        by_id[node['id']]=node
    children={};degree={id:0 for id in by_id}
    for edge in edges:
        require(isinstance(edge,dict) and text(edge.get('parent')) and text(edge.get('child')), '专业关系格式不正确')
        parent,child=by_id.get(edge['parent']),by_id.get(edge['child'])
        evidence=edge.get('evidence')
        require(parent and child and parent['education']==child['education'] and parent['kind']=='category' and strategy!='exact' and (strategy!='enumeration' or child['kind']=='major') and isinstance(evidence,dict) and text(evidence.get('text')) and text(evidence.get('location')), '专业关系或原文证据不正确')
        children.setdefault(parent['id'],[]).append(child['id']);degree[child['id']]+=1
    queue=[id for id in by_id if degree[id]==0]
    for id in queue:
        for child in children.get(id,[]):
            degree[child]-=1
            if degree[child]==0:queue.append(child)
    require(len(queue)==len(nodes), '专业关系不能形成循环')
    return value
