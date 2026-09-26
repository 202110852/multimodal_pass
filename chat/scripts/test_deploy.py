"""Guardrails for production deployment; no real services or network are touched."""
import importlib.util
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_checkout_guards(self):
        for values, expected in [(['feature'], None), (['main', ' M file'], None),
                                  (['main', '', 'new'], 'old')]:
            with self.subTest(values=values), patch.object(deploy, 'git', side_effect=values):
                with self.assertRaises(RuntimeError):
                    deploy.check_checkout(expected)

    def test_clean_main(self):
        with patch.object(deploy, 'git', side_effect=['main', '', 'abc']):
            self.assertEqual(deploy.check_checkout(), 'abc')

    def test_full_sha_required(self):
        with patch.object(deploy, 'run') as run:
            with self.assertRaises(ValueError):
                deploy.validate_target('main; echo unsafe', 'b' * 40)
            run.assert_not_called()

    def test_commit_must_be_on_main_and_not_older_than_checkout(self):
        for failure_index in (0, 1):
            with self.subTest(failure_index=failure_index):
                results = [None] * failure_index + [subprocess.CalledProcessError(1, 'git')]
                with patch.object(deploy, 'run', side_effect=results):
                    with self.assertRaises(subprocess.CalledProcessError):
                        deploy.validate_target('a' * 40, 'b' * 40)

    def test_unhealthy_response_is_not_success(self):
        with patch.object(deploy, 'download', return_value=b'{"success":false}'), patch.object(deploy.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                deploy.health()

    def test_exact_commit_is_used_even_when_previous_attempt_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            target = 'a' * 40
            (state / 'failed.json').write_text(json.dumps({'commit': target, 'time': 99999999999}))
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'check_checkout', return_value='head'), \
                 patch.object(deploy, 'run'), patch.object(deploy, 'validate_target') as validate, \
                 patch.object(deploy, 'deploy') as publish:
                deploy.main(target)
                validate.assert_called_once_with(target, 'head')
                publish.assert_called_once_with(target, 'head')

    def test_failure_propagates_to_actions(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'deployed.json').write_text('{"commit":"old"}')
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'check_checkout', return_value='head'), \
                 patch.object(deploy, 'run'), patch.object(deploy, 'validate_target'), \
                 patch.object(deploy, 'deploy', side_effect=RuntimeError('build failed')):
                with self.assertRaisesRegex(RuntimeError, 'build failed'):
                    deploy.main('a' * 40)
            self.assertEqual(json.loads((state / 'deployed.json').read_text())['commit'], 'old')
            self.assertEqual(json.loads((state / 'failed.json').read_text())['error'], 'build failed')

    def test_build_failure_does_not_update_checkout_or_restart_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            def fail_build(*args, **kwargs):
                if args == ('npm', 'run', 'build'):
                    raise RuntimeError('build failed')
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'REPO', state), \
                 patch.object(deploy, 'run', side_effect=fail_build) as run:
                with self.assertRaisesRegex(RuntimeError, 'build failed'):
                    deploy.deploy('a' * 40, 'head')
            self.assertFalse(any(c.args[:2] == ('git', 'merge') for c in run.call_args_list))
            self.assertFalse(any(c.args[0] == 'launchctl' for c in run.call_args_list))

    def test_failed_health_restores_previous_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            web, api = state / 'web', state / 'api'
            for folder in (web, api):
                folder.mkdir()
                (folder / 'version').write_text('old')
            def fake_run(*args, **kwargs):
                if args[:2] == ('/usr/bin/tar', '-xf'):
                    stage = Path(args[-1])
                    for rel in ('chat/.mastra/output', 'chat/web/dist'):
                        folder = stage / rel
                        folder.mkdir(parents=True)
                        (folder / 'version').write_text('new')
                if args[0] == 'rsync':
                    shutil.copytree(args[-2], args[-1], dirs_exist_ok=True)
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'REPO', state), \
                 patch.object(deploy, 'WEB', web), patch.object(deploy, 'API', api), \
                 patch.object(deploy, 'run', side_effect=fake_run), patch.object(deploy, 'check_checkout'), \
                 patch.object(deploy, 'health', side_effect=[RuntimeError('unhealthy'), None]):
                with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                    deploy.deploy('a' * 40, 'head')
            self.assertEqual((web / 'version').read_text(), 'old')
            self.assertEqual((api / 'version').read_text(), 'old')
            self.assertFalse((state / 'deployed.json').exists())


if __name__ == '__main__':
    unittest.main()
