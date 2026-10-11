#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat >&2 <<'EOF'
Usage: scripts/omd.sh <command>
  setup                       first run installs the SDK, AVD and Obsidian; boots the emulator
  verify                      build, deploy and run the smoke probes; prints a JSON summary
  eval <expression>           evaluate JavaScript in Obsidian; prints the JSON result
  eval --probe <file> [--timeout <seconds>]
  download                    download the playing episode; prints a JSON report
  logs [--seconds <1-999>]    Obsidian, WebView and crash lines from logcat (default 20 s)
  screenshot <out.png>        capture the device screen
  stop                        shut the emulator down; the AVD and every vault stay
EOF
	exit 1
}
note() { printf 'omd.sh: %s\n' "$*" >&2; }
die() {
	note "$*"
	exit 1
}

[[ $(uname -s) == Linux ]] || die "Linux only: the emulator runs as a systemd user unit."

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
USER_HOME=$(getent passwd "$UID" | cut -d: -f6)
STATE=$USER_HOME/.cache/obsidian-mobile-debug
SDK=$STATE/android-sdk
unset XDG_CACHE_HOME DBUS_SESSION_BUS_ADDRESS ANDROID_ADB_SERVER_ADDRESS ANDROID_ADB_SERVER_PORT \
	ADB_SERVER_SOCKET ANDROID_EMULATOR_HOME AVD DEVICE API ABI OBSIDIAN_APK OBSIDIAN_SIGNER_SHA256 \
	OMD_ANDROID_STATE_DIR UV_TORCH_BACKEND
export XDG_RUNTIME_DIR=/run/user/$UID ANDROID_SERIAL=emulator-5554 ADB=$SDK/platform-tools/adb \
	ANDROID_SDK_ROOT=$SDK ANDROID_HOME=$SDK ANDROID_USER_HOME=$STATE/android-user \
	ANDROID_AVD_HOME=$STATE/android-user/avd TMPDIR=${TMPDIR:-$STATE/tmp}

# flock -o keeps the lock fd out of the script's children, so a daemon one of
# them forks (the adb server) can never hold the lock after the command ends.
if [[ ${PODNOTES_OMD_LOCKED-} != "$STATE" ]]; then
	mkdir -p "$STATE"
	code=0
	PODNOTES_OMD_LOCKED=$STATE flock -n -o -E 75 "$STATE/podnotes.lock" \
		bash "$ROOT/scripts/omd.sh" "$@" || code=$?
	((code != 75)) || die "Another mobile command is running. Retry when it finishes."
	exit "$code"
fi

AVD=obsidian-debug
APP=md.obsidian
PORT=19333
UNIT=podnotes-android-emulator.service
SETUP_UNIT=podnotes-android-setup.service
SESSION=$STATE/podnotes-session.json
SETUP_SESSION=$STATE/podnotes-setup-session.json
OUT=$ROOT/.obsidian-e2e-artifacts/mobile/session
VAULT=podnotes-$(printf %s "$ROOT" | sha256sum | cut -c1-12)-omd-scratch
VAULT_STATE='({selected: localStorage.getItem("mobile-selected-vault"), open: typeof app === "undefined" ? null : app.vault.getName(), ready: typeof app !== "undefined" && app.workspace.layoutReady, provisioning: Boolean(window.podnotesMobileProvisioning)})'
UVX=(uvx --python 3.13 --from
	git+https://github.com/chhoumann/obsidian-mobile-debug@deebf565bac970e14fd758fccff4c66a06186204
)

adb() { timeout -k 5 15 "$ADB" -s "$ANDROID_SERIAL" "$@"; }
# Pinned OMD re-discovers sockets and rebinds forwards. Keep that lifecycle here.
omd() {
	local budget=180 args=("$@") i
	for ((i=0; i<${#args[@]}; i++)); do
		[[ ${args[i]} != --timeout ]] || budget=$((args[i+1] + 30))
	done
	timeout -k 5 "$budget" env HOME="$USER_HOME" PODNOTES_CDP_SOCKET="$FORWARD_SOCKET" \
		"${UVX[@]}" python - "$@" <<'PYTHON'
import contextlib
import os
import sys
from obsidian_mobile_debug import android, cli

@contextlib.contextmanager
def owned_forward(port, package):
    socket = os.environ["PODNOTES_CDP_SOCKET"]
    pid = android.adb_out(["shell", "pidof", package])
    expected = f"{os.environ['ANDROID_SERIAL']} tcp:{port} localabstract:{socket}"
    if socket != f"webview_devtools_remote_{pid}" or expected not in android.adb_out(["forward", "--list"]).splitlines():
        raise SystemExit("Obsidian restarted or its owned CDP forward changed; retry the command.")
    yield int(pid)

android.cdp_forward = owned_forward
raise SystemExit(cli.main(["android", *sys.argv[1:]]))
PYTHON
}

wait_for() {
	local deadline=$((SECONDS + $1))
	shift
	until "$@"; do
		((SECONDS < deadline)) || return 1
		sleep 1
	done
}


record() { jq -n '$ARGS.named' "$@" >"$SESSION.tmp" && mv "$SESSION.tmp" "$SESSION"; }
field() { jq -r ".$1 // empty" "$SESSION" 2>/dev/null; }
boot_id() { cat /proc/sys/kernel/random/boot_id; }
start_ticks() {
	local stat fields
	stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
	read -ra fields <<<"${stat##*) }"
	printf '%s\n' "${fields[19]}"
}

claim() {
	local owner session
	for session in "$SESSION" "$SETUP_SESSION"; do
		[[ -f $session ]] || continue
		owner=$(jq -er .owner "$session") || die "Unreadable session record $session. Inspect it before removing it."
		[[ $owner == "$ROOT" ]] || die "The Android session belongs to $owner. Run npm run mobile:stop there." \
			"If that worktree is gone, confirm no emulator or setup runs and inspect $session."
	done
}

alive() {
	[[ $(field state) == running && $(field bootId) == "$(boot_id)" ]] &&
		[[ $(start_ticks "$(field pid)") == "$(field startTicks)" ]]
}

need_device() {
	claim
	alive || die "This worktree has no running emulator. Run npm run mobile:setup or npm run mobile:verify."
}


any_emulator() { pgrep -af -- "/emulator/qemu/|^$SDK/emulator/" || true; }
own_emulator() { pgrep -af -- "^$SDK/emulator/" || true; }
unit_status() { systemctl --user show "$UNIT" -p ActiveState -p Result -p ExecMainStatus | paste -sd ' '; }
unit_down() { [[ $(systemctl --user show "$UNIT" -p ActiveState --value) =~ ^(inactive|failed)$ ]]; }
down() { unit_down && [[ -z $(own_emulator) ]]; }
setup_down() { [[ $(systemctl --user show "$SETUP_UNIT" -p ActiveState --value) =~ ^(inactive|failed)$ ]]; }

omd_setup() {
	local apk args=(--avd "$AVD" --sdk-root "$SDK" --android-home "$ANDROID_USER_HOME" --state-dir "$STATE"
		--console-port 5554 --acceleration on)
	apk=$(printf '%s\n' "$STATE"/downloads/Obsidian-*.apk | sort -V | tail -n 1)
	[[ ! -f $apk ]] || args+=(--apk "$apk")
	setup_down || die "Android setup is still running. Run npm run mobile:stop before retrying."
	note "Running omd android setup (the first run downloads about 8 GB). Log: $OUT/setup.log"
	cat >"$OUT/setup-adapter.py" <<'PYTHON'
import os
import subprocess
import sys
from obsidian_mobile_debug import android_setup, cli

def owned_launch(config, command):
    subprocess.run(["bash", os.environ["PODNOTES_ROOT"] + "/scripts/omd.sh", "_launch"], check=True)
    return None, config.state_dir / "podnotes-emulator.log"

android_setup.launch_emulator = owned_launch
raise SystemExit(cli.main(["android", "setup", *sys.argv[1:]]))
PYTHON
	local token
	token=$(cat /proc/sys/kernel/random/uuid)
	jq -n --arg owner "$ROOT" --arg token "$token" --arg bootId "$(boot_id)" \
		'{owner: $owner, token: $token, bootId: $bootId}' >"$SETUP_SESSION.tmp"
	mv "$SETUP_SESSION.tmp" "$SETUP_SESSION"
	: >"$OUT/setup.json"
	: >"$OUT/setup.log"
	systemctl --user reset-failed "$SETUP_UNIT" 2>/dev/null || true
	systemd-run --user --quiet --wait --unit "$SETUP_UNIT" --description "PodNotes Android setup $token" \
		-p Type=exec -p RuntimeMaxSec=35min -p TimeoutStopSec=10 -p KillMode=control-group \
		-p "StandardOutput=append:$OUT/setup.json" -p "StandardError=append:$OUT/setup.log" \
		-E "HOME=$USER_HOME" -E "PATH=$PATH" -E "PODNOTES_ROOT=$ROOT" -E "PODNOTES_OMD_LOCKED=$STATE" \
		-E "ANDROID_SERIAL=$ANDROID_SERIAL" -E "ANDROID_SDK_ROOT=$SDK" -E "ANDROID_HOME=$SDK" \
		-E "ANDROID_USER_HOME=$ANDROID_USER_HOME" -E "ANDROID_AVD_HOME=$ANDROID_AVD_HOME" -E "TMPDIR=$TMPDIR" \
		"${UVX[@]}" python "$OUT/setup-adapter.py" "${args[@]}"
}

first_setup() {
	local code=0
	omd_setup || code=$?
	halt
	((code == 0)) || die "omd android setup failed ($code). See $OUT/setup.log."
}

halt() {
	local unit_pid
	halt_setup
	recover_launch
	unit_pid=$(systemctl --user show "$UNIT" -p MainPID --value)
	if ! alive; then
		[[ ${unit_pid:-0} == 0 ]] || die "The service process does not match this session; it was left alone."
		[[ -z $(any_emulator) ]] || die "An unowned emulator is running; it was left alone."
	fi
	if [[ -x $ADB && $(adb get-state 2>/dev/null) == device ]]; then
		note "Shutting the emulator down..."
		timeout -k 5 60 "$ADB" -s "$ANDROID_SERIAL" shell sync || true
		timeout -k 5 30 "$ADB" -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
	fi
	wait_for 60 down && return 0
	systemctl --user stop "$UNIT" || true
	wait_for 30 down || die "Emulator processes remain ($(unit_status)), so this worktree keeps the session:" \
		"$(own_emulator)"
}

halt_setup() {
	local token description
	if ! setup_down; then
		[[ -f $SETUP_SESSION ]] || die "An unowned Android setup service is running; it was left alone."
		token=$(jq -er .token "$SETUP_SESSION")
		description=$(systemctl --user show "$SETUP_UNIT" -p Description --value)
		[[ $(jq -r .bootId "$SETUP_SESSION") == "$(boot_id)" &&
			$description == "PodNotes Android setup $token" ]] ||
			die "The setup service does not match this session; it was left alone."
		note "Stopping Android setup and its children..."
		systemctl --user stop "$SETUP_UNIT"
	fi
	setup_down || die "Android setup still runs; its ownership record was retained."
	rm -f "$SETUP_SESSION"
}

recover_launch() {
	[[ $(field state) == starting && $(field bootId) == "$(boot_id)" ]] || return 0
	local token pid ticks description
	token=$(field launchToken)
	[[ -n $token ]] || return 0
	description=$(systemctl --user show "$UNIT" -p Description --value)
	[[ $description == "PodNotes Android $token" ]] || return 0
	pid=$(systemctl --user show "$UNIT" -p MainPID --value)
	[[ $pid =~ ^[1-9][0-9]*$ ]] || return 0
	ticks=$(start_ticks "$pid") || return 0
	record --arg state running --arg owner "$ROOT" --arg unit "$UNIT" --argjson pid "$pid" \
		--arg startTicks "$ticks" --arg bootId "$(boot_id)"
}

launch() {
	local cores pid ticks token
	claim
	recover_launch
	if [[ -n $(any_emulator) ]] || ! unit_down; then
		die "An emulator or its service is already running."
	fi
	systemctl --user reset-failed "$UNIT" 2>/dev/null || true
	token=$(cat /proc/sys/kernel/random/uuid)
	record --arg state starting --arg owner "$ROOT" --arg unit "$UNIT" \
		--arg bootId "$(boot_id)" --arg launchToken "$token"
	cores=$(nproc)
	((cores <= 4)) || cores=4
	note "Booting the Android emulator..."
	systemd-run --user --quiet --unit "$UNIT" --description "PodNotes Android $token" \
		-p Type=exec -p TimeoutStopSec=30 \
		-p "StandardOutput=append:$STATE/podnotes-emulator.log" \
		-p "StandardError=append:$STATE/podnotes-emulator.log" \
		-E "ANDROID_SDK_ROOT=$SDK" -E "ANDROID_HOME=$SDK" -E "ANDROID_USER_HOME=$ANDROID_USER_HOME" \
		-E "ANDROID_AVD_HOME=$ANDROID_AVD_HOME" -E "TMPDIR=$TMPDIR" \
		"$SDK/emulator/emulator" -avd "$AVD" -port 5554 -accel on -no-window -no-audio -no-boot-anim \
		-no-snapshot -gpu auto -memory 4096 -cores "$cores" -no-metrics -no-sim -verbose
	pid=$(systemctl --user show "$UNIT" -p MainPID --value)
	ticks=$(start_ticks "$pid") || die "The emulator exited at launch ($(unit_status)). Log: $STATE/podnotes-emulator.log"
	record --arg state running --arg owner "$ROOT" --arg unit "$UNIT" --argjson pid "$pid" \
		--arg startTicks "$ticks" --arg bootId "$(boot_id)"
}

booted() {
	alive || die "The emulator exited while booting ($(unit_status)). Log: $STATE/podnotes-emulator.log"
	[[ $(adb shell getprop sys.boot_completed 2>/dev/null) == 1 ]]
}

boot() {
	local status
	setup_down || die "Android setup is still running. Run npm run mobile:stop before retrying."
	recover_launch
	if ! alive; then
		if [[ -n $(any_emulator) ]] || ! unit_down; then
			die "An Android emulator this worktree does not own is running, and the host runs one at a time:" \
				"$(any_emulator)"
		fi
		status=$(unit_status)
		[[ $status == *Result=success* ]] || note "The last emulator run ended: $status"
		record --arg state starting --arg owner "$ROOT"
		[[ -x $SDK/emulator/emulator && -f $ANDROID_AVD_HOME/$AVD.ini ]] || first_setup
		launch
	fi
	wait_for 300 booted || die "Android did not finish booting within 300 s. Log: $STATE/podnotes-emulator.log"
	if [[ -z $(adb shell pm path "$APP" 2>/dev/null) ]]; then
		omd_setup || die "omd android setup could not install Obsidian. See $OUT/setup.log."
	fi
}


devtools_socket() {
	local pid table
	pid=$(adb shell pidof "$APP" 2>/dev/null) || return 1
	[[ $pid =~ ^[0-9]+$ ]] || return 1
	table=$(adb shell cat /proc/net/unix) || return 1
	[[ $'\n'$table$'\n' == *" @webview_devtools_remote_$pid"$'\n'* ]] || return 1
	printf 'webview_devtools_remote_%s\n' "$pid"
}

start_app() {
	[[ -n $(adb shell pidof "$APP" 2>/dev/null) ]] || adb shell am start -n "$APP/.MainActivity" >/dev/null
	wait_for 120 devtools_socket >/dev/null || die "Obsidian exposed no WebView DevTools socket within 120 s."
}

# OMD falls back to another app's devtools socket when Obsidian's is missing.
# Binding the port to Obsidian's own socket first rules that out.
forward() {
	local socket listed
	socket=$(devtools_socket) || die "Obsidian is not running on the device. Run npm run mobile:verify."
	listed=$(timeout -k 5 15 env -u ANDROID_SERIAL "$ADB" forward --list)
	if [[ $listed == *" tcp:$PORT "* ]]; then
		[[ $'\n'$listed$'\n' == *$'\n'"$ANDROID_SERIAL tcp:$PORT localabstract:$(field cdpSocket)"$'\n'* ]] || die "Port $PORT is forwarded elsewhere: $listed"
		adb forward --remove "tcp:$PORT"
	fi
	jq --arg socket "$socket" '.cdpSocket = $socket' "$SESSION" >"$SESSION.tmp" && mv "$SESSION.tmp" "$SESSION"
	adb forward --no-rebind "tcp:$PORT" "localabstract:$socket" >/dev/null || die "Port $PORT is in use on this host."
	FORWARD_SOCKET=$socket
	trap unforward EXIT
}

unforward() {
	local socket=${FORWARD_SOCKET:-$(field cdpSocket)}
	[[ -n $socket ]] || return 0
	if [[ $'\n'$(timeout -k 5 15 env -u ANDROID_SERIAL "$ADB" forward --list 2>/dev/null)$'\n' == *$'\n'"$ANDROID_SERIAL tcp:$PORT localabstract:$socket"$'\n'* ]]; then
		adb forward --remove "tcp:$PORT" 2>/dev/null || true
	fi
}

cdp() {
	local code=0
	forward
	omd "$1" --port "$PORT" "${@:2}" || code=$?
	unforward
	return "$code"
}

vault_open() {
	local state
	state=$(cdp eval "$VAULT_STATE" --timeout 10 2>/dev/null) || return 1
	[[ $(jq -r .open <<<"$state") == "$VAULT" && $(jq -r .ready <<<"$state") == true &&
		$(jq -r .provisioning <<<"$state") == false ]]
}

enter_vault() {
	start_app
	adb shell appops set "$APP" MANAGE_EXTERNAL_STORAGE allow
	adb shell am force-stop "$APP"
	start_app
	cdp eval 'window.podnotesMobileProvisioning = true' >/dev/null
	cdp provision --plugin podnotes --repo "$ROOT" --vault "$VAULT" --data "$OUT/data.json" --open \
		>"$OUT/provision.json"
	wait_for 120 vault_open || die "Obsidian did not open the vault $VAULT within 120 s."
}

# --local reads the system's view: a plain dumpsys meminfo asks the process to
# dump itself, which is unsafe on this WebView version.

proc() {
	[[ $2 =~ ^[0-9]+$ ]] || {
		echo null
		return
	}
	local ticks
	adb shell dumpsys meminfo --local "$2" >"$1-meminfo-$2.txt" 2>&1 || true
	ticks=$(adb shell cat "/proc/$2/stat" 2>/dev/null | sed 's/.*) //' | cut -d' ' -f20) || true
	jq -n --argjson pid "$2" --arg ticks "$ticks" --arg pss "$(awk '
		$1 == "TOTAL" && $2 ~ /^[0-9]+$/ && pss == "" { pss = $2 }
		/TOTAL PSS:/ { pss = $3; exit }
		END { print pss }' "$1-meminfo-$2.txt")" '{pid: $pid, startTicks: $ticks, pssKiB: ($pss | tonumber? // null)}'
}

sample() {
	local ps
	ps=$(adb shell ps -A -o PID,NAME 2>&1) || true
	printf '%s\n' "$ps" >"$1-ps.txt"
	jq -n --argjson app "$(proc "$1" "$(awk -v app="$APP" '$2 == app { print $1 }' <<<"$ps")")" \
		--argjson renderer "$(proc "$1" "$(awk '$2 ~ /^com\.google\.android\.webview:sandboxed_process/ { print $1 }' <<<"$ps")")" \
		'{app: $app, renderer: $renderer}'
}

download() {
	local art before after code=0 responsive=false probe timeout=900 expression source
	art=$ROOT/.obsidian-e2e-artifacts/mobile/download-$(date -u +%Y%m%dT%H%M%SZ)
	mkdir -p "$art"
	before=$(sample "$art/before")
	source=$(cat "$ROOT/tests/mobile/podnotes-download.js")
	expression="(${source%;})(Date.now() + $((timeout - 60)) * 1000)"
	(cdp eval "$expression" --timeout "$timeout") >"$art/probe.json" \
		2>"$art/probe.log" || code=$?
	after=$(sample "$art/after")
	[[ $( (cdp eval 1+1 --timeout 10) 2>>"$art/probe.log") != 2 ]] || responsive=true
	adb logcat -d -v threadtime >"$art/logcat.txt" 2>&1 || true
	probe=$(jq -c . "$art/probe.json" 2>/dev/null) || true
	jq -n --argjson probe "${probe:-null}" --argjson before "$before" --argjson after "$after" \
		--argjson code "$code" --argjson responsive "$responsive" --arg artifacts "$art" '
		def same($a; $b): $a != null and $b != null and $a.pid == $b.pid
			and ($a.startTicks | test("^[0-9]+$")) and $a.startTicks == $b.startTicks;
		(same($before.app; $after.app) and same($before.renderer; $after.renderer)) as $survived
		| ([$before.app, $before.renderer, $after.app, $after.renderer] | all(.pssKiB != null)) as $sampled
		| ($probe.failures // ["the probe returned no report (omd exit \($code)), see probe.log"])
			+ (if $code == 0 and $probe.ok == true then [] else ["download probe failed"] end)
			+ (if $survived then [] else ["the Obsidian app or its WebView renderer did not survive"] end)
			+ (if $responsive then [] else ["Obsidian did not answer a CDP eval within 10 s afterwards"] end)
			+ (if $sampled then [] else ["a native PSS sample is missing, see the *-ps.txt files"] end)
		| {ok: (length == 0), failures: ., probe: $probe, nativeMemory: {before: $before, after: $after},
			processSurvived: $survived, responsive: $responsive, artifacts: $artifacts}' | tee "$art/report.json"
	[[ $(jq .ok "$art/report.json") == true ]] || exit 2
}


cmd=${1-}
(($#)) && shift
mkdir -p "$TMPDIR" "$OUT"
case $cmd in
_launch)
	(($# == 0)) || usage
	launch
	;;
setup)
	(($# == 0)) || usage
	claim
	boot
	start_app
	note "Obsidian runs on $ANDROID_SERIAL. Next: npm run mobile:verify. Finish with npm run mobile:stop."
	;;
verify)
	(($# == 0)) || usage
	claim
	(cd "$ROOT" && npm run build) >&2
	node "$ROOT/scripts/omd-seed.mjs" "$OUT/data.json"
	boot
	enter_vault
	code=0
	cdp eval --probe core_smoke >"$OUT/core-smoke.json" || code=$?
	((code == 0 || code == 2)) || die "Core probe infrastructure failed ($code)."
	cdp eval --probe "$ROOT/tests/mobile/podnotes-smoke.js" >"$OUT/podnotes-smoke.json" || code=$?
	((code == 0 || code == 2)) || die "PodNotes probe infrastructure failed ($code)."
	jq -n --arg vault "$VAULT" --slurpfile core "$OUT/core-smoke.json" \
		--slurpfile podnotes "$OUT/podnotes-smoke.json" --slurpfile provision "$OUT/provision.json" '
		([$core[0], $podnotes[0]] | all(.ok == true)) as $passed
		| {action: "verify", platform: "android", vault: $vault, provision: $provision[0],
			probes: {core: $core[0], podnotes: $podnotes[0]},
			assertions: {passed: $passed, failures: ([$core[0], $podnotes[0]] | map(.failures // []) | add)}}' \
		| tee "$OUT/verify.json"
	[[ $(jq .assertions.passed "$OUT/verify.json") == true ]] || exit 2
	;;
eval)
	expr='' probe='' timeout=120
	while (($#)); do
		case $1 in
		--probe | --timeout)
			(($# >= 2)) || usage
			if [[ $1 == --probe ]]; then probe=$2; else timeout=$2; fi
			shift 2
			;;
		-*) usage ;;
		*)
			[[ -z $expr ]] || usage
			expr=$1
			shift
			;;
		esac
	done
	[[ -n $expr$probe && (-z $expr || -z $probe) && $timeout =~ ^[0-9]+$ ]] || usage
	need_device
	if [[ -n $probe ]]; then
		cdp eval --probe "$probe" --timeout "$timeout"
	else
		cdp eval "$expr" --timeout "$timeout"
	fi
	;;
download)
	(($# == 0)) || usage
	need_device
	download
	;;
logs)
	[[ $# == 0 || ($# == 2 && $1 == --seconds && $2 =~ ^[1-9][0-9]{0,2}$) ]] || usage
	need_device
	code=0
	timeout -k 5 "${2:-20}" "$ADB" -s "$ANDROID_SERIAL" logcat -v threadtime >"$OUT/logcat.txt" || code=$?
	((code == 0 || code == 124)) || die "adb logcat failed ($code)."
	grep -iE 'obsidian|podnotes|webview|chromium|fatal|crash' "$OUT/logcat.txt" || true
	note "Full logcat: $OUT/logcat.txt"
	;;
screenshot)
	(($# == 1)) || usage
	need_device
	mkdir -p "$(dirname -- "$1")"
	adb exec-out screencap -p >"$1"
	[[ $(head -c 4 "$1" | tail -c 3) == PNG ]] || die "screencap did not write a PNG to $1."
	note "Saved $1"
	;;
stop)
	(($# == 0)) || usage
	claim
	if [[ -f $SESSION || -f $SETUP_SESSION ]]; then
		halt
		note "Stopped ($(unit_status)). The AVD and every vault are kept."
		systemctl --user reset-failed "$UNIT" 2>/dev/null || true
		rm -f "$SESSION"
	elif down && setup_down && [[ -z $(any_emulator) ]]; then
		note "No emulator session to stop."
	else
		die "An emulator this worktree does not own is running; it was left alone:" "$(any_emulator)"
	fi
	;;
*) usage ;;
esac
