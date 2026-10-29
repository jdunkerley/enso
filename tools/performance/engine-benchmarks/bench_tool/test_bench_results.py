import json
import os
import unittest

from bench_tool import ENGINE_BENCH_WORKFLOW_ID, STDLIBS_BENCH_WORKFLOW_ID,     ENSO_REPO, JobReport, JobRun, Commit, Author, Source
from .bench_results import _parse_bench_report_from_xml
from .utils import WithTempDir

sample_job_report = JobReport(
    label_score_dict={
        "test_label": 1.0
    },
    bench_run=JobRun(
        id="123456789",
        display_title="Test",
        html_url="https://github.com/jdunkerley/enso/actions/runs/123456789",
        run_attempt=1,
        event="push",
        head_commit=Commit(
            id="a67297aebf6a094d1ad0b0d88cf7438dbf8bd8fe",
            message="Test commit",
            timestamp="2021-06-01T12:00:00Z",
            author=Author(
                name="Pavel Marek"
            )
        )
    )
)


class TestBenchResults(unittest.IsolatedAsyncioTestCase):
    def test_job_report_is_serializable(self):
        s = json.dumps(sample_job_report.to_dict())
        self.assertIsNotNone(s)
        self.assertGreater(len(s), 0)

    def test_job_report_is_deserializable(self):
        d = sample_job_report.to_dict()
        job_report = JobReport.from_dict(d)
        self.assertEqual(sample_job_report, job_report)

    def test_parse_bench_report_from_xml(self):
        xml = (
            "<reports><cases>"
            "<case><label> a.Bench </label><scores><score>1.5</score>"
            "<score>2.5</score></scores></case>"
            "<case><label>b.Bench</label><scores><score>3</score></scores></case>"
            "</cases></reports>"
        )
        with WithTempDir("test_parse_bench_report") as temp_dir:
            xml_path = os.path.join(temp_dir, "bench-report.xml")
            with open(xml_path, "w") as f:
                f.write(xml)
            report = _parse_bench_report_from_xml(xml_path, sample_job_report.bench_run)
        # The newest score wins when there are several
        self.assertEqual({"a.Bench": 2.5, "b.Bench": 3.0}, report.label_score_dict)
        self.assertEqual(sample_job_report.bench_run, report.bench_run)

    def test_workflow_ids_are_the_forks(self):
        self.assertEqual("jdunkerley/enso", ENSO_REPO)
        self.assertEqual([ENGINE_BENCH_WORKFLOW_ID], Source.ENGINE.workflow_ids())
        self.assertEqual([STDLIBS_BENCH_WORKFLOW_ID], Source.STDLIB.workflow_ids())
