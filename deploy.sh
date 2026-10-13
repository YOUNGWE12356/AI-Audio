#!/usr/bin/env bash
# Linux deployment; use Docker when the host Node runtime does not work.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"
SERVICE=ai-audio
PORT=4030

die() { printf '部署中止：%s\n' "$*" >&2; exit 1; }
trap 'printf "部署失败（第 %s 行），请检查上方输出。\n" "$LINENO" >&2' ERR

[[ "$(uname -s)" == Linux ]] || die '此脚本用于 Linux 服务器。'
case "${DEPLOY_MODE:-auto}" in
  docker) exec bash "$ROOT/docker-deploy.sh" ;;
  auto)
    if [[ -f .deploy/backend && "$(cat .deploy/backend)" == docker ]]; then
      exec bash "$ROOT/docker-deploy.sh"
    fi
    if ! command -v node >/dev/null ||
       ! node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' >/dev/null 2>&1; then
      printf '宿主机 Node 缺失、版本不足或系统库不兼容，使用 Docker 部署。\n'
      exec bash "$ROOT/docker-deploy.sh"
    fi
    ;;
  systemd) ;;
  *) die 'DEPLOY_MODE 应为 auto、docker 或 systemd。' ;;
esac
for command in git node npm curl systemctl flock; do
  command -v "$command" >/dev/null || die "请先安装 $command"
done
[[ -d /run/systemd/system ]] || die '请在使用 systemd 的服务器上执行。'
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || die 'Node 启动失败或低于 v20；运行 DEPLOY_MODE=docker bash deploy.sh。'

# Only systemd management needs elevated privileges; npm runs as this user.
ADMIN=()
if (( EUID != 0 )); then
  command -v sudo >/dev/null || die '需要 sudo 来配置 systemd。'
  sudo -v
  ADMIN=(sudo)
fi

mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -n 9 || die '另一个部署任务正在运行。'

if [[ "${SKIP_PULL:-0}" != 1 ]]; then
  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] || die '工作区存在未提交修改，请先处理，或设置 SKIP_PULL=1。'
  printf '拉取当前分支代码…\n'
  git pull --ff-only
fi

if [[ ! -f .env ]]; then
  (umask 077; cp .env.example .env)
  die '已创建 .env，请填写 API 密钥及登录配置后再次执行 bash deploy.sh。'
fi

# Detect an old nohup instance before touching dependencies.
if ! systemctl is-active --quiet "$SERVICE"; then
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.once("error", error => { console.error(error.message); process.exit(1); });
    server.listen(4030, "0.0.0.0", () => server.close());
  ' || die '4030 端口已被占用，请先停止旧服务。'
fi

printf '安装依赖并构建…\n'
npm ci --include=dev
npm run check

# Quote systemd values; %% escapes its specifier syntax. Do not source .env.
unit_quote() {
  local value="$1"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die '路径包含换行符。'
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

NODE_BIN="$(command -v node)"
DEPLOY_USER="$(id -un)"
UNIT="$(mktemp)"
trap 'rm -f -- "$UNIT"' EXIT
cat > "$UNIT" <<EOF
[Unit]
Description=AI Audio Suite
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$(unit_quote "$ROOT")
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=$(unit_quote "PATH=$PATH")
ExecStart=$(unit_quote "$NODE_BIN") $(unit_quote "$ROOT/dist/server.cjs")
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0027
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

printf '安装并启动 systemd 服务（端口 %s）…\n' "$PORT"
"${ADMIN[@]}" install -m 644 "$UNIT" "/etc/systemd/system/$SERVICE.service"
"${ADMIN[@]}" systemctl daemon-reload
"${ADMIN[@]}" systemctl enable "$SERVICE"
"${ADMIN[@]}" systemctl reset-failed "$SERVICE"
"${ADMIN[@]}" systemctl restart "$SERVICE"

# A running process alone is insufficient; verify that it serves the SPA.
for (( attempt=1; attempt<=30; attempt++ )); do
  if systemctl is-active --quiet "$SERVICE" &&
     curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/" >/dev/null; then
    printf 'systemd\n' > .deploy/backend
    printf '部署完成：端口 %s，服务 %s（自动重启、开机启动）。\n' "$PORT" "$SERVICE"
    printf '查看日志：sudo journalctl -u %s -f\n' "$SERVICE"
    exit 0
  fi
  sleep 1
done

"${ADMIN[@]}" journalctl -u "$SERVICE" -n 50 --no-pager || true
die '启动检查超时，请检查日志及 4030 端口占用情况。'
