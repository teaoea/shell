#!/usr/bin/env python3
"""Isolated SSH parser and command fixtures; never changes host firewall/services."""
from pathlib import Path
import os
import platform
import re
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'security_hardening.sh'
SSHD = shutil.which('sshd') or '/usr/sbin/sshd'
KEYGEN = shutil.which('ssh-keygen')
if not Path(SSHD).is_file() or not KEYGEN:
    raise SystemExit('Tests require OpenSSH sshd and ssh-keygen; no services are started.')

COMMON = r'''
source "$1/fixture.sh"
SSHD="$1/sshd-wrapper"
SSH_SERVICE=ssh.service
SSH_CONNECTION='203.0.113.10 50000 192.0.2.10 22'
LOGIN_USER=root
SSH_PORT=22222
PASSWORD_MODE=disable-password
KEY_CONFIRMED=true
FIREWALL_MODE=enable
ASSUME_YES=true
ALLOW_PORTS=(443/tcp 443/udp)
LOG="$1/operations"
: >"$LOG"
getent() { printf 'root:x:0:0:root:%s:/bin/bash\n' "$1_ROOT/home"; }
id() { if [[ "$1" == -un ]]; then echo root; else command id "$@"; fi; }
mkdir -p -m 700 "$STATE_DIR"
systemctl() {
  printf 'systemctl %s\n' "$*" >>"$LOG"
  if [[ "$1" == is-active ]]; then
    case "${@: -1}" in
      ssh.service) [[ "${SSH_INACTIVE:-0}" != 1 ]]; return ;;
      vps-security-rollback.timer) [[ "${TIMER_FAIL:-0}" != 1 ]]; return ;;
      *) return 1 ;;
    esac
  fi
  return 0
}
ufw() {
  printf 'ufw %s\n' "$*" >>"$LOG"
  if [[ "$1" == status ]]; then echo 'Status: active'; return; fi
  if [[ "$1" == prepend || "$1" == allow ]]; then echo "$*" >>"$UFW_DIR/user.rules"; fi
  if [[ "$1" == --force && "$2" == enable && "${UFW_FAIL:-0}" == 1 ]]; then UFW_FAIL=0; return 1; fi
  return 0
}
ss() {
  if [[ "$*" == '-H -lnt' ]]; then
    "$SSHD" -T | awk 'tolower($1)=="port" {print "LISTEN 0 128 *:" $2 " *:*"}'
  elif [[ "$*" == '-H -lntu' && "${PORT_BUSY:-0}" == 1 ]]; then
    echo 'tcp LISTEN 0 128 *:22222 *:*'
  fi
}
'''


def fixture(directory):
    for path in ('etc/ssh/sshd_config.d', 'etc/ufw', 'etc/default', 'etc/systemd/system', 'home/.ssh'):
        (directory / path).mkdir(parents=True)
    key = directory / 'host-key'
    subprocess.run([KEYGEN, '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
    shutil.copyfile(str(key) + '.pub', directory / 'home/.ssh/authorized_keys')
    main = directory / 'etc/ssh/sshd_config'
    main.write_text(f'Port 22\nInclude {directory}/etc/ssh/sshd_config.d/*.conf\nHostKey {key}\nAuthorizedKeysFile {directory}/home/.ssh/authorized_keys\nUsePAM no\nPermitRootLogin yes\n')
    (directory / 'etc/ssh/sshd_config.d/cloud.conf').write_text('Port 2200\nPasswordAuthentication yes\n')
    (directory / 'etc/ufw/user.rules').write_text('original-firewall\n')
    (directory / 'etc/default/ufw').write_text('IPV6=no\n')
    source = SCRIPT.read_text().rsplit('main "$@"', 1)[0]
    source = re.sub(r'(readonly [A-Z_]+=)(/etc/[^\n]+|/var/lib/vps-security)', lambda m: m[1] + str(directory / m[2].lstrip('/')), source)
    (directory / 'fixture.sh').write_text(source)
    wrapper = directory / 'sshd-wrapper'
    wrapper.write_text('#!/bin/bash\nexec ' + repr(SSHD) + ' -f ' + repr(str(main)) + ' "$@"\n')
    wrapper.chmod(0o700)
    return main


passed = 0
with tempfile.TemporaryDirectory(prefix='security-hardening-test-') as temp:
    root = Path(temp)

    def run(name, body, expected=0, setup=None, verify=None):
        global passed
        folder = root / str(passed)
        folder.mkdir()
        main = fixture(folder)
        original = main.read_bytes()
        if setup:
            setup(folder, main)
            original = main.read_bytes()
        env = dict(os.environ)
        code = COMMON.replace('$1_ROOT', '$FIXTURE_ROOT')
        if platform.system() == 'Darwin':
            code += 'sed() { if [[ "$1" == -i ]]; then shift; command sed -i "" "$@"; else command sed "$@"; fi; }\n'
        code += body
        env['FIXTURE_ROOT'] = str(folder)
        result = subprocess.run(['/bin/bash', '-s', '--', str(folder)], input=code, text=True, capture_output=True, env=env)
        if result.returncode != expected:
            raise AssertionError(f'{name}: exit {result.returncode}\n{result.stdout}\n{result.stderr}')
        if verify:
            verify(folder, main, original, result)
        passed += 1
        print('PASS', name)

    def restored(folder, main, original, result):
        assert main.read_bytes() == original, result.stderr
        assert (folder / 'etc/ufw/user.rules').read_text() == 'original-firewall\n'
        assert (folder / 'etc/default/ufw').read_text() == 'IPV6=no\n'
        assert not (folder / 'var/lib/vps-security/pending').exists()
        assert '已恢复 SSH' in result.stdout

    run('real SSH parser: staged ports and publickey-only, firewall applied first', r'''
apply_changes
[[ -L "$PENDING" && -f "$RUNNER" ]]
[[ "$(config_value "$("$SSHD" -T)" passwordauthentication)" == no ]]
"$SSHD" -T | grep -Fixq 'port 22'
"$SSHD" -T | grep -Fixq 'port 2200'
"$SSHD" -T | grep -Fixq 'port 22222'
grep -Fxq IPV6=yes "$UFW_DEFAULT"
! grep -q OnBootSec "$TIMER_FILE"
grep -Fxq OnActiveSec=10min "$TIMER_FILE"
grep -q 'ufw allow 443/udp' "$LOG"
awk '/ufw prepend limit 22222/{allow=NR} /systemctl reload ssh.service/{reload=NR} END {exit !(allow && reload && allow<reload)}' "$LOG"
''')
    run('new connection confirmation closes old ports and cancels timer', r'''
apply_changes
SSH_CONNECTION='203.0.113.10 60000 192.0.2.10 22222'
confirm_changes
[[ ! -e "$PENDING" ]]
[[ "$("$SSHD" -T | awk 'tolower($1)=="port" {print $2}')" == 22222 ]]
grep -Fxq confirmed "$BACKUP/result"
grep -q 'systemctl disable --now vps-security-rollback.timer' "$LOG"
''')
    run('old connection cannot confirm; pending timer retained', r'''
apply_changes
confirm_changes
''', 1, verify=lambda f,m,o,r: (f/'var/lib/vps-security/pending').is_symlink() or (_ for _ in ()).throw(AssertionError('pending lost')))
    run('same port still requires a different connection', r'''
SSH_PORT=22
apply_changes
confirm_changes
''', 1, verify=lambda f,m,o,r: '新的 SSH 连接' in r.stderr or (_ for _ in ()).throw(AssertionError(r.stderr)))
    run('firewall failure triggers EXIT rollback, including SSH and UFW', r'''
UFW_FAIL=1
apply_changes
''', 1, verify=restored)
    run('custom Include refuses changes before backup', r'''
apply_changes
''', 1, setup=lambda f,m: (m.write_text(m.read_text()+f'Include {f}/other.conf\n'), (f/'other.conf').write_text('Port 2299\n')), verify=lambda f,m,o,r: m.read_bytes()==o and not (f/'var/lib/vps-security/pending').exists() or (_ for _ in ()).throw(AssertionError(r.stderr)))
    run('timer activation failure restores config before any SSH change', r'''
TIMER_FAIL=1
apply_changes
''', 1, verify=restored)
    run('rollback recovers a stopped SSH service', r'''
apply_changes
SSH_INACTIVE=1
restore_backup "$BACKUP"
grep -q 'systemctl start ssh.service' "$LOG"
''', verify=restored)
    run('keep-firewall mode does not install or modify UFW', r'''
FIREWALL_MODE=keep
PASSWORD_MODE=keep-password
apply_changes
! grep -q '^ufw ' "$LOG"
[[ "$(<"$UFW_DEFAULT")" == IPV6=no ]]
[[ "$(config_value "$("$SSHD" -T)" passwordauthentication)" == yes ]]
''')
    run('missing key refuses password disable before backup', r'''
rm "$FIXTURE_ROOT/home/.ssh/authorized_keys"
apply_changes
''', 1, verify=lambda f,m,o,r: m.read_bytes()==o and not (f/'var/lib/vps-security/pending').exists() or (_ for _ in ()).throw(AssertionError(r.stderr)))
    run('busy port refuses all changes', r'''
PORT_BUSY=1
apply_changes
''', 1)
    run('socket activation refuses all changes', r'''
systemctl() { [[ "$1" == is-active && "${@: -1}" == ssh.socket ]]; }
apply_changes
''', 1)
    run('Match authentication conflict refuses changes', r'''
apply_changes
''', 1, setup=lambda f,m: m.write_text(m.read_text()+'Match User root\nPasswordAuthentication yes\n'))
    run('port-qualified ListenAddress refuses changes', r'''
apply_changes
''', 1, setup=lambda f,m: m.write_text(m.read_text()+'ListenAddress 127.0.0.1:22\n'))
    run('noninteractive password disabling requires explicit key confirmation', r'''
KEY_CONFIRMED=false
select_options
''', 1)
    run('argument validation and port normalization', r'''
PASSWORD_MODE=""
ALLOW_PORTS=()
parse_arguments --ssh-port 02222 --keep-password --firewall keep --allow 00443/tcp --yes
[[ "${ALLOW_PORTS[0]}" == 443/tcp ]]
select_options
[[ "$SSH_PORT" == 2222 ]]
''')
    run('invalid service port rejected', r'''
parse_arguments --allow 65536/tcp
''', 1)
    run('wrong login user cannot confirm', r'''
apply_changes
SSH_CONNECTION='203.0.113.10 60000 192.0.2.10 22222'
SUDO_USER=otheruser
confirm_changes
''', 1)
print(f'{passed} isolated checks passed; real SSH configuration parser used, no services/firewalls changed.')
