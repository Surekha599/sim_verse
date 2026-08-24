#!/usr/bin/env python3
"""
Produce a single self-contained `standalone/simverse.html`
(open it straight from disk, email it, host it anywhere).
Also prints a gzip size estimate.
"""
import gzip
import os
import re

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


html = read("index.html")
css = read("css", "styles.css")
data = read("data", "data.js")
quotes = read("js", "quotes.js")
app = read("js", "app.js")

# inline everything
html = re.sub(r"<link rel=\"stylesheet\" href=\"css/styles\.css\">",
              "<style>\n" + css + "\n</style>", html, count=1)
html = html.replace('<script src="data/data.js"></script>',
                    '<script>\n' + data + '\n</script>')
html = html.replace('<script src="js/quotes.js"></script>',
                    '<script>\n' + quotes + '\n</script>')
html = html.replace('<script src="js/app.js"></script>',
                    '<script>\n' + app + '\n</script>')

out_dir = os.path.join(ROOT, "standalone")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "simverse.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)

size = os.path.getsize(out)
gz = len(gzip.compress(html.encode("utf-8"), 9))
print(f"wrote {out}")
print(f"raw {size/1024:.0f} KB  ·  gzip {gz/1024:.0f} KB")
