#!/bin/zsh
cd "${0:A:h}"
runtime="$PWD/.venv/bin/python"
if [[ ! -x "$runtime" ]]; then
  runtime="$(command -v python3)"
fi
if [[ -z "$runtime" ]]; then
  echo '未找到 Python 3，请先安装 Python 3。'
  read -r
  exit 1
fi
"$runtime" server.py --open
if [[ $? -ne 0 ]]; then
  echo '启动失败。如端口被占用，可在终端运行：python3 server.py --port 8766 --open'
  read -r
fi
