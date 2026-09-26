#!/usr/bin/python3
"""Deploy an explicit main commit on the production Mac from GitHub Actions."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

REPO = Path('/Users/lkim/stan_chat_api')
STATE = Path('/Users/lkim/.local/share/stan-autodeploy')
WEB = Path('/opt/homebrew/var/www/stan/dist')
API = REPO / 'chat/.mastra/output'
SERVICE = f'gui/{os.getuid()}/me.lkim.stan-api'
os.environ['PATH'] = '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
os.environ['GIT_TERMINAL_PROMPT'] = '0'


def log(message):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), message, flush=True)


def run(*args, cwd=REPO, capture=False, env=None):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            env=env, timeout=900)
    return result.stdout.strip() if capture else None


def git(*args):
    return run('git', *args, capture=True)


def check_checkout(expected=None):
    if git('branch', '--show-current') != 'main':
        raise RuntimeError('Checkout is not on main; deployment skipped')
    if git('status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Tracked local edits exist; deployment skipped (including admin prompt edits)')
    head = git('rev-parse', 'HEAD')
    if expected and head != expected:
        raise RuntimeError('Checkout changed during build; deployment skipped')
    return head


def download(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.read()


def health():
    last = None
    for _ in range(20):
        try:
            if json.loads(download('http://127.0.0.1:4470/health')).get('success') is True:
                return
        except Exception as exc:
            last = exc
        time.sleep(1)
    raise RuntimeError(f'Backend health check failed: {last}')


def verify_web():
    html = (WEB / 'index.html').read_bytes()
    if download('https://stan.lkim.me/') != html:
        raise RuntimeError('Public HTML differs from deployed build')
    for asset in re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html.decode()):
        if download('https://stan.lkim.me' + asset) != (WEB / asset.lstrip('/')).read_bytes():
            raise RuntimeError(f'Public asset mismatch: {asset}')


def save(name, data):
    tmp = STATE / (name + '.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n')
    tmp.replace(STATE / name)


def deploy(target, head):
    log(f'Building {target[:12]} in a temporary directory')
    with tempfile.TemporaryDirectory(prefix='build-', dir=STATE) as tmp:
        stage = Path(tmp)
        run('git', 'archive', '-o', str(stage / 'source.tar'), target, 'chat')
        run('/usr/bin/tar', '-xf', str(stage / 'source.tar'), '-C', str(stage))
        for rel in ('.env', 'chat/.env', 'chat/web/.env', 'chat/web/.env.local',
                    'chat/web/.env.production', 'chat/web/.env.production.local'):
            source = REPO / rel
            if source.is_file():
                destination = stage / rel
                if destination.exists():
                    destination.unlink()
                destination.symlink_to(source)
        for folder in ('chat', 'chat/web'):
            run('npm', 'ci', '--no-audit', '--no-fund', cwd=stage / folder)
        run('npm', 'run', 'build', cwd=stage / 'chat/web')
        env = dict(os.environ, MASTRA_PORT='4470', PGDATABASE='stan_jeju')
        run('npm', 'run', 'build', cwd=stage / 'chat', env=env)
        check_checkout(head)
        # Only now update the checkout and replace the running artifacts.
        run('git', 'merge', '--ff-only', target)
        backup_api = STATE / 'previous-api'
        backup_web = STATE / 'previous-web'
        for path in (backup_api, backup_web):
            if path.exists():
                shutil.rmtree(path)
        shutil.copytree(WEB, backup_web)
        API.rename(backup_api)
        try:
            (stage / 'chat/.mastra/output').rename(API)
            run('rsync', '-a', '--delete', str(stage / 'chat/web/dist') + '/', str(WEB) + '/')
            run('launchctl', 'kickstart', '-k', SERVICE)
            health()
            verify_web()
            if json.loads(download('https://api.stan.lkim.me/health')).get('success') is not True:
                raise RuntimeError('Public API health check failed')
        except Exception:
            log('Deployment verification failed; restoring previous frontend/backend artifacts')
            if API.exists():
                shutil.rmtree(API)
            backup_api.rename(API)
            run('rsync', '-a', '--delete', str(backup_web) + '/', str(WEB) + '/')
            run('launchctl', 'kickstart', '-k', SERVICE)
            health()
            raise
    save('deployed.json', {'commit': target, 'deployed_at': time.strftime('%Y-%m-%d %H:%M:%S')})
    (STATE / 'failed.json').unlink(missing_ok=True)
    log(f'Deployed {target[:12]}; public frontend assets and API verified')


def validate_target(target, head):
    if not re.fullmatch(r'[0-9a-f]{40}', target):
        raise ValueError('Deployment requires a full commit SHA')
    run('git', 'merge-base', '--is-ancestor', target, 'origin/main')
    # Refuse divergent or older commits; never reset local work or roll code back.
    run('git', 'merge-base', '--is-ancestor', head, target)


def acquire_lock(lock):
    deadline = time.monotonic() + 1200
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise RuntimeError('Timed out waiting for the deployment lock')
            time.sleep(2)


def main(target):
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'deploy.lock').open('w') as lock:
        acquire_lock(lock)
        try:
            head = check_checkout()
            run('git', 'fetch', '--quiet', 'origin', 'refs/heads/main:refs/remotes/origin/main')
            validate_target(target, head)
            # Reruns must actually retry, even after a prior failure or success.
            deploy(target, head)
        except Exception as exc:
            save('failed.json', {'commit': target, 'time': time.time(), 'error': str(exc)})
            log(f'ERROR: {exc}')
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    main(parser.parse_args().commit)
