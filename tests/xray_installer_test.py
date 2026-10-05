#!/usr/bin/env python3
"""Isolated Bash fixtures: no package installs, system writes, or live services."""
from pathlib import Path
import json
import os
import re
import pty
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'home').mkdir()
        for name in ('install_xray.sh', 'networt_optimization.sh'):
            source = (REPO / name).read_text()
            self.assertTrue(source.endswith('main "$@"\n'))
            source = source.removesuffix('main "$@"\n')
            source = re.sub(r'^export PATH=.*\n', '', source, flags=re.M)
            source = source.replace('/usr/local/bin/xray', str(self.root / 'xray'))
            source = source.replace('/usr/local/etc/xray', str(self.root / 'config'))
            source = source.replace('/etc/', str(self.root / 'etc') + '/')
            (self.root / name).write_text(source)
        (self.root / 'etc').mkdir()
        (self.root / 'etc/sysctl.d').mkdir()
        (self.root / 'etc/modules-load.d').mkdir()
        self.os_release('ubuntu', '24.04')

    def os_release(self, system, version='9', like=''):
        (self.root / 'etc/os-release').write_text(
            f'ID={system}\nVERSION_ID="{version}"\nID_LIKE="{like}"\nPRETTY_NAME="Fixture {system} {version}"\n')

    def bash(self, body, script='install_xray.sh', ok=True):
        common = r'''
source "$FIXTURE_ROOT/$FIXTURE_SCRIPT"
LOG="$FIXTURE_ROOT/operations"
uname() { if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi; }
apt-get() { echo "apt-get $*" >>"$LOG"; }
dnf() { echo "dnf $*" >>"$LOG"; }
yum() { echo "yum $*" >>"$LOG"; }
systemctl() { echo "systemctl $*" >>"$LOG"; return 0; }
getent() { printf 'fixture:x:1000:1000::%s:/bin/bash\n' "$FIXTURE_ROOT/home"; }
id() {
  if [[ $# == 2 ]]; then command id "$1"; else command id "$@"; fi
}
# Only fixture file ownership is changed; no privilege escalation.
chown() { return 0; }
install() { command cp "${@: -2}"; }
'''
        env = os.environ.copy()
        env.update(FIXTURE_ROOT=str(self.root), FIXTURE_SCRIPT=script)
        proc = subprocess.run(['bash', '-c', common + '\n' + body], env=env,
                              text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=15)
        if ok:
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        else:
            self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        return proc

    def test_system_families_and_package_selection(self):
        for system, like, expected in (
            ('debian', '', 'apt-get'), ('ubuntu', '', 'apt-get'),
            ('rhel', '', 'dnf'), ('centos', '', 'dnf'), ('rocky', '', 'dnf'),
            ('almalinux', '', 'dnf'), ('fedora', '', 'dnf'), ('ol', '', 'dnf'),
            ('custom', 'ubuntu debian', 'apt-get'), ('custom', 'rhel fedora', 'dnf'),
        ):
            with self.subTest(system=system, like=like):
                self.os_release(system, like=like)
                p = self.bash('detect_system; echo "PM=$PACKAGE_MANAGER"')
                self.assertIn('PM=' + expected, p.stdout)
                for mode in ('ipv4', 'ipv6'):
                    self.bash(f'MODE={mode}; check_system', 'networt_optimization.sh')
        self.os_release('rocky')
        self.assertIn('PM=yum', self.bash('unset -f dnf; detect_system; echo "PM=$PACKAGE_MANAGER"').stdout)

    def test_unsupported_system_stops_before_mutations(self):
        self.os_release('alpine')
        p = self.bash('detect_system; install_required_tools', ok=False)
        self.assertIn('不支持的 VPS 系统', p.stderr)
        self.assertFalse((self.root / 'operations').exists())
        p = self.bash('require_root() { :; }; main --ipv4 --yes', 'networt_optimization.sh', ok=False)
        self.assertIn('不支持的 VPS 系统', p.stderr)
        self.assertNotIn('IPv6 前缀', p.stdout + p.stderr)

    def test_package_commands(self):
        for manager in ('apt-get', 'dnf', 'yum'):
            with self.subTest(manager=manager):
                p = self.root / 'operations'
                p.unlink(missing_ok=True)
                self.bash(f'PACKAGE_MANAGER={manager}; install_required_tools')
                log = p.read_text()
                self.assertIn(manager + (' update' if manager == 'apt-get' else ' makecache'), log)
                self.assertIn(' install ', log)
                self.assertIn('iproute2' if manager == 'apt-get' else 'iproute procps-ng', log)
                self.assertNotRegex(log, r'ufw|firewalld|upgrade')
        self.bash('PACKAGE_MANAGER=apt-get; apt-get() { return 1; }; install_required_tools', ok=False)

    def test_port_options(self):
        self.bash('parse_arguments --ipv4 --no-optimize-network --yes --port 8443; select_xray_port; [[ $SS_PORT == 8444 ]]')
        for flags in ('--port 443 --ss-port 443', '--ss-port 0', '--ss-port 65536', '--ss-port text', '--no-shadowsocks --ss-port 8443'):
            self.bash('parse_arguments --ipv4 --no-optimize-network --yes ' + flags + '; select_xray_port', ok=False)
        self.bash('parse_arguments --client-address=2001:db8::1; [[ $LOON_SERVER_IP == 2001:db8::1 ]]')

    def test_ipv4_does_not_offer_ipv6_prefix(self):
        p = self.bash('MODE=ipv4; IPV6_SUPPORTED=true; IPV6_HAS_ADDRESS=false; prepare_ipv6_address', 'networt_optimization.sh')
        self.assertNotIn('IPv6', p.stdout + p.stderr)
        p = self.bash('MODE=ipv6; IPV6_SUPPORTED=true; IPV6_HAS_ADDRESS=false; prepare_ipv6_address', 'networt_optimization.sh')
        self.assertIn('--ipv6-prefix', p.stdout)

    def test_single_stack_mode_validation_and_dns(self):
        self.bash('MODE=ipv4; HAS_IPV4=true; validate_ip_mode; select_dns_servers; [[ ${DNS_SERVERS[0]} == 1.1.1.1 ]]', 'networt_optimization.sh')
        self.bash('MODE=ipv6; HAS_IPV6=true; validate_ip_mode; select_dns_servers; [[ ${DNS_SERVERS[0]} == 2606:4700:4700::1111 ]]', 'networt_optimization.sh')
        self.bash('MODE=ipv6; HAS_IPV4=true; validate_ip_mode', 'networt_optimization.sh', ok=False)
        self.bash('MODE=ipv4; HAS_IPV6=true; validate_ip_mode', 'networt_optimization.sh', ok=False)

    def test_single_stack_fallback_for_dual_mode(self):
        self.bash('MODE=ipv4; HAS_IPV6=true; ALLOW_FAMILY_FALLBACK=true; validate_ip_mode; [[ $MODE == ipv6 ]]', 'networt_optimization.sh')
        self.bash('MODE=ipv6; HAS_IPV4=true; ALLOW_FAMILY_FALLBACK=true; validate_ip_mode; [[ $MODE == ipv4 ]]', 'networt_optimization.sh')

    def test_managed_dns_symlink_is_skipped(self):
        (self.root / 'managed-dns').write_text('nameserver 192.0.2.1\n')
        (self.root / 'etc/resolv.conf').symlink_to(self.root / 'managed-dns')
        # GNU readlink -f isn't available on all macOS versions.
        self.bash('readlink() { echo "$FIXTURE_ROOT/managed-dns"; }; detect_dns_mode; [[ $DNS_MODE == skipped ]]', 'networt_optimization.sh')
        self.assertEqual((self.root / 'managed-dns').read_text(), 'nameserver 192.0.2.1\n')

    def credentials(self, enabled=True, address='192.0.2.10'):
        return f'''
UUID=00000000-0000-4000-8000-000000000000
PRIVATE_KEY=server_private_key_must_not_be_exported
PUBLIC_KEY=public_key
SHORT_ID=0123456789abcdef
SS_PASSWORD={'a'*64}
LOON_SERVER_IP={address}
ENABLE_SHADOWSOCKS={'true' if enabled else 'false'}
ASSUME_YES=true
NETWORK_MODE=ipv4
'''

    def test_client_file_format_permissions_and_backup(self):
        for address in ('192.0.2.10', '2001:db8::10'):
            with self.subTest(address=address):
                self.bash(self.credentials(address=address) + 'write_client_configs')
                file = self.root / 'home/client_config'
                content = file.read_text()
                self.assertEqual(re.findall(r'^\[([^]]+)\]$', content, re.M), ['loon', 'quantumult-x', 'surge', 'mihomo'])
                self.assertTrue(content.startswith('[loon]\nXray-REALITY'))
                self.assertNotIn('server_private_key', content)
                self.assertIn('type: vless', content)
                self.assertIn('support-x25519mlkem768: true', content)
                self.assertIn('short-id: "0123456789abcdef"', content)
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                endpoint = '[' + address + ']' if ':' in address else address
                self.assertIn('shadowsocks=' + endpoint + ':8443', content)
                self.assertIn('Xray-SS = ss, ' + endpoint + ', 8443', content)
                self.assertEqual([p.name for p in file.parent.iterdir() if '.before-install.' not in p.name], ['client_config'])
        self.assertEqual(len(list((self.root / 'home').glob('client_config.before-install.*'))), 1)
        self.bash(self.credentials(False) + 'write_client_configs')
        content = (self.root / 'home/client_config').read_text()
        self.assertEqual(re.findall(r'^\[([^]]+)\]$', content, re.M), ['loon', 'mihomo'])

    def test_client_symlink_is_not_overwritten(self):
        target = self.root / 'target'
        target.write_text('keep\n')
        (self.root / 'home/client_config').symlink_to(target)
        self.bash(self.credentials() + 'write_client_configs', ok=False)
        self.assertEqual(target.read_text(), 'keep\n')

    def test_server_configuration_consistency(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nexit 0\n')
        fake.chmod(0o700)
        for enabled in (True, False):
            with self.subTest(enabled=enabled):
                self.bash(self.credentials(enabled) + 'OPTIMIZE_NETWORK=true; write_xray_config; write_client_configs')
                server = json.loads((self.root / 'config/config.json').read_text())
                client = (self.root / 'home/client_config').read_text()
                inbound = server['inbounds'][0]
                self.assertEqual(inbound['streamSettings']['realitySettings']['minClientVer'], '1.8.2')
                self.assertIn(inbound['settings']['clients'][0]['id'], client)
                self.assertIn(str(inbound['port']), client)
                self.assertEqual(len(server['inbounds']), 2 if enabled else 1)
                if enabled:
                    ss = server['inbounds'][1]
                    self.assertEqual(ss['settings']['network'], 'tcp,udp')
                    self.assertIn(ss['settings']['password'], client)
                    self.assertEqual(ss['settings']['method'], 'aes-128-gcm')

    def test_missing_udp_listener_fails_verification(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nexit 0\n')
        fake.chmod(0o700)
        (self.root / 'config').mkdir()
        (self.root / 'config/config.json').write_text('{}')
        p = self.bash(r'''
sleep() { :; }
ss() { if [[ "$*" == '-H -ltn' ]]; then printf 'LISTEN 0 128 *:443 *:*\nLISTEN 0 128 *:8443 *:*\n'; fi; }
verify_xray_installation
''', ok=False)
        self.assertIn('Shadowsocks TCP/UDP', p.stderr)

    def test_root_elevation_preserves_arguments_and_user_settings(self):
        bindir = self.root / 'bin'
        bindir.mkdir()
        sudo = bindir / 'sudo'
        sudo.write_text('#!/bin/bash\nprintf "%s\\n" "$@" >"$FIXTURE_ROOT/sudo-args"\n')
        sudo.chmod(0o700)
        body = r'''
PATH="$FIXTURE_ROOT/bin:$PATH"
id() { echo 1000; }
parse_arguments --ipv6 --no-optimize-network --port 1443 --ss-port 18443 --client-address 2001:db8::1 --yes
ensure_root --ipv6 --no-optimize-network --port 1443 --ss-port 18443 --yes
'''
        self.bash(body)
        args = (self.root / 'sudo-args').read_text()
        self.assertIn('XRAY_PORT=1443', args)
        self.assertIn('LOON_SERVER_IP=2001:db8::1', args)
        self.assertIn('--ss-port\n18443', args)
        self.assertIn('bash\n-c\n', args)

    def test_outbound_modes_and_empty_configuration(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nexit 0\n')
        fake.chmod(0o700)
        for mode, expected in (('', None), ('IPv4', 'ForceIP'), ('IPv6', 'ForceIP'), ('IPv4v6', 'UseIP'), ('IPv6v4', 'UseIP')):
            with self.subTest(mode=mode):
                self.bash(self.credentials() + 'NETWORK_MODE=""; parse_arguments --outbound "' + mode + '" --no-optimize-network --yes; select_network_preferences; write_xray_config')
                server = json.loads((self.root / 'config/config.json').read_text())
                direct = server['outbounds'][0]
                if expected is None:
                    self.assertEqual(direct, {'protocol': 'freedom'})
                    self.assertNotIn('routing', server)
                else:
                    self.assertEqual(direct['streamSettings']['sockopt']['domainStrategy'], expected)
                    if 'v6' in mode and mode not in ('IPv4', 'IPv6'):
                        self.assertEqual(direct['streamSettings']['sockopt']['happyEyeballs']['prioritizeIPv6'], mode == 'IPv6v4')
                    else:
                        self.assertEqual(server['routing']['rules'][0]['ip'], ['::/0'] if mode == 'IPv4' else ['0.0.0.0/0'])
                        self.assertEqual(server['dns']['queryStrategy'], 'UseIPv4' if mode == 'IPv4' else 'UseIPv6')
        self.bash('parse_arguments --no-optimize-network --yes; select_network_preferences; [[ -z "$NETWORK_MODE" ]]')
        self.bash('parse_arguments --outbound bad --no-optimize-network --yes', ok=False)
        self.bash('parse_arguments --ipv4 --ipv6', ok=False)

    def test_keep_priority_does_not_require_selected_family(self):
        self.bash('parse_arguments --keep-priority --yes; HAS_IPV4=true; validate_ip_mode; [[ $MODE == keep ]]', 'networt_optimization.sh')

    def test_interactive_blank_has_no_default(self):
        master, slave = pty.openpty()
        env = os.environ.copy()
        env['FIXTURE_ROOT'] = str(self.root)
        try:
            proc = subprocess.Popen(['bash', '-c', 'source "$FIXTURE_ROOT/install_xray.sh"; OPTIMIZE_NETWORK=false; select_network_preferences; [[ -z "$NETWORK_MODE" ]]; echo EMPTY_OK'], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            os.close(slave); slave = None
            os.write(master, b'\n')
            stdout, stderr = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, stdout.decode() + stderr.decode())
            self.assertIn(b'EMPTY_OK', stdout)
            self.assertNotIn('默认 1', stdout.decode() + stderr.decode())
        finally:
            os.close(master)
            if slave is not None: os.close(slave)

    def test_keep_priority_preserves_gai_during_apply(self):
        self.bash(r'''
MODE=keep
DNS_MODE=skipped
REALITY_SYSCTLS=()
confirm_action() { :; }
check_dns_writable() { :; }
create_backup() { :; }
apply_ipv6_address() { :; }
select_dns_servers() { :; }
detect_bbr() { :; }
prepare_gai_config() { echo UNEXPECTED >"$FIXTURE_ROOT/unexpected-gai"; }
prepare_sysctl_config() { echo '# fixture' >"$1"; }
verify_configuration() { :; }
apply_dns_configuration() { :; }
show_status() { :; }
sysctl() { :; }
printf 'original priority\n' >"$GAI_FILE"
apply_configuration
[[ "$(cat "$GAI_FILE")" == 'original priority' ]]
[[ ! -e "$FIXTURE_ROOT/unexpected-gai" ]]
''', 'networt_optimization.sh')

    def test_no_firewall_commands_remain(self):
        source = (REPO / 'install_xray.sh').read_text()
        self.assertNotRegex(source, r'(?i)\bufw\b|firewall-cmd|firewall-offline-cmd|iptables|nft |firewalld')


if __name__ == '__main__':
    unittest.main(verbosity=2)
