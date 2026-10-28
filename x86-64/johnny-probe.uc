// A single TCP handshake, constrained to the selected ZeroTier device.
import * as socket from 'socket';
import { popen } from 'fs';

function milliseconds() { let t = clock(true); return t[0] * 1000 + int(t[1] / 1000000); }
function outcome(code) {
    // Linux errno values on the supported x86/64 target.
    if (type(code) != 'int') return 'error';
    return code == 0 ? 'passed' : code == 111 ? 'refused' : code == 110 ? 'timeout'
        : index([101, 113, 100, 99], code) >= 0 ? 'unreachable' : 'error';
}
export function probe(network, ip, port) {
    if (type(ip) != 'string' || !match(ip, /^[0-9a-fA-F:.]+$/) || !iptoarr(ip))
        return { error: '请输入有效的 IP 地址，不支持域名或网段' };
    ip = arrtoip(iptoarr(ip));
    if (ip == '::' || ip == '::1' || index(ip, '::ffff:') == 0 || index(ip, 'ff') == 0
        || match(ip, /^(0|127|22[4-9]|23[0-9]|24[0-9]|25[0-5])\./))
        return { error: '请填写远端设备的单播 IP 地址' };
    if (type(port) != 'int' || port < 1 || port > 65535)
        return { error: 'TCP 端口必须是 1–65535 的整数' };
    let device = network?.portDeviceName;
    if (network?.status != 'OK' || type(device) != 'string' || !match(device, /^[a-zA-Z0-9_.:-]{1,15}$/))
        return { error: '所选 ZeroTier 网络尚未就绪' };
    let start = milliseconds(), result = { ip, port, device, timestamp: time() };
    let ipv6 = index(ip, ':') >= 0;
    // ip is canonical numeric text; never interpolate a hostname or raw input.
    let p = popen('ip ' + (ipv6 ? '-6' : '-4') + ' -j route get ' + ip + ' 2>/dev/null');
    let text = p?.read('all'), code = p?.close(), route;
    try { route = text ? json(text)[0] : null; } catch (e) {}
    if (code != 0 || !route) result.outcome = 'unreachable';
    else if (route.dev != device || route.type == 'local') result.outcome = 'wrong_route';
    else {
        let sock = socket.create(ipv6 ? socket.AF_INET6 : socket.AF_INET, socket.SOCK_STREAM | socket.SOCK_NONBLOCK);
        result.outcome = 'error';
        if (sock) {
            if (sock.setopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, device)) {
                if (sock.connect(ip, port)) result.outcome = 'passed';
                else {
                    let error = socket.error(true);
                    if (error == 115) {
                        let events = socket.poll(5000, [sock, socket.POLLOUT]);
                        result.outcome = events == null ? 'error' : !events[0][1] ? 'timeout'
                            : outcome(sock.getopt(socket.SOL_SOCKET, socket.SO_ERROR));
                    } else result.outcome = outcome(error);
                }
            }
            sock.close();
        }
    }
    result.elapsed_ms = milliseconds() - start;
    return result;
};
