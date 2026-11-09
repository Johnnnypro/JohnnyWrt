"""A successful SSH login alone must not permit rebooting an unready overlay."""
import ast
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock

source = Path(__file__).with_name('test-sysupgrade.py')
tree = ast.parse(source.read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'wait_ssh')


class ReadinessTest(unittest.TestCase):
    def test_failure_diagnostics_keep_partial_output_and_original_error(self):
        capture = next((node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'capture_failure_network'), None)
        self.assertIsNotNone(capture, 'Failed upgrades need bounded network evidence')
        with tempfile.TemporaryDirectory() as directory:
            namespace = dict(image=Path(directory) / 'firmware.img.gz', print=Mock())
            exec(compile(ast.Module(body=[capture], type_ignores=[]), str(source), 'exec'), namespace)
            client = Mock()
            client.exec_command.return_value = (None, io.BytesIO(b'partial network evidence'), io.BytesIO())
            namespace['capture_failure_network'](client)
            self.assertEqual((Path(directory) / 'upgrade-network-failure.log').read_text(), 'partial network evidence')
            command = client.exec_command.call_args.args[0]
            self.assertNotIn('timeout 40 sh', command, 'The firmware has no timeout applet')
            self.assertIn('ubus -t 3 call', command)
            self.assertIn('nslookup -timeout=4 -retry=1', command)
            self.assertNotIn('apk update', command)
            self.assertEqual(client.exec_command.call_args.kwargs['timeout'], 45)
            original = RuntimeError('original upgrade failure')
            for failure in ('ssh', 'read', 'write'):
                with self.subTest(failure=failure):
                    client.exec_command.side_effect = OSError('SSH unavailable') if failure == 'ssh' else None
                    output = Mock(read=Mock(side_effect=OSError('read failed'))) if failure == 'read' else io.BytesIO(b'partial')
                    client.exec_command.return_value = (None, output, io.BytesIO())
                    namespace['image'] = Path(directory) / 'missing' / 'firmware.img.gz'
                    with self.assertRaises(RuntimeError) as raised:
                        try:
                            raise original
                        finally:
                            namespace['capture_failure_network'](client)
                    self.assertIs(raised.exception, original)
            client.get_transport.return_value = None
            client.exec_command.reset_mock()
            namespace['capture_failure_network'](client)
            client.exec_command.assert_not_called()

    def test_old_and_current_fresh_install_console_names(self):
        condition = next(node.test for node in ast.walk(tree) if isinstance(node, ast.If)
                         and 'root@' in ast.unparse(node.test))
        check = compile(ast.Expression(body=condition), str(source), 'eval')
        for output in (b'root@Johnnywrt:~# ', b'root@JohnnyWrt:~# '):
            with self.subTest(output=output):
                self.assertTrue(eval(check, {'activated': True, 'output': output}))
        self.assertFalse(eval(check, {'activated': True, 'output': b'Please press Enter'}))
        self.assertFalse(eval(check, {'activated': False, 'output': b'root@JohnnyWrt:~# '}))

    def run_wait(self, states, previous_boot=None, ready_after=0, ports=None, pending=None, quickstart=True, lan_up=None, network=None):
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
            status = {'up': True, 'pending': False, 'ipv4-address': [{'address': '10.0.2.15', 'mask': 24}],
                      'route': [{'target': '0.0.0.0', 'mask': 0, 'nexthop': '10.0.2.2'}], 'dns-server': ['10.0.2.3']}
            sample = network[index] if network else {}
            status.update(sample.get('lan', {}))
            if lan_up:
                status['up'] = lan_up[index] == 'true'
            if command.startswith('nslookup '):
                if not sample.get('answer', True):
                    raise RuntimeError('Local DNS did not answer')
                return ''
            return {'cat /proc/sys/kernel/random/boot_id': 'new-boot',
                    'readlink /overlay/.fs_state': client.state,
                    'uci -q get network.@device[0].ports': ports[index] if ports else 'eth0 dheth0',
                    'uci changes network': pending[index] if pending else '',
                    'test ! -x /usr/sbin/quickstart || echo present': 'present' if quickstart else '',
                    'ubus -t 3 call network.interface.lan status': json.dumps(status),
                    'ubus -t 3 call service list \'{"name":"dnsmasq"}\'': json.dumps({'dnsmasq': {'instances': sample.get('instances', {'dns': {'running': True}})}}),
                    "awk '/^nameserver / {print $2}' /tmp/resolv.conf.d/resolv.conf.auto": sample.get('resolvers', '10.0.2.3'),
                    'sync': ''}[command]

        namespace = dict(time=clock, json=json, paramiko=types.SimpleNamespace(SSHException=ConnectionError),
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

    def test_lan_up_does_not_accept_incomplete_address_route_or_dns(self):
        incomplete = [{'lan': {'pending': True}}, {'lan': {'ipv4-address': []}}, {'lan': {'route': []}},
                      {'lan': {'dns-server': []}}, {'resolvers': '10.0.2.99'}, {'instances': {}},
                      {'instances': {'dns': {'running': False}}}, {'answer': False}]
        for sample in incomplete:
            with self.subTest(sample=sample):
                _, connected, commands = self.run_wait(['2', '2'], quickstart=False, network=[sample, {}])
                self.assertEqual(len(connected), 2)
                self.assertTrue(any(command.startswith('nslookup ') for command in commands))

    def test_dns_that_never_answers_is_not_ready(self):
        with self.assertRaises(RuntimeError):
            self.run_wait(['2'], quickstart=False, network=[{'answer': False}])


if __name__ == '__main__':
    unittest.main()
