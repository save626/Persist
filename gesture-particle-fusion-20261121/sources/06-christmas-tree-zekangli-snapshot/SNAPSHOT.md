# 这是什么

`ZekangLi-Zico/Christmas-Tree` 的**部署文件快照**（不含 git 元数据与 Python 虚拟环境）。

活的部署目录在 `../06-christmas-tree-zekangli/`：那是一个 `git clone`，里面带有 `.git`
（会让 git 把整个目录当成子模块指针，克隆外层仓库时拿不到文件内容）和一个 36 MB 的
`.venv`，所以**整个目录被 `.gitignore` 排除**；入库的是这份文件快照。

## 内容

| 文件 | 说明 |
| --- | --- |
| `tree.py` | 打过补丁的原程序（补丁见 `PATCHES.md`） |
| `tree.py.upstream` | 上游原始文件，逐字节保留，供 diff |
| `PATCHES.md` | 两处补丁记录：字体兜底、副标题环境变量 |
| `run.cmd` | 启动入口（使用旁边活目录里的 `.venv`，或系统 Python） |
| `capture_preview.py` | 无头截图脚本 |
| `preview.png` | 参考渲染图（1600×900），Web 端移植的视觉基准 |
| `requirements.txt` | `pygame>=2.5` |
| `SOURCE.md` | 来源、分支、许可、取回方式与时间 |

## 怎么跑

```powershell
# 在活的部署目录里（有 .venv）
cd ../06-christmas-tree-zekangli
.\run.cmd

# 或者从这份快照跑（需要自己装依赖）
python -m pip install -r requirements.txt
python tree.py
```

## 与 Web 端的关系

Web 版的「圣诞树」场景（`src/scenes/lights-tree.js`）把 `tree.py` 的点生成算法与配色
逐行移植到了 WebGL —— 螺旋灯带、树枝层次波、蓬松填充、地面光环、空中星点、树顶爱心。
两边不是同一份渲染代码，只是同一套算法。
