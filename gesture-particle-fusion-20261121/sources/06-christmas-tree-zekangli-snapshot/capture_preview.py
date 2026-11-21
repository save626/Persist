"""无窗口渲染一帧并保存为 preview.png，用于部署自检。

用法：
    .venv/Scripts/python.exe capture_preview.py
"""
import os
import sys

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pygame  # noqa: E402
import tree  # noqa: E402


def main():
    pygame.init()
    screen = pygame.display.set_mode((tree.WIDTH, tree.HEIGHT))
    pygame.display.set_caption("Merry Christmas")

    font = tree.load_title_font(45)
    tree_pts = tree.gen_tree_points()
    ground = tree.gen_ground_points()
    stars = tree.gen_star_points()
    heart = tree.gen_heart_points()
    snow2d = tree.init_snow2d()
    snow_surface = pygame.Surface((tree.WIDTH, tree.HEIGHT), pygame.SRCALPHA)

    screen.fill(tree.BLACK)
    draw_list = []
    for x, y, z, color in tree_pts + ground + stars + heart:
        proj = tree.project_point(x, y, z, 0.0)
        if proj:
            sx, sy, depth = proj
            size = max(1, int(3.6 - depth * 0.13))
            draw_list.append((depth, sx, sy, size, color))
    draw_list.sort(key=lambda v: v[0], reverse=True)
    for _, sx, sy, size, color in draw_list:
        if 0 <= sx < tree.WIDTH and 0 <= sy < tree.HEIGHT:
            pygame.draw.circle(screen, color, (sx, sy), size)

    text1 = font.render("Merry Christmas", True, (255, 255, 255))
    screen.blit(text1, (40, tree.HEIGHT // 3))
    text2 = font.render(tree.SUBTITLE_TEXT, True, (255, 255, 255))
    screen.blit(text2, (40, tree.HEIGHT // 3 + text1.get_height() + 10))

    tree.draw_snow2d(snow_surface, snow2d)
    screen.blit(snow_surface, (0, 0))
    pygame.display.flip()

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview.png")
    pygame.image.save(screen, out)
    print("saved:", out, "points:", len(tree_pts) + len(ground) + len(stars) + len(heart))
    pygame.quit()


if __name__ == "__main__":
    main()
