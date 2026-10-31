"""Retention diagnostics must identify fields without exposing their values."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


class EvidenceTest(unittest.TestCase):
    def migration_fixture(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        tree = ast.parse(source.read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in ('retention_snapshot', 'assert_retained')]
        self.assertEqual(len(functions), 2, 'Explicit migration-aware retention check is missing')
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        state = {}
        def run(client, command, sensitive=False):
            if command.startswith('sha256sum '):
                return hashlib.sha256(state['config'].encode()).hexdigest() + '  /etc/config/meowx\n'
            if command.startswith('uci -q show'):
                self.assertTrue(sensitive)
                return state['fields']
            if command == 'cat /etc/config/meowx':
                self.assertTrue(sensitive)
                return state['config']
            return ''
        namespace = dict(hashlib=hashlib, json=json, image=Path(directory.name) / 'test.img', run=run)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
        def snapshot(config, fields):
            state.update(config=config, fields=fields)
            return namespace['retention_snapshot'](None, ['/etc/config/meowx'], 'fixture')
        old = "config config 'config'\n\toption profile 'subscription:KEEP'\n\n"
        fields = "meowx.config=config\nmeowx.config.profile='subscription:KEEP'\n"
        addition = "config ggy 'ggy'\n\toption enabled '0'\n\n"
        added_fields = "meowx.ggy=ggy\nmeowx.ggy.enabled='0'\n"
        return namespace['assert_retained'], snapshot, old, fields, addition, added_fields

    def test_accepts_only_known_disabled_ggy_append_without_replacing_baseline(self):
        check, snapshot, old, fields, addition, added_fields = self.migration_fixture()
        baseline = snapshot(old, fields)
        original = copy.deepcopy(baseline)
        current = snapshot(old + addition, fields + added_fields)
        self.assertFalse(check(baseline, baseline))
        self.assertTrue(check(baseline, current))
        self.assertTrue(check(baseline, current))  # Same original baseline in the next round.
        self.assertEqual(baseline, original)

    def test_rejects_earlier_bytes_changed_even_with_valid_new_defaults(self):
        check, snapshot, old, fields, addition, added_fields = self.migration_fixture()
        baseline = snapshot(old, fields)
        for changed in (old.replace('KEEP', 'LOST'), old.replace('\t', '  '), old[:-1]):
            with self.subTest(changed=changed), self.assertRaises(AssertionError):
                check(baseline, snapshot(changed + addition, fields + added_fields))

    def test_rejects_enabled_or_extended_new_ggy_section(self):
        check, snapshot, old, fields, addition, added_fields = self.migration_fixture()
        baseline = snapshot(old, fields)
        for changed in (addition.replace("'0'", "'1'"), addition + "\toption url 'unexpected'\n"):
            with self.subTest(changed=changed), self.assertRaises(AssertionError):
                check(baseline, snapshot(old + changed, fields + added_fields))

    def test_rejects_changed_fields_accounts_other_files_and_pending_settings(self):
        check, snapshot, old, fields, addition, added_fields = self.migration_fixture()
        baseline = snapshot(old, fields)
        current = snapshot(old + addition, fields + added_fields)
        for key, name in (('uci_fields', 'meowx.config.profile'), ('uci_fields', 'meowx.extra'),
                          ('shadow_accounts', 'root'), ('files', '/etc/config/network')):
            changed = copy.deepcopy(current)
            changed[key][name] = 'changed'
            with self.subTest(key=key, name=name), self.assertRaises(AssertionError):
                check(baseline, changed)
        current['pending_uci_keys'] = ['meowx.config.profile']
        with self.assertRaises(AssertionError):
            check(baseline, current)

    def test_existing_ggy_preference_must_be_preserved_exactly(self):
        check, snapshot, old, fields, addition, added_fields = self.migration_fixture()
        baseline = snapshot(old + addition.replace("'0'", "'1'"), fields + added_fields.replace("'0'", "'1'"))
        self.assertFalse(check(baseline, baseline))
        with self.assertRaises(AssertionError):
            check(baseline, snapshot(old + addition, fields + added_fields))

    def test_evidence_has_file_and_field_hashes_without_secret_values(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'retention_snapshot')
        def run(client, command, sensitive=False):
            if command.startswith('sha256sum '):
                return 'a' * 64 + '  /etc/config/meowx\n'
            if command.startswith('uci -q show'):
                self.assertTrue(sensitive)
                return "meowx.config.api_secret='PRIVATE_VALUE'\nPRIVATE_CONTINUATION\n"
            if command == 'cat /etc/shadow':
                self.assertTrue(sensitive)
                return 'root:PRIVATE_PASSWORD:0:0:99999:7:::\n'
            if command == 'uci changes':
                self.assertTrue(sensitive)
                return "meowx.config.api_secret='PRIVATE_PENDING'\n"
            return '1'
        with tempfile.TemporaryDirectory() as directory:
            namespace = dict(hashlib=hashlib, json=json, image=Path(directory) / 'test.img', run=run)
            exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
            result = namespace['retention_snapshot'](None, ['/etc/config/meowx'], 'baseline')
            text = (Path(directory) / 'retention-baseline.json').read_text()
            self.assertNotIn('PRIVATE_', text)
            self.assertEqual(result['files']['/etc/config/meowx'], 'a' * 64)
            self.assertEqual(list(result['uci_fields']), ['meowx.config.api_secret'])
            self.assertEqual(list(result['shadow_accounts']), ['root'])

    def test_failed_sensitive_read_does_not_expose_partial_output(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'run')
        output = SimpleNamespace(read=lambda: b'PRIVATE_OUTPUT',
                                 channel=SimpleNamespace(recv_exit_status=lambda: 1))
        error = SimpleNamespace(read=lambda: b'PRIVATE_ERROR')
        client = SimpleNamespace(exec_command=lambda *a, **k: (None, output, error))
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        with self.assertRaises(RuntimeError) as caught:
            namespace['run'](client, 'cat /etc/shadow', sensitive=True)
        self.assertNotIn('PRIVATE_', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
