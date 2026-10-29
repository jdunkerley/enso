import unittest

from . import gh


class TestGH(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_gh_installed(self):
        self.assertIsNone(gh.ensure_gh_installed())

    async def test_wrong_gh_query_should_not_fail(self):
        res = await gh.invoke_gh_api("non_existing_repo", "/non_existing_endpoint")
        self.assertIsNone(res)
