"""Assemble screenshots of the actual transcript replay. Requires Pillow."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageColor

root = Path(__file__).resolve().parent.parent
media = root / 'docs/media'
evidence = Path(sys.argv[1])
originals = [Image.open(evidence / f'1440-step-{i}.png').convert('RGB') for i in range(4)]
height = max(im.height for im in originals)
background = json.loads((media / 'theme.json').read_text())['tokens']['bg']
frames = []
for original in originals:
    canvas = Image.new('RGB', (1440, height), ImageColor.getrgb(background))
    canvas.paste(original, (0, 0))
    frames.append(canvas)
frames[0].save(media / 'safety-demo.gif', save_all=True, append_images=frames[1:],
               duration=[2600, 2600, 3200, 3200], loop=0)
originals[0].save(media / 'safety-demo.png')
