import json
from pathlib import Path
import subprocess
import tempfile
import unittest


class MeowXVersions(unittest.TestCase):
    def check_source(self, contents, suffix):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / ('packages' + suffix)
            source.write_text(contents)
            return subprocess.run(['python3', str(Path(__file__).with_name('check-meowx-versions.py')), str(source)], capture_output=True).returncode

    def test_vendor_feed_accepts_current_signed_package_versions_and_rejects_stale_core(self):
        packages = {'meowx': '0.2.0-r1', 'meowx-core': '0.4.6-r1', 'luci-app-meowx': '0.2.0-r1', 'luci-i18n-meowx-zh-cn': '26.303.63817~9618f30'}
        self.assertEqual(self.check_source(json.dumps({'architecture': 'x86_64', 'packages': packages}), '.json'), 0)
        packages['meowx-core'] = '0.3.9-r1'
        self.assertNotEqual(self.check_source(json.dumps({'architecture': 'x86_64', 'packages': packages}), '.json'), 0)

    def test_manifest_rejects_missing_plugin_after_successful_package_install(self):
        manifest = 'meowx - 0.2.0-r1\nmeowx-core - 0.4.6-r1\nluci-app-meowx - 0.2.0-r1\nluci-i18n-meowx-zh-cn - 26.303.63817~9618f30\n'
        self.assertEqual(self.check_source(manifest, '.manifest'), 0)
        self.assertNotEqual(self.check_source(manifest.replace('luci-app-meowx - 0.2.0-r1\n', ''), '.manifest'), 0)


if __name__ == '__main__':
    unittest.main()
