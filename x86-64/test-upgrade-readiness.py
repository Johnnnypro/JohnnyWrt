"""A successful SSH login alone must not permit rebooting an unready overlay."""
import ast
from pathlib import Path
import types
import unittest
from unittest.mock import Mock

source = Path(__file__).with_name('test-sysupgrade.py')
tree = ast.parse(source.read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'wait_ssh')


class ReadinessTest(unittest.TestCase):
    def test_old_and_current_fresh_install_console_names(self):
        condition = next(node.test for node in ast.walk(tree) if isinstance(node, ast.If)
                         and 'root@' in ast.unparse(node.test))
        check = compile(ast.Expression(body=condition), str(source), 'eval')
        for output in (b'root@Johnnywrt:~# ', b'root@JohnnyWrt:~# '):
            with self.subTest(output=output):
                self.assertTrue(eval(check, {'activated': True, 'output': output}))
        self.assertFalse(eval(check, {'activated': True, 'output': b'Please press Enter'}))
        self.assertFalse(eval(check, {'activated': False, 'output': b'root@JohnnyWrt:~# '}))

    def run_wait(self, states, previous_boot=None, ready_after=0, ports=None, pending=None, quickstart=True, lan_up=None):
        clock = Mock()
        elapsed = [0]
        clock.monotonic.side_effect = lambda: elapsed[0]
        clock.sleep.side_effect = lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds)
        clients = [Mock(state=state) for state in states]
        connected, commands = [], []

        def connect():
            if elapsed[0] < ready_after:
                raise ConnectionError('Guest is still booting')
            client = clients[len(connected)] if len(connected) < len(clients) else clients[-1]
            connected.append(client)
            return client

        def run(client, command, sensitive=False):
            commands.append(command)
            index = min(len(connected) - 1, len(states) - 1)
            return {'cat /proc/sys/kernel/random/boot_id': 'new-boot',
                    'readlink /overlay/.fs_state': client.state,
                    'uci -q get network.@device[0].ports': ports[index] if ports else 'eth0 dheth0',
                    'uci changes network': pending[index] if pending else '',
                    'test ! -x /usr/sbin/quickstart || echo present': 'present' if quickstart else '',
                    "ubus call network.interface.lan status | jsonfilter -e '@.up'": lan_up[index] if lan_up else 'true',
                    'sync': ''}[command]

        namespace = dict(time=clock, paramiko=types.SimpleNamespace(SSHException=ConnectionError),
                         qemu=Mock(poll=lambda: None), connect=connect, run=run, print=Mock())
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        result = namespace['wait_ssh'](previous_boot)
        return result, connected, commands

    def test_pending_first_boot_is_not_accepted_before_ready(self):
        result, connected, commands = self.run_wait(['1', '2'])
        self.assertEqual(len(connected), 2)
        connected[0].close.assert_called_once()
        self.assertIs(result, connected[1])
        self.assertEqual(commands[-1], 'sync')

    def test_new_boot_id_still_requires_ready_overlay(self):
        _, connected, _ = self.run_wait(['1', '2'], 'old-boot')
        self.assertEqual(len(connected), 2)

    def test_quickstart_bridge_initialization_finishes_before_baseline(self):
        _, connected, _ = self.run_wait(['2', '2'], ports=['eth0', 'eth0 dheth0'])
        self.assertEqual(len(connected), 2)

    def test_pending_network_commit_is_not_a_ready_baseline(self):
        _, connected, _ = self.run_wait(['2', '2'], pending=['network.@device[0].ports=eth0 dheth0', ''])
        self.assertEqual(len(connected), 2)

    def test_quickstart_that_never_finishes_is_a_failure(self):
        with self.assertRaises(RuntimeError):
            self.run_wait(['2'], ports=['eth0'])

    def test_overlay_that_never_finishes_is_a_failure(self):
        with self.assertRaises(RuntimeError):
            self.run_wait(['1'])

    def test_native_lan_without_quickstart_does_not_require_helper_port(self):
        _, connected, _ = self.run_wait(['2'], ports=['eth0'], quickstart=False)
        self.assertEqual(len(connected), 1)

    def test_native_lan_must_be_up_even_with_retained_helper_config(self):
        _, connected, _ = self.run_wait(['2', '2'], quickstart=False, lan_up=['false', 'true'])
        self.assertEqual(len(connected), 2)

    def test_slow_emulated_flash_and_boot_can_finish_after_four_minutes(self):
        _, connected, commands = self.run_wait(['2'], 'old-boot', ready_after=300)
        self.assertEqual(len(connected), 1)
        self.assertEqual(commands[-1], 'sync')


if __name__ == '__main__':
    unittest.main()
