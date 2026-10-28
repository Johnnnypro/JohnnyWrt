// Invoked inside the disposable test guest, with a routed network namespace.
import { probe } from '/usr/libexec/johnny-probe.uc';
let network = { status: 'OK', portDeviceName: 'ztprobe0' };
for (let ip in ['localhost', '127.0.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'ff02::1',
    '198.18.55.2;touch /tmp/probe-injection', '198.18.55.2/24', '::ffff:127.0.0.1'])
    assert(probe(network, ip, 4444).error, 'must reject ' + ip);
for (let port in [0, -1, 65536, 1.5, '443;id', null])
    assert(probe(network, '198.18.55.2', port).error, 'must reject invalid port');
assert(probe({ status: 'ACCESS_DENIED', portDeviceName: 'ztprobe0' }, '198.18.55.2', 4444).error);
assert(probe({ status: 'OK', portDeviceName: 'zt;id' }, '198.18.55.2', 4444).error);
assert(probe({ status: 'OK', portDeviceName: 'br-lan' }, '198.18.55.2', 4444).outcome == 'wrong_route');
let passed = probe(network, '198.18.55.2', 4444);
assert(passed.outcome == 'passed', sprintf('reachable TCP: %J', passed));
assert(passed.device == 'ztprobe0' && passed.ip == '198.18.55.2' && passed.port == 4444);
assert(passed.timestamp > 0 && passed.elapsed_ms >= 0 && passed.elapsed_ms < 6000);
let v6 = probe(network, 'fd42:55::2', 4444);
assert(v6.outcome == 'passed', sprintf('reachable IPv6 TCP: %J', v6));
let refused = probe(network, '198.18.55.2', 4446);
assert(refused.outcome == 'refused', sprintf('closed TCP port: %J', refused));
let timeout = probe(network, '198.18.55.2', 4445);
assert(timeout.outcome == 'timeout', sprintf('dropped TCP port: %J', timeout));
assert(timeout.elapsed_ms >= 4900 && timeout.elapsed_ms < 6000, 'five second bound');
print('PASS: input rejection, route restriction, IPv4/IPv6 success, refusal and bounded timeout\n');
