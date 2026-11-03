# 开发、验证与上传

## 开发环境

按 README 准备 Python 虚拟环境和依赖。前端是原生 ES Modules，无打包步骤，不需要 npm install。Node.js 18+ 用于测试。

```sh
python -m unittest discover -s tests
node --test tests/*.test.mjs
```

默认测试使用虚构资料，不需要联网。3个可选真实职位表测试只在本机存在 `data/广东2027职位表.xls` 时执行，干净仓库会明确跳过。上海条款测试使用虚构组合文本验证提取与判断，不依赖真实全文随仓库分发。

新增专业策略时，应覆盖正向命中、错误排除、名称歧义、跨学历、跨年度、不同考试、规则冲突、备份恢复和原文证据。全国适配应另外用真实材料验收，但不要把下载文件或个人档案提交到仓库。

## 准备上传

根目录保留应用入口与配置；前端在 `web/`，测试在 `tests/`，虚构示例在 `examples/`，当前架构文档在 `docs/`。本机历史文档已归档到被忽略的 `docs/local-history/`，个人分析脚本在被忽略的 `scripts/local-history/`。

```sh
git status --short
git diff --cached --stat
python scripts/repository.py
```

检查工具扫描暂存区路径对应的**当前磁盘文件**，拒绝本机数据、常见二进制材料、个人电脑路径、符号链接及常见密钥模式。它不代替人工检查，也不会修改或删除数据。

生成只含待上传文件的源码包：

```sh
python scripts/repository.py --export outputs/release/gongkao-analyzer-source.zip
```

源码包不包含 `.git` 历史、真实资料、缓存依赖、测试输出和个人记录。导出的是当前文件内容，提交前若继续修改，需重新暂存、检查、导出。

## GitHub

当前仅准备本地仓库，不自动创建远程仓库或推送。确认暂存区和许可证选择后，可自行创建提交；在 GitHub 创建空仓库并选择可见性，然后使用 GitHub 给出的 remote 和 push 命令。不要提交真实资料包 JSON、CSV 导出、浏览器个人档案或账户凭证。

初始仓库未设置 LICENSE；若计划开放使用、修改及再分发，需要明确选择适合的许可证。
