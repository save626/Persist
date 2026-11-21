# 部署补丁记录

上游仓库在当前机器上**无法直接启动**。这里记录为了“能跑起来”所做的最小改动，
上游原文件完整保留在 `tree.py.upstream`。

## 补丁 1：系统字体接口兜底（必要修复）

**问题**：本机 `pygame.font.get_fonts()` / `pygame.font.SysFont()` 在 Windows 上
对**所有**字体名都抛异常：

```
TypeError: expected str, bytes or os.PathLike object, not int
  at pygame/sysfont.py:82  initsysfonts_win32()
```

这是 pygame 2.6.1 + 本机 Windows 字体注册表的兼容问题，与仓库代码无关；
上游第 271 行直接调用 `pygame.font.SysFont("Monotype Corsiva", 45, bold=False)`，
因此程序在 `main()` 刚进入就崩溃。

**改动**：新增 `load_title_font(size)`，先尝试 `SysFont`，失败时退回 pygame 内置字体
`pygame.font.Font(None, size)`（该路径在本机验证可用）。

```python
def load_title_font(size):
    try:
        return pygame.font.SysFont("Monotype Corsiva", size, bold=False)
    except Exception:
        return pygame.font.Font(None, size)
```

**影响**：仅标题字体来源变化（内置字体 vs Monotype Corsiva），
不影响粒子数量、树形算法、投影与配色逻辑。

## 补丁 2：副标题可配置（非必要）

上游把 `"647"` 写死在渲染语句里（上游 README 自己也提示“那是我个人用的名字，请改成你自己的”）。
改为常量 + 环境变量覆盖，默认值仍是 `647`，保持上游行为：

```python
SUBTITLE_TEXT = os.environ.get("CHRISTMAS_SUBTITLE", "647")
```

用法：`set CHRISTMAS_SUBTITLE=你的名字 && run.cmd`

## 未改动的部分

- 粒子数量（树 50000 / 地面 4000 / 星空 1200 / 爱心 1000 / 前景雪花 10）
- 树形生成算法、螺旋灯带、树枝层次波
- 相机参数、投影函数、深度排序绘制
- 窗口尺寸 1600×900、60 FPS 限帧、配色

## 已知遗留问题

- 上游退出方式只有点窗口关闭按钮，**没有 ESC 键退出**。
- 无音效、无窗口自适应缩放（固定 1600×900）。
- 上游仓库未声明许可证，商用需先确认作者授权。
