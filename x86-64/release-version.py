#!/usr/bin/env python3
"""Public date label; the legacy updater tag and upstream version stay separate."""
from datetime import datetime
import re
import sys
from zoneinfo import ZoneInfo

value = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%y.%m.%d')
if not re.fullmatch(r'\d{2}\.\d{2}\.\d{2}', value):
    sys.exit('Version must be YY.MM.DD')
try:
    datetime.strptime('20' + value, '%Y.%m.%d')
except ValueError:
    sys.exit('Version must be a valid calendar date')
print(value)
