import unittest

from .report_cache import ReportCache
from .test_bench_results import sample_job_report


class TestReportCache(unittest.IsolatedAsyncioTestCase):
    async def test_missing_report_is_none(self):
        self.assertIsNone(await ReportCache().fetch("123456789"))

    async def test_put_then_fetch(self):
        cache = ReportCache()
        bench_id = sample_job_report.bench_run.id
        await cache.put(bench_id, sample_job_report)
        self.assertEqual(sample_job_report, await cache.fetch(bench_id))
