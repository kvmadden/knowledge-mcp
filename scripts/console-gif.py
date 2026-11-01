"""Assemble the real console flow screenshots. Requires Pillow."""
from pathlib import Path
from PIL import Image

media = Path(__file__).resolve().parent.parent / 'docs/media'
frames = [Image.open(media / 'console-frames' / f'0{i}.png').convert('RGB') for i in range(6)]
frames[0].save(media / 'write-gate-flow.gif', save_all=True,
               append_images=frames[1:], duration=[1400, 1200, 1200, 2200, 2200, 2600], loop=0)
