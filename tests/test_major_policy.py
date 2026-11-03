import copy
import json
import unittest
from pathlib import Path
from major_policy import validate_policy
from package_import import import_files


class MajorPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy=json.loads((Path(__file__).resolve().parents[1]/'examples'/'fictional-major-policy.json').read_text())

    def test_upload_uses_catalog_pipeline_and_explicit_context(self):
        result=import_files(json.dumps(self.policy).encode(),'规则.json',None)['files'][0]
        self.assertEqual(result['kind'],'document')
        self.assertEqual(result['role'],'catalog')
        self.assertEqual(result['context'],self.policy['context'])
        self.assertEqual(result['majorPolicy'],self.policy)

    def test_invalid_graph_and_unscoped_files_rejected(self):
        for change in (lambda p:p['context'].pop('year'),lambda p:p['edges'][0].update(child='missing'),lambda p:p['edges'][0]['evidence'].update(text=''),lambda p:p['nodes'][1].update(education='硕士'),lambda p:p['nodes'][1].update(kind='category')):
            policy=copy.deepcopy(self.policy);change(policy)
            with self.assertRaises(ValueError):validate_policy(policy)
            result=import_files(json.dumps(policy).encode(),'规则.json',None)['files'][0]
            self.assertEqual(result['kind'],'error')

    def test_backup_and_unrelated_json_not_treated_as_policy(self):
        for value in ({'format':'xuan-zhi-package','version':1},{'nodes':[]}):
            self.assertEqual(import_files(json.dumps(value).encode(),'文件.json',None)['files'][0]['kind'],'error')
