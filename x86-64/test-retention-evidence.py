"""Retention diagnostics must identify fields without exposing their values."""
import ast
import copy
import hashlib
import json
import re
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
        namespace = dict(hashlib=hashlib, json=json, firewall_migration_hash=lambda *a: None, image=Path(directory.name) / 'test.img', run=run)
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

    def test_current_disabled_defaults_preserve_each_existing_section(self):
        check, snapshot, old, fields, ggy, ggy_fields = self.migration_fixture()
        blocks = [
            (ggy, ggy_fields),
            ("config akile 'akile'\n\toption enabled '0'\n\n", "meowx.akile=akile\nmeowx.akile.enabled='0'\n"),
            ("config mesh 'mesh'\n\toption enabled '0'\n\toption force_map '0'\n\toption router_access '0'\n\n",
             "meowx.mesh=mesh\nmeowx.mesh.enabled='0'\nmeowx.mesh.force_map='0'\nmeowx.mesh.router_access='0'\n")]
        for mask in range(8):
            existing = [b for i, b in enumerate(blocks) if mask & (1 << i)]
            missing = [b for i, b in enumerate(blocks) if not mask & (1 << i)]
            config = old + ''.join(b[0].replace("'0'", "'1'") for b in existing)
            values = fields + ''.join(b[1].replace("'0'", "'1'") for b in existing)
            baseline = snapshot(config, values)
            current = snapshot(config + ''.join(b[0] for b in missing), values + ''.join(b[1] for b in missing))
            original = copy.deepcopy(baseline)
            with self.subTest(existing=mask):
                self.assertEqual(bool(check(baseline, current)), bool(missing))
                self.assertEqual(bool(check(baseline, current)), bool(missing))
                self.assertEqual(baseline, original)
                if existing:
                    with self.assertRaises(AssertionError):
                        check(baseline, snapshot(config.replace("'1'", "'0'") + ''.join(b[0] for b in missing),
                                                 values.replace("'1'", "'0'") + ''.join(b[1] for b in missing)))

    def test_current_defaults_reject_enabled_extended_reordered_or_changed_originals(self):
        check, snapshot, old, fields, ggy, ggy_fields = self.migration_fixture()
        akile = "config akile 'akile'\n\toption enabled '0'\n\n"
        mesh = "config mesh 'mesh'\n\toption enabled '0'\n\toption force_map '0'\n\toption router_access '0'\n\n"
        extra_fields = ggy_fields + "meowx.akile=akile\nmeowx.akile.enabled='0'\nmeowx.mesh=mesh\nmeowx.mesh.enabled='0'\nmeowx.mesh.force_map='0'\nmeowx.mesh.router_access='0'\n"
        suffix = ggy + akile + mesh
        baseline = snapshot(old, fields)
        variants = [suffix.replace("'0'", "'1'"), suffix + "\toption url 'unexpected'\n", mesh + ggy + akile,
                    suffix.replace('force_map', 'unknown'), suffix.replace('\t', '  '), suffix + mesh]
        for addition in variants:
            with self.subTest(addition=addition), self.assertRaises(AssertionError):
                check(baseline, snapshot(old + addition, fields + extra_fields))
        with self.assertRaises(AssertionError):
            check(baseline, snapshot(old.replace('KEEP', 'LOST') + suffix, fields + extra_fields))
        current = snapshot(old + suffix, fields + extra_fields)
        current['uci_fields']['meowx.mesh.enabled'] = hashlib.sha256(b"'1'").hexdigest()
        with self.assertRaises(AssertionError):
            check(baseline, current)

    def test_package_migration_requires_exact_installed_versions(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        tree = ast.parse(source.read_text())
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'verify_package_versions']
        self.assertEqual(len(functions), 1)
        expected = json.loads(source.with_name('meowx-versions.json').read_text())
        good = '\n'.join(name + '-' + version for name, version in expected.items())
        for output in (good, good.replace('0.5.0-r1', '0.4.6-r1'), '\n'.join(good.splitlines()[1:]), ''):
            namespace = dict(json=json, Path=Path, __file__=str(source), run=lambda *a: output)
            exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
            if output == good:
                namespace['verify_package_versions'](None)
            else:
                with self.subTest(output=output), self.assertRaises(AssertionError):
                    namespace['verify_package_versions'](None)

    def firewall_fixture(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        functions = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef)
                     and n.name in ('assert_retained', 'firewall_migration_hash')]
        self.assertEqual(len(functions), 2)
        namespace = dict(hashlib=hashlib, re=re)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
        blocks = [("config include 'zerotier_%s'\n\toption type 'nftables'\n"
                   "\toption path '/var/run/zerotier-one/_fw4/%s.nft'\n"
                   "\toption position 'chain-pre'\n\toption chain '%s'\n\n") % (c, c, c)
                  for c in ('input', 'srcnat', 'forward')]
        script = "config include '%s'\n\toption type 'script'\n\toption path '%s'\n\toption fw4_compatible '1'\n\n"
        blocks.append(script % ('meowx', '/etc/meowx/scripts/firewall_include.sh'))
        own = script % ('johnny_zt_nat', '/usr/libexec/johnny-zt-nat')
        rules = "# keep this comment\nconfig rule 'keep_first'\n\toption target 'DROP'\n\nconfig rule 'keep_second'\n\toption target 'ACCEPT'\n\n"
        original = ''.join(blocks[:3]) + rules + own + blocks[3]
        expected = rules + own + ''.join(blocks)
        fields = {'firewall.' + name: hashlib.sha256(b'include').hexdigest()
                  for name in ('zerotier_input', 'zerotier_srcnat', 'zerotier_forward', 'meowx', 'johnny_zt_nat')}
        def snapshot(config, values=None):
            values = fields if values is None else values
            return {'files': {'/etc/config/firewall': hashlib.sha256(config.encode()).hexdigest()},
                    'uci_fields': values, 'shadow_accounts': {}, 'pending_uci_keys': [],
                    'firewall_after_vendor_defaults': namespace['firewall_migration_hash'](config.encode(), values)}
        return namespace['assert_retained'], snapshot, original, expected, fields

    def test_exact_vendor_include_move_keeps_custom_rules_and_original_baseline(self):
        check, snapshot, original, expected, fields = self.firewall_fixture()
        baseline = snapshot(original)
        saved = copy.deepcopy(baseline)
        current = snapshot(expected)
        self.assertFalse(check(baseline, baseline))
        check(baseline, current)
        check(baseline, current)
        self.assertEqual(baseline, saved)
        for altered in (expected.replace('DROP', 'ACCEPT'), expected.replace('keep_first', 'changed'),
                        expected.replace('# keep this comment', '# lost'), expected.replace('\t', '  '),
                        expected.replace("'script'", "'nftables'"), expected.replace("'chain-pre'", "'chain-post'"),
                        expected + "config include 'extra'\n\n"):
            with self.subTest(altered=altered), self.assertRaises(AssertionError):
                check(baseline, snapshot(altered))
        # Reordering two named rules must fail even if the field dictionary is identical.
        reordered = expected.replace('keep_first', 'TEMP').replace('keep_second', 'keep_first').replace('TEMP', 'keep_second')
        with self.assertRaises(AssertionError):
            check(baseline, snapshot(reordered))

    def test_vendor_move_rejects_unknown_includes_and_nondefault_or_duplicate_blocks(self):
        check, snapshot, original, expected, fields = self.firewall_fixture()
        for extra in ("config include 'custom'\n\toption type 'nftables'\n\toption chain 'input'\n\toption position 'chain-pre'\n\n",
                      "config include 'custom'\n\toption type 'script'\n\toption path '/custom.sh'\n\n"):
            values = dict(fields, **{'firewall.custom': hashlib.sha256(b'include').hexdigest()})
            baseline = snapshot(original + extra, values)
            self.assertIsNone(baseline['firewall_after_vendor_defaults'])
            with self.assertRaises(AssertionError):
                check(baseline, snapshot(extra + expected, values))
        for changed in (original.replace("'chain-pre'", "'chain-post'"), original.replace('/input.nft', '/custom.nft'),
                        original.replace("\toption chain 'input'\n", "\toption chain 'input'\n\toption enabled '0'\n"),
                        original + original, original.replace("config include 'meowx'", "config include 'missing'")):
            with self.subTest(changed=changed):
                self.assertIsNone(snapshot(changed)['firewall_after_vendor_defaults'])

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
            namespace = dict(hashlib=hashlib, json=json, firewall_migration_hash=lambda *a: None, image=Path(directory) / 'test.img', run=run)
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
