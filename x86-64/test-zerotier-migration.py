import ast
import hashlib
from pathlib import Path
import re
import unittest


class RemovalEvidence(unittest.TestCase):
    def test_only_the_explicit_removal_is_allowed_against_the_original_baseline(self):
        source = Path(__file__).with_name('test-sysupgrade.py')
        tree = ast.parse(source.read_text(encoding='utf-8'))
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name in ('zerotier_removal_targets', 'assert_retained')]
        self.assertEqual(len(functions), 2)
        namespace = dict(re=re, hashlib=hashlib)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
        network = b"config interface 'lan'\n\toption ipaddr '192.0.2.1'\n\nconfig interface 'zerotier'\n\toption proto 'none'\n\n"
        firewall = b"config rule 'keep'\n\toption target 'DROP'\n\nconfig include 'johnny_zt_nat'\n\toption path '/usr/libexec/johnny-zt-nat'\n\n"
        wanted_network = network[:network.index(b"config interface 'zerotier'")]
        wanted_firewall = firewall[:firewall.index(b"config include 'johnny_zt_nat'")]
        digest = lambda data: hashlib.sha256(data).hexdigest()
        baseline = dict(files={'/etc/config/network': digest(network), '/etc/config/firewall': digest(firewall)},
                        uci_fields={'network.lan': 'interface', 'network.zerotier': 'interface', 'firewall.keep': 'rule', 'firewall.johnny_zt_nat': 'include'},
                        shadow_accounts={'root': 'fixture'},
                        without_zerotier=namespace['zerotier_removal_targets'](network, firewall))
        current = dict(files={'/etc/config/network': digest(wanted_network), '/etc/config/firewall': digest(wanted_firewall)},
                       uci_fields={'network.lan': 'interface', 'firewall.keep': 'rule'},
                       shadow_accounts={'root': 'fixture'}, pending_uci_keys=[])
        self.assertTrue(namespace['assert_retained'](baseline, current))
        self.assertTrue(namespace['assert_retained'](baseline, current))  # same baseline, next upgrade
        for path in current['files']:
            changed = dict(current, files=dict(current['files'], **{path: digest(b'changed unrelated settings')}))
            with self.assertRaises(AssertionError):
                namespace['assert_retained'](baseline, changed)
        with self.assertRaises(AssertionError):
            namespace['assert_retained'](baseline, dict(current, uci_fields={'network.lan': 'different', 'firewall.keep': 'rule'}))


if __name__ == '__main__':
    unittest.main()
