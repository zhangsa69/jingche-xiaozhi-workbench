#!/usr/bin/env bash
# Installs the control plane for a single Linux account — no sudo, no shared
# directories, no changes to nginx or to any other unit. Everything lives under
# $HOME/pi-control-plane and runs as a systemd *user* service on its own port,
# so a host that already runs other projects is left untouched.
#
#   ./install.sh                 # build from ./src (if needed) and (re)start
#   ./install.sh --port 18888    # pick another free port
#   ./install.sh --bind 0.0.0.0  # expose on the LAN (default: loopback only)
#   ./install.sh --uninstall     # stop and remove the service, keep the data
#
# The bundle layout expected next to this script:
#   control-plane        prebuilt binary (optional, skips the build)
#   src/                 crate sources (used when no binary is present)
#   web/                 prebuilt admin console (optional)
#
set -euo pipefail

APP_NAME="pi-control-plane"
APP_HOME="${APP_HOME:-$HOME/pi-control-plane}"
PORT="${PORT:-18787}"
BIND="${BIND:-127.0.0.1}"
PUBLIC_URL="${PUBLIC_URL:-}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/$APP_NAME.service"
ENV_FILE="$APP_HOME/control-plane.env"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The script ships either at the bundle root or in deploy/; accept both.
BUNDLE_ROOT="$HERE"
if [ ! -d "$HERE/src" ] && [ -d "$HERE/../src" ]; then
  BUNDLE_ROOT="$(cd "$HERE/.." && pwd)"
fi

log() { printf '%s\n' "$*"; }
fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:?--port 需要一个端口}"; shift 2 ;;
    --bind) BIND="${2:?--bind 需要一个地址}"; shift 2 ;;
    --public-url) PUBLIC_URL="${2:?--public-url 需要一个地址}"; shift 2 ;;
    --home) APP_HOME="${2:?--home 需要一个目录}"; ENV_FILE="$APP_HOME/control-plane.env"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) fail "未知参数: $1" ;;
  esac
done

if [ "$UNINSTALL" = "1" ]; then
  systemctl --user disable --now "$APP_NAME.service" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl --user daemon-reload 2>/dev/null || true
  log "已停止并移除 systemd 单元，数据保留在 $APP_HOME"
  exit 0
fi

# --- preflight ---------------------------------------------------------------
command -v systemctl >/dev/null 2>&1 || fail "没有 systemd，无法安装为服务"

# A non-interactive SSH session has no session bus by default, which makes
# `systemctl --user` fail with "Failed to connect to bus".
if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "/run/user/$(id -u)/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
fi
if ! systemctl --user show-environment >/dev/null 2>&1; then
  fail "当前会话无法使用 systemd --user。请在服务器上以交互 shell 运行，或让管理员执行 loginctl enable-linger $USER 后重试"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) fail "不支持的架构: $ARCH" ;;
esac

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"
  else
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"
  fi
}

if port_busy "$PORT"; then
  # Refuse instead of stealing a port from whatever is already running.
  log "端口 $PORT 已被占用。请改用 --port 指定空闲端口，当前占用情况："
  if command -v ss >/dev/null 2>&1; then ss -lntp 2>/dev/null | head -20; fi
  exit 1
fi

log "目标目录: $APP_HOME"
log "监听地址: $BIND:$PORT"
mkdir -p "$APP_HOME/bin" "$APP_HOME/data"

# --- binary ------------------------------------------------------------------
BIN="$APP_HOME/bin/control-plane"
PREBUILT="$BUNDLE_ROOT/control-plane"
if [ -f "$PREBUILT" ]; then
  install -m 0755 "$PREBUILT" "$BIN.new"
elif [ -d "$BUNDLE_ROOT/src" ]; then
  command -v cargo >/dev/null 2>&1 || fail "缺少 Rust 工具链：请安装 rustup（curl https://sh.rustup.rs -sSf | sh）后重试，或把预编译的 control-plane 放到 $BUNDLE_ROOT"
  # rusqlite 的 bundled 特性需要 C 编译器。
  command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || fail "缺少 C 编译器（gcc/cc），无法编译 SQLite"
  log "正在编译（限制并行度以适配低配机器）…"
  # shellcheck disable=SC2046
  ( cd "$BUNDLE_ROOT" && CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" cargo build --release )
  install -m 0755 "$BUNDLE_ROOT/target/release/control-plane" "$BIN.new"
else
  fail "找不到可执行文件，也没有 src 目录"
fi

if [ -f "$BIN" ]; then
  cp -p "$BIN" "$BIN.bak-$(date +%Y%m%d%H%M%S)"
fi
mv -f "$BIN.new" "$BIN"

if [ -d "$BUNDLE_ROOT/web" ]; then
  mkdir -p "$APP_HOME/web"
  cp -R "$BUNDLE_ROOT/web/." "$APP_HOME/web/"
fi

# --- environment -------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  SECRET="$( (command -v openssl >/dev/null 2>&1 && openssl rand -hex 32) || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | cut -c1-48 )"
  if [ -z "$PUBLIC_URL" ]; then
    if [ "$BIND" = "127.0.0.1" ] || [ "$BIND" = "localhost" ]; then
      PUBLIC_URL="http://127.0.0.1:$PORT"
    else
      # Employees reach the service by its LAN address, not by 0.0.0.0.
      LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
      PUBLIC_URL="http://${LAN_IP:-$BIND}:$PORT"
    fi
  fi
  cat > "$ENV_FILE" <<EOF
# $APP_NAME environment. Mode 0600. Never commit this file.
CONTROL_PLANE_SECRET=$SECRET
CONTROL_PLANE_PUBLIC_URL=$PUBLIC_URL
CONTROL_PLANE_ADDR=$BIND:$PORT
CONTROL_PLANE_DATA_DIR=$APP_HOME/data
CONTROL_PLANE_WEB_DIR=$APP_HOME/web
CONTROL_PLANE_TRUST_PROXY=false
CONTROL_PLANE_REGISTRATION_OPEN=true
CONTROL_PLANE_ADMIN_EMAILS=
CONTROL_PLANE_LOG=info,tower_http=warn

# 163 邮箱。填好 USERNAME / PASSWORD / FROM_EMAIL 后再取消下面 HOST 的注释：
# 只填 HOST 而账号为空会让服务启动失败（配置不完整），全部留空则验证码打印到日志。
#CONTROL_PLANE_SMTP_HOST=smtp.163.com
#CONTROL_PLANE_SMTP_PORT=465
#CONTROL_PLANE_SMTP_TLS=implicit
CONTROL_PLANE_SMTP_USERNAME=
CONTROL_PLANE_SMTP_PASSWORD=
CONTROL_PLANE_SMTP_FROM_EMAIL=
CONTROL_PLANE_SMTP_FROM_NAME=京车小智工作台
EOF
  chmod 600 "$ENV_FILE"
  log "已生成配置文件: $ENV_FILE（请补全 ADMIN_EMAILS 与 SMTP 账号）"
else
  chmod 600 "$ENV_FILE"
  log "沿用已有配置文件: $ENV_FILE"
fi

if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="$(grep -E '^CONTROL_PLANE_PUBLIC_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
fi
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="http://$BIND:$PORT"

# --- unit --------------------------------------------------------------------
mkdir -p "$UNIT_DIR"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Jingche Xiaozhi control plane ($APP_NAME)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_HOME
EnvironmentFile=$ENV_FILE
ExecStart=$APP_HOME/bin/control-plane
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
LimitNOFILE=8192

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$APP_NAME.service"
# Keep the service alive after logout; harmless when already enabled.
loginctl enable-linger "$USER" 2>/dev/null || log "提示: 无法自动开启 linger，注销后服务可能停止（需要管理员执行 loginctl enable-linger $USER）"

# --- health ------------------------------------------------------------------
HEALTH="http://127.0.0.1:$PORT/healthz"
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "$HEALTH" >/dev/null 2>&1; then
    log "服务已就绪: $HEALTH"
    log "管理台地址: $PUBLIC_URL/"
    log "自检邮件:   $APP_HOME/bin/control-plane --check-mail 你的邮箱@163.com"
    log "查看日志:   journalctl --user -u $APP_NAME -f"
    exit 0
  fi
  sleep 1
done

log "服务未在 40 秒内通过健康检查，最近日志："
journalctl --user -u "$APP_NAME" -n 40 --no-pager 2>/dev/null || true
exit 1
