#!/usr/bin/env python3
"""Isolated Bash fixtures: no package installs, system writes, or live services."""
from pathlib import Path
import json
import base64
import shlex
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
            source = (REPO / ('install' if name == 'install_xray.sh' else 'optimize') / name).read_text()
            self.assertTrue(source.endswith('main "$@"\n'))
            source = source.removesuffix('main "$@"\n')
            source = re.sub(r'^export PATH=.*\n', '', source, flags=re.M)
            source = source.replace('/usr/local/bin/xray', str(self.root / 'xray'))
            source = source.replace('/usr/local/etc/xray', str(self.root / 'config'))
            source = source.replace('/etc/', str(self.root / 'etc') + '/')
            source = source.replace('/var/lib/xray-warp', str(self.root / 'warp-state'))
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
install() {
  if [[ "$1" == -d ]]; then command mkdir -p "${@: -1}";
  else command cp "${@: -2}"; fi
}
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
                quantumult = content.split('[quantumult-x]\n', 1)[1].split('\n\n', 1)[0]
                fields = dict(item.split('=', 1) for item in quantumult.split(', '))
                self.assertEqual(fields, {
                    'vless': endpoint + ':443', 'method': 'none',
                    'password': '00000000-0000-4000-8000-000000000000',
                    'obfs': 'over-tls', 'obfs-host': 'www.apple.com',
                    'reality-base64-pubkey': 'public_key',
                    'reality-hex-shortid': '0123456789abcdef',
                    'vless-flow': 'xtls-rprx-vision', 'udp-relay': 'true',
                    'tag': 'Xray-REALITY',
                })
                self.assertNotIn('shadowsocks=', content)
                self.assertIn('Xray-SS = ss, ' + endpoint + ', 8443', content)
                self.assertEqual([p.name for p in file.parent.iterdir() if '.before-install.' not in p.name], ['client_config'])
        self.assertEqual(len(list((self.root / 'home').glob('client_config.before-install.*'))), 1)
        self.bash(self.credentials(False) + 'write_client_configs')
        content = (self.root / 'home/client_config').read_text()
        self.assertEqual(re.findall(r'^\[([^]]+)\]$', content, re.M), ['loon', 'quantumult-x', 'mihomo'])
        self.assertIn('vless=192.0.2.10:443, method=none', content)
        self.assertNotIn('Xray-SS', content)

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
                quantumult = client.split('[quantumult-x]\n', 1)[1].split('\n\n', 1)[0]
                fields = dict(item.split('=', 1) for item in quantumult.split(', '))
                self.assertEqual(fields['vless'], '192.0.2.10:' + str(inbound['port']))
                self.assertEqual(fields['password'], inbound['settings']['clients'][0]['id'])
                self.assertEqual(fields['vless-flow'], inbound['settings']['clients'][0]['flow'])
                self.assertEqual(fields['obfs-host'], inbound['streamSettings']['realitySettings']['serverNames'][0])
                self.assertEqual(fields['reality-hex-shortid'], inbound['streamSettings']['realitySettings']['shortIds'][0])
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
        source = (REPO / 'install' / 'install_xray.sh').read_text()
        self.assertNotRegex(source, r'(?i)\bufw\b|firewall-cmd|firewall-offline-cmd|iptables|nft |firewalld')

    def warp_credentials(self):
        return f'''
ENABLE_WARP=true
WARP_SECRET_KEY={base64.b64encode(bytes(range(32))).decode()}
WARP_PUBLIC_KEY={base64.b64encode(bytes(range(32, 64))).decode()}
WARP_ENDPOINT=engage.cloudflareclient.com:2408
prepare_warp_addresses '172.16.0.2/32,2606:4700:110:8000::1234/128'
prepare_warp_reserved '12,034,255'
'''

    def test_warp_domain_and_address_validation(self):
        p = self.bash('prepare_warp_domains "Example.COM,full:api.example.org *.example.net"; echo "$WARP_DOMAINS_JSON"')
        self.assertEqual(json.loads('[' + p.stdout.strip() + ']'), ['domain:example.com', 'full:api.example.org', 'domain:example.net'])
        self.bash('prepare_warp_domains ""; [[ -z "$WARP_DOMAINS_JSON" ]]')
        for value in ('https://example.com/path', 'example.com:443', 'x\"],\"network\":\"tcp', 'geosite:openai'):
            self.bash('prepare_warp_domains ' + shlex.quote(value), ok=False)
        for value in ('172.16.0.2/32', '2606:4700::1/128', '::/0', '1:2:3:4:5:6:7:8/128'):
            self.bash('prepare_warp_addresses ' + shlex.quote(value))
        for value in ('', '256.1.1.1', '172.16.0.2/33', '2606::1/129', '1::2::3', '1:2:3:4:5:6:7:8::', '::ffff:999.1.1.1'):
            self.bash('prepare_warp_addresses ' + shlex.quote(value), ok=False)
        self.bash('WARP_ENDPOINT="[2606:4700::1]:2408"; validate_warp_endpoint')
        for value in ('host:0', '1.1.1.1:65536', '[1::2::3]:2408', '1.2.3.999:2408'):
            self.bash('WARP_ENDPOINT=' + shlex.quote(value) + '; validate_warp_endpoint', ok=False)
        self.bash("prepare_warp_reserved '256,0,0'", ok=False)

    def test_warp_routing_matrix_and_client_secret_isolation(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nexit 0\n')
        fake.chmod(0o700)
        for mode in ('', 'IPv4', 'IPv6', 'IPv4v6', 'IPv6v4'):
            for routing in ('empty', 'domains', 'all'):
                with self.subTest(mode=mode, routing=routing):
                    settings = 'WARP_MODE=all' if routing == 'all' else 'WARP_MODE=domains'
                    if routing == 'domains': settings += '; prepare_warp_domains "example.com,full:api.example.net"'
                    self.bash(self.credentials() + self.warp_credentials() + f'''
parse_arguments --outbound '{mode}' --no-optimize-network --yes
select_network_preferences
{settings}
verify_warp_connection() {{ echo WARP_CHECKED >>"$LOG"; }}
write_xray_config
write_client_configs
''')
                    server = json.loads((self.root / 'config/config.json').read_text())
                    warp = next(out for out in server['outbounds'] if out.get('tag') == 'warp')
                    self.assertEqual(warp['protocol'], 'wireguard')
                    self.assertTrue(warp['settings']['noKernelTun'])
                    self.assertEqual(warp['settings']['reserved'], [12, 34, 255])
                    self.assertEqual(warp['settings']['address'], ['172.16.0.2/32', '2606:4700:110:8000::1234/128'])
                    self.assertEqual(server['outbounds'][0]['protocol'], 'freedom')
                    rules = server.get('routing', {}).get('rules', [])
                    if mode in ('IPv4', 'IPv6'):
                        self.assertEqual(rules.pop(0)['outboundTag'], 'block-other-family')
                    if routing == 'empty': self.assertEqual(rules, [])
                    elif routing == 'all': self.assertEqual(rules, [{'type': 'field', 'network': 'tcp,udp', 'outboundTag': 'warp'}])
                    else: self.assertEqual(rules[0]['domain'], ['domain:example.com', 'full:api.example.net'])
                    for inbound in server['inbounds']:
                        self.assertEqual('sniffing' in inbound, routing == 'domains')
                    bundle = (self.root / 'home/client_config').read_text()
                    self.assertNotIn(warp['settings']['secretKey'], bundle)
                    operations = (self.root / 'operations').read_text()
                    self.assertLess(operations.rindex('WARP_CHECKED'), operations.rindex('systemctl stop xray'))

    def test_warp_actual_check_requires_on_and_stops_before_replacement(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nif [[ "$2" == -test ]]; then exit 0; fi\nexec sleep 10\n')
        fake.chmod(0o700)
        body = self.credentials() + self.warp_credentials() + r'''
TEMP_WARP_DIR=$(mktemp -d /tmp/xray-warp-test.XXXXXX)
WARP_ENDPOINT=162.159.192.1:2408
sleep() { command sleep 0.02; }
ss() { :; }
curl() { echo "$*" >>"$LOG"; printf 'warp=%s\n' "$TRACE_STATE"; }
write_xray_config
'''
        self.bash('TRACE_STATE=off\n' + body, ok=False)
        operations = (self.root / 'operations').read_text()
        self.assertNotIn('systemctl stop', operations)
        self.assertFalse((self.root / 'config/config.json').exists())
        for state in ('on', 'plus'):
            p = self.bash(f'TRACE_STATE={state}\n' + body + '; [[ $WARP_VERIFIED == true ]]')
            self.assertIn(f'warp={state}', p.stdout)
        self.assertIn('--proxy socks5h://127.0.0.1:', (self.root / 'operations').read_text())

    def test_warp_verified_endpoint_is_pinned_in_production_json(self):
        fake = self.root / 'xray'
        fake.write_text('#!/bin/bash\nexit 0\n')
        fake.chmod(0o700)
        self.bash(self.credentials() + self.warp_credentials() + r'''
getent() {
  if [[ "$1" == ahostsv4 ]]; then echo '162.159.192.1 DGRAM';
  elif [[ "$1" == ahostsv6 ]]; then echo '2606:4700:d0::1 DGRAM'; fi
}
timeout() { shift; "$@"; }
probe_warp_connection() {
  printf '%s\n' "$WARP_ENDPOINT" >>"$FIXTURE_ROOT/endpoints"
  if [[ "$WARP_ENDPOINT" == '[2606:4700:d0::1]:2408' ]]; then
    [[ "$1" == *'"endpoint": "[2606:4700:d0::1]:2408"'* ]]
  else return 1; fi
}
write_xray_config
''')
        config = json.loads((self.root / 'config/config.json').read_text())
        warp = next(o for o in config['outbounds'] if o.get('tag') == 'warp')
        self.assertEqual(warp['settings']['peers'][0]['endpoint'], '[2606:4700:d0::1]:2408')
        self.assertEqual((self.root / 'endpoints').read_text().splitlines(), ['162.159.192.1:2408', '[2606:4700:d0::1]:2408'])

    def test_wgcf_register_reuse_and_generate_failures(self):
        key = base64.b64encode(bytes(range(32))).decode()
        profile = f'[Interface]\nPrivateKey = {key}\nAddress = 172.16.0.2/32, 2606:4700::123/128\n[Peer]\nPublicKey = {key}\nEndpoint = engage.cloudflareclient.com:2408\n'
        (self.root / 'profile-template').write_text(profile)
        mock = self.root / 'mock-wgcf'
        mock.write_text('''#!/bin/bash
echo "$3" >>"$FIXTURE_ROOT/wgcf-calls"
if [[ "$3" == register ]]; then
  [[ "$MOCK_STAGE" != register-fail ]] || exit 1
  echo fixture-account >"$2"
elif [[ "$3" == generate ]]; then
  [[ "$MOCK_STAGE" != generate-fail ]] || exit 1
  cp "$FIXTURE_ROOT/profile-template" "$5"
fi
''')
        mock.chmod(0o700)
        body = r'''
ENABLE_WARP=true
export MOCK_STAGE=ok
timeout() { shift; "$@"; }
download_wgcf() { cp "$FIXTURE_ROOT/mock-wgcf" "$TEMP_WARP_DIR/wgcf"; }
prepare_warp_account
[[ -n "$WARP_ADDRESSES_JSON" ]]
'''
        self.bash(body)
        account = self.root / 'warp-state/wgcf-account.toml'
        original = account.read_text()
        self.bash(body)
        calls = (self.root / 'wgcf-calls').read_text().splitlines()
        self.assertEqual(calls, ['register', 'generate', 'generate'])
        self.assertEqual(account.stat().st_mode & 0o777, 0o600)
        self.bash(body.replace('MOCK_STAGE=ok', 'MOCK_STAGE=generate-fail'), ok=False)
        self.assertEqual(account.read_text(), original)
        account.unlink()
        self.bash(body.replace('MOCK_STAGE=ok', 'MOCK_STAGE=register-fail'), ok=False)
        self.assertFalse(account.exists())

    def test_warp_default_off_interaction(self):
        for answer in (b'\n', b'n\n', b'N\n'):
            master, slave = pty.openpty()
            env = dict(os.environ, FIXTURE_ROOT=str(self.root))
            try:
                proc = subprocess.Popen(['bash', '-c', 'source "$FIXTURE_ROOT/install_xray.sh"; select_warp_preferences; [[ $ENABLE_WARP == false ]]; echo DISABLED_OK'], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                os.close(slave); slave = None
                os.write(master, answer)
                stdout, stderr = proc.communicate(timeout=10)
                self.assertEqual(proc.returncode, 0, stdout.decode() + stderr.decode())
                self.assertIn(b'DISABLED_OK', stdout)
            finally:
                os.close(master)
                if slave is not None: os.close(slave)
        self.bash('ASSUME_YES=true; select_warp_preferences; prepare_warp_account; [[ $ENABLE_WARP == false && -z "$TEMP_WARP_DIR" ]]')


if __name__ == '__main__':
    unittest.main(verbosity=2)
