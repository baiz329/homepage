#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

PORT=${PORT:-8080}
WS_PATH=${WS_PATH:-/assets/v2/config}
XRAY_PORT=10000
XRAY_VERSION="v26.11.9"
XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip"

export PORT WS_PATH

if [ -z "$UUID" ]; then
  echo "error: environment variable UUID is not set" >&2
  exit 1
fi

# 下载 Xray：最多重试 3 次，每次间隔 10 秒。
mkdir -p bin
for i in 1 2 3; do
  if curl -fSL "$XRAY_URL" -o /tmp/xray.zip; then
    break
  fi
  if [ "$i" -eq 3 ]; then
    echo "error: failed to download Xray from $XRAY_URL" >&2
    exit 1
  fi
  echo "download attempt $i failed, retrying in 10s..." >&2
  sleep 10
done

# 解压到 bin/：优先用 unzip，不可用则用 python3 解压。
if command -v unzip >/dev/null 2>&1; then
  unzip -o /tmp/xray.zip -d bin/
else
  python3 -c "import zipfile; zipfile.ZipFile('/tmp/xray.zip').extractall('bin')"
fi
rm -f /tmp/xray.zip
chmod +x bin/xray

# 验证二进制能跑。
./bin/xray version

# 用环境变量生成 config.json。
cat > config.json <<JSONEOF
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": $XRAY_PORT,
      "listen": "127.0.0.1",
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "$UUID",
            "level": 0
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "security": "none",
        "wsSettings": {
          "path": "$WS_PATH"
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls"]
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    }
  ]
}
JSONEOF

# 同时启动静态站点服务和 Xray，任意一个退出就杀掉另一个并以非零退出。
node server.js &
NODE_PID=$!
./bin/xray run -c config.json &
XRAY_PID=$!

STATUS=0
wait -n $NODE_PID $XRAY_PID || STATUS=$?
kill $NODE_PID $XRAY_PID 2>/dev/null || true
wait $NODE_PID $XRAY_PID 2>/dev/null || true
if [ "$STATUS" -eq 0 ]; then STATUS=1; fi
exit $STATUS
