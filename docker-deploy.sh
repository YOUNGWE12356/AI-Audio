#!/usr/bin/env bash
# No host Node/npm required. Docker must already be installed and running.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"
APP=ai-audio
PORT=4030
die() { printf '部署中止：%s\n' "$*" >&2; exit 1; }
trap 'printf "Docker 部署失败（第 %s 行）。\n" "$LINENO" >&2' ERR
[[ "$(uname -s)" == Linux ]] || die '此脚本用于 Linux 服务器。'
for cmd in git docker flock; do
  command -v "$cmd" >/dev/null || die "请先安装 $cmd；Docker 需由服务器管理员配置。"
done
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  command -v sudo >/dev/null || die '请启动 Docker 并检查当前账号的 Docker 访问权限。'
  sudo -v
  DOCKER=(sudo docker)
  "${DOCKER[@]}" info >/dev/null || die '请先启动 Docker 服务。'
fi
mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -n 9 || die '另一个部署任务正在运行。'
if [[ "${SKIP_PULL:-0}" != 1 ]]; then
  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] || die '工作区存在未提交修改，请先处理，或设置 SKIP_PULL=1。'
  git pull --ff-only
fi
if [[ ! -f .env ]]; then
  (umask 077; cp .env.example .env)
  die '已创建 .env，请填写配置后再次运行 bash deploy.sh。'
fi

# Never replace a same-named container belonging to another application.
OLD_ID="$("${DOCKER[@]}" ps -aq --filter "name=^/${APP}$")"
if [[ -n "$OLD_ID" ]]; then
  [[ "$("${DOCKER[@]}" inspect --format '{{index .Config.Labels "ai-audio.project"}}' "$APP")" == "$ROOT" ]] || die '同名容器不属于当前项目，请先确认其用途。'
fi
mkdir -p data uploads
IMAGE="$APP:$(date +%Y%m%d%H%M%S)-$$"
printf '在容器内安装依赖并构建（宿主机不执行 Node）…\n'
"${DOCKER[@]}" build \
  --build-arg "NODE_IMAGE=${NODE_IMAGE:-node:22-alpine3.23}" \
  --build-arg "APK_MIRROR=${APK_MIRROR:-https://mirrors.aliyun.com/alpine}" \
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}" \
  -t "$IMAGE" .

# Build must finish before stopping the previous service.
SYSTEMD_STOPPED=0
if command -v systemctl >/dev/null && systemctl is-active --quiet "$APP"; then
  ADMIN=()
  if (( EUID != 0 )); then ADMIN=(sudo); fi
  "${ADMIN[@]}" systemctl disable --now "$APP"
  SYSTEMD_STOPPED=1
  printf '已停止旧 systemd 服务，切换至容器。\n'
fi
BACKUP="$APP-previous-$$"
OLD_RUNNING=false
if [[ -n "$OLD_ID" ]]; then
  OLD_RUNNING="$("${DOCKER[@]}" inspect --format '{{.State.Running}}' "$APP")"
  "${DOCKER[@]}" stop "$APP"
  "${DOCKER[@]}" rename "$APP" "$BACKUP"
fi
rollback() {
  printf '\n失败容器状态（回滚前）：\n' >&2
  "${DOCKER[@]}" inspect --format 'status={{.State.Status}} exitCode={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} restarts={{.RestartCount}} error={{json .State.Error}}' "$APP" >&2 || true
  printf '\n健康检查记录：\n' >&2
  "${DOCKER[@]}" inspect --format '{{if .State.Health}}{{json .State.Health}}{{else}}无健康检查记录{{end}}' "$APP" >&2 || true
  printf '\n服务日志（最近 120 行）：\n' >&2
  "${DOCKER[@]}" logs --timestamps --tail 120 "$APP" >&2 || true
  printf '\n开始回滚…\n' >&2
  "${DOCKER[@]}" rm -f "$APP" >/dev/null 2>&1 || true
  if [[ -n "$OLD_ID" ]]; then
    "${DOCKER[@]}" rename "$BACKUP" "$APP"
    if [[ "$OLD_RUNNING" == true ]]; then "${DOCKER[@]}" start "$APP"; fi
  fi
  if [[ "$SYSTEMD_STOPPED" == 1 ]]; then
    "${ADMIN[@]}" systemctl enable --now "$APP"
  fi
}

# Read .env via dotenv inside the container: no shell evaluation, no secrets in image.
# Run with the checkout owner's UID/GID so bind-mounted files remain writable.
if ! "${DOCKER[@]}" run -d --name "$APP" \
  --label "ai-audio.project=$ROOT" \
  --user "$(id -u):$(id -g)" \
  --restart unless-stopped --stop-timeout 30 \
  -p "$PORT:$PORT" \
  -e NODE_ENV=production -e PORT="$PORT" \
  -e FFMPEG_PATH=/usr/bin/ffmpeg -e FFMPEG_BIN=/usr/bin/ffmpeg \
  -e HOME=/tmp \
  -v "$ROOT/.env:/app/.env:ro,Z" \
  -v "$ROOT/data:/app/data:Z" \
  -v "$ROOT/uploads:/app/uploads:Z" \
  "$IMAGE"; then
  rollback
  die '容器启动失败，请检查端口占用和 Docker 输出。'
fi
for (( attempt=1; attempt<=60; attempt++ )); do
  HEALTH="$("${DOCKER[@]}" inspect --format '{{.State.Health.Status}}' "$APP")"
  if [[ "$HEALTH" == healthy ]]; then
    if [[ -n "$OLD_ID" ]]; then "${DOCKER[@]}" rm "$BACKUP" >/dev/null; fi
    printf 'docker\n' > .deploy/backend
    printf '部署完成：端口 %s（Docker），数据保留在项目 data/ 和 uploads/。\n' "$PORT"
    printf '查看日志：%s logs -f %s\n' "${DOCKER[*]}" "$APP"
    exit 0
  fi
  [[ "$HEALTH" != unhealthy ]] || break
  sleep 2
done
rollback
die '容器健康检查失败，已尝试恢复旧容器。'
