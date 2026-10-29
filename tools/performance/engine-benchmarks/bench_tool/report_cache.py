"""
In-memory cache of job reports, so that a run is parsed at most once per
invocation. Upstream also kept a persistent cache of reports in a results
repository, to outlive the GH artifact retention; this fork has none (#363), so
reports older than the retention period are simply unavailable.
"""
from typing import Dict, Optional

from . import JobReport


class ReportCache:
    def __init__(self):
        self._items: Dict[str, JobReport] = {}

    async def fetch(self, bench_id: str) -> Optional[JobReport]:
        """ Returns the job report for the given bench run ID, or None """
        return self._items.get(bench_id)

    async def put(self, bench_id: str, job_report: JobReport) -> None:
        self._items[bench_id] = job_report
