import unittest,sys,io,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import parse
class ParserTests(unittest.TestCase):
 @unittest.skipUnless((Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls').exists(), '可选本机真实样本未提供')
 def test_real_workbook(self):
  p=Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls'; d=parse(p.read_bytes(),p.name)
  self.assertEqual(d['total'],8211);self.assertEqual(d['recruits'],10293)
  self.assertEqual([s['count'] for s in d['sheets']],[4254,921,440,277,183,2136])
  self.assertEqual(len({j['code'] for j in d['jobs']}),8211)
  self.assertEqual(d['jobs'][0]['row'],4)
  self.assertIn('experience',d['sheets'][-1]['missing'])
  self.assertIn('最低服务年限',d['jobs'][-1]['notes'][1])
 def test_csv_header_and_unknown(self):
  d=parse('说明\n职位名称,职位代码,学历,专业,招考对象\n测试,001,本科,不限,不限应届毕业生'.encode(),'x.csv')
  self.assertEqual(d['jobs'][0]['code'],'001');self.assertEqual(d['jobs'][0]['row'],3)
  self.assertEqual(d['jobs'][0]['experience'],'')
 def test_invalid(self):
  with self.assertRaises(ValueError):parse(b'hello','test.csv')
 def test_all_condition_columns(self):
  d=parse('职位名称,职位代码,学历,其他要求,备注,性别,户籍要求\n职员,001,本科,中共党员,通过法律职业资格考试,男性,本市'.encode(),'x.csv')
  j=d['jobs'][0]
  self.assertEqual([s['column'] for s in j['conditionSources']],['其他要求','备注','性别','户籍要求'])
  self.assertIn('通过法律职业资格考试',j['other']);self.assertIn('本市',j['other'])
 def test_unusual_constraint_header_is_not_ignored(self):
  d=parse('职位名称,职位代码,学历,视力条件,其他备注2\n职员,001,本科,矫正视力须达标,须持证'.encode(),'x.csv')
  self.assertEqual([s['column'] for s in d['jobs'][0]['conditionSources']],['视力条件','其他备注2'])
 @unittest.skipUnless((Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls').exists(), '可选本机真实样本未提供')
 def test_real_conditions_not_lost(self):
  p=Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls';d=parse(p.read_bytes(),p.name)
  for j in d['jobs']:
   for k,v in j['raw'].items():
    if k.startswith('其他要求 [') and v:self.assertTrue(any(s['text']==v for s in j['conditionSources']))
  self.assertEqual(sum(any(s['column']=='其他要求' for s in j['conditionSources']) for j in d['jobs']),3415)
 def test_xlsx_sparse_rows(self):
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:
   z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="表1" r:id="rId1"/></sheets></workbook>')
   z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
   z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>职位名称</t></is></c><c r="B2" t="inlineStr"><is><t>职位代码</t></is></c><c r="C2" t="inlineStr"><is><t>学历</t></is></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>职员</t></is></c><c r="B5"><v>123</v></c><c r="C5" t="inlineStr"><is><t>本科</t></is></c></row></sheetData></worksheet>')
  d=parse(b.getvalue(),'test.xlsx');self.assertEqual(d['jobs'][0]['row'],5)
if __name__=='__main__':unittest.main()
