# 来源

- 仓库：https://github.com/ZekangLi-Zico/Christmas-Tree
- 默认分支：main
- 快照提交：49bbaa73e6c89b2a22e73d9fc33ee6b20eaef829（2025-12-09）
- 许可：仓库未声明
- 取回方式：GitHub 官方 codeload 源码快照（`https://codeload.github.com/ZekangLi-Zico/Christmas-Tree/zip/refs/heads/main`）
- 为什么不走 `git clone`：本机到 github.com 的 git 智能 HTTP 通道反复返回
  `CONNECT tunnel failed, response 502` / `Empty reply from server`，
  换成 codeload 通道则稳定可达。快照已用 `unzip -t` 校验完整性。
- 取回时间：2026-11-21
- 一致性核验：快照中的 `README.md`、`tree.py` 与早前经 REST API 取回的副本**逐字节一致**
  （`tree.py` sha256 = `a7da1afad1228f81fc7a7e2747afc6c5dc4c9a9b64243b271b5a7b5e9ea70308`）

## 上游原始文件

- `tree.py.upstream`：上游未经改动的 `tree.py`（sha256 与上方一致）
- `tree.py`：部署版，仅含下方 PATCHES.md 所述的最小补丁
