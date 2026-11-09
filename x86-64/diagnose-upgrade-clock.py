"""Observe the unchanged upgrade test; do not alter its deadlines or assertions."""
import hashlib
from pathlib import Path

source = Path(__file__).with_name('test-sysupgrade.py')
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'a36eb7a25de8d08a1d003c06b40761cfa2a21bffe1486856643582bbafcc271f'
text = raw.decode()
instrumentation = r'''
def observe_vm():
    try:
        with (image.parent / 'upgrade-cpu.jsonl').open('w') as evidence:
            while qemu.poll() is None and not observer_stop.is_set():
                record = {'wall': time.time(), 'monotonic': time.monotonic()}
                try:
                    with socket.socket(socket.AF_UNIX) as monitor:
                        monitor.settimeout(3)
                        monitor.connect(str(monitor_path))
                        with monitor.makefile('rwb', buffering=0) as stream:
                            stream.readline()
                            for command, arguments in [('qmp_capabilities', {}), ('query-cpus-fast', {}),
                                    ('human-monitor-command', {'command-line': 'info registers -a'})]:
                                stream.write((json.dumps({'execute': command, 'arguments': arguments, 'id': command}) + '\n').encode())
                                while response := stream.readline():
                                    response = json.loads(response)
                                    if response.get('id') == command:
                                        record[command] = response
                                        break
                    record['threads'] = {str(p): p.read_text() for name in ('stat', 'wchan')
                                         for p in Path(f'/proc/{qemu.pid}/task').glob('*/' + name)}
                    record['cpu_pressure'] = Path('/proc/pressure/cpu').read_text()
                except (OSError, ValueError) as error:
                    record['diagnostic_error'] = str(error)
                evidence.write(json.dumps(record) + '\n')
                evidence.flush()
                observer_stop.wait(30)
    except OSError as error:
        print(f'CPU diagnostic unavailable: {error}', flush=True)

observer_stop = threading.Event()
observer = threading.Thread(target=observe_vm, daemon=True)
observer.start()
try:
    serial_timing = (image.parent / 'upgrade-serial-timing.jsonl').open('w')
except OSError as error:
    print(f'Serial timing unavailable: {error}', flush=True)
    serial_timing = None
def record_serial(data):
    global serial_timing
    record = {'wall': time.time(), 'monotonic': time.monotonic(),
              'offset': log.tell(), 'size': len(data)}
    log.write(data)
    if serial_timing is not None:
        try:
            serial_timing.write(json.dumps(record) + '\n')
            serial_timing.flush()
        except OSError as error:
            print(f'Serial timing stopped: {error}', flush=True)
            serial_timing = None

'''
anchor = '\n\ntry:\n    # Configure a test-only password'
assert text.count(anchor) == 1
assert text.count('log.write(data)') == 2
assert text.count('qemu.stdout.read(4096)') == 1
text = text.replace('log.write(data)', 'record_serial(data)')
# read1 records arrival time without waiting for a full 4096-byte chunk.
text = text.replace('qemu.stdout.read(4096)', 'qemu.stdout.read1(4096)')
text = text.replace(anchor, '\n\n' + instrumentation + anchor)
assert text.count('\nfinally:\n') == 1
text = text.replace('\nfinally:\n', '\nfinally:\n    observer_stop.set()\n    observer.join(timeout=4)\n')
exec(compile(text, str(source), 'exec'), {'__name__': '__main__', '__file__': str(source)})
