# Engine benchmarks

This directory contains a python script `bench_download.py` for downloading
Engine and stdlib benchmark results from this repository's GitHub Actions runs,
so that runs can be compared locally.

Note that for convenience, there is `bench_tool` directory that is a Python
package. The `bench_download.py` script uses this package.

Dependencies for `bench_download.py`:

- python >= 3.7
- `pandas`, `numpy` and `jinja2`
  - Install, e.g., by `pip install pandas numpy jinja2`
- GH CLI utility
  - Install either from https://cli.github.com/ or with
    `sudo apt-get install gh`

Check `bench_download -h` for documentation and usage. Ensure that your
`/usr/bin/env python` links to Python version at least 3.7. `bench_download.py`
creates `generated_site` directory with HTML files for visualizing the benchmark
results.

One can also download only a CSV file representing all the selected benchmark
results with `bench_download.py --create-csv`.

## Contribute

Run the (offline) tests from this directory with:

```bash
python -m unittest discover -v -s . -p "test_*.py" -t .
```

Run a single test with `-k <test_name>`.

## Relation to GH Actions

The `bench_download.py` script downloads the `benchmark-results.xml` artifact
(containing `bench-report.xml`) that the
[Benchmark Engine](../../../.github/workflows/engine-benchmark.yml) and
[Benchmark Standard Libraries](../../../.github/workflows/std-libs-benchmark.yml)
workflows of `jdunkerley/enso` upload. Their IDs are in `bench_tool/__init__.py`
(`ENGINE_BENCH_WORKFLOW_ID`, `STDLIBS_BENCH_WORKFLOW_ID`; look them up with
`gh api repos/jdunkerley/enso/actions/workflows`).

Upstream also published the results to a website through a `bench-upload.yml`
workflow and kept a persistent cache of reports in a separate results
repository. This repository has neither (#363), so there is no upload
and no cache: only runs whose artifacts have not expired (90 days by default)
can be downloaded.
