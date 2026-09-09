#!/usr/bin/env python3
"""
Regenerate the catalog and video grids from data/, in place.

Both grids are written as STATIC HTML rather than fetched at runtime.
The catalog is the main thing this site has to say about V12, so it has
to be in the page a crawler downloads and it has to survive JavaScript
being slow, blocked or broken. The trade is that adding a release means
re-running this script; that is a fair trade for a page that is right
when nothing else is working.

Nothing here invents a link. Every URL in data/catalog.json was resolved
against the platform's own API and matched on artist id (Deezer 171811,
Tidal 3701169, Apple 1524294911), so a release only shows a Deezer chip
if Deezer actually has it under V12. Missing chip = not verified, not
"probably there".

  python3 tools/build_pages.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# name -> (label, css class). Order is the order chips appear on a tile.
PLATFORMS = [
    ("spotify", "Spotify"),
    ("apple", "Apple"),
    ("soundcloud", "SoundCloud"),
    ("tidal", "TIDAL"),
    ("deezer", "Deezer"),
]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def release_tile(r, eager=False):
    chips = "".join(
        f'<a class="chip" href="{esc(r[key])}" target="_blank" rel="noopener">{label}</a>'
        for key, label in PLATFORMS if r.get(key)
    )
    # Every release has an Apple link, so primary is never dead.
    primary = r.get("spotify") or r.get("apple")
    loading = "eager" if eager else "lazy"
    return (
        f'<article class="rel">'
        f'<a class="relart" href="{esc(primary)}" target="_blank" rel="noopener" '
        f'aria-label="Listen to {esc(r["name"])}">'
        f'<img src="{esc(r["cover"])}" alt="{esc(r["name"])} cover art" '
        f'width="600" height="600" loading="{loading}" decoding="async">'
        f'<span class="relplay" aria-hidden="true">▶</span></a>'
        f'<div class="relmeta"><b>{esc(r["name"])}</b>'
        f'<span>{esc(r["kind"])} · {esc(r["year"])}'
        + (f' · {esc(r["artist"])}' if r["artist"] != "V12" else "")
        + f'</span></div>'
        f'<div class="chips">{chips}</div>'
        f'</article>'
    )


def video_tile(v, eager=False):
    url = f"https://www.youtube.com/watch?v={v['id']}"
    thumb = f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg"
    loading = "eager" if eager else "lazy"
    return (
        f'<a class="vthumb" href="{esc(url)}" target="_blank" rel="noopener">'
        f'<img src="{esc(thumb)}" alt="{esc(v["title"])}" width="480" height="360" '
        f'loading="{loading}" decoding="async">'
        f'<span class="pl" aria-hidden="true">▶</span>'
        f'<span class="cap">{esc(v["title"])}</span></a>'
    )


def splice(path, marker, html):
    """Replace what sits between <!-- BUILD:x --> and <!-- /BUILD:x -->."""
    p = ROOT / path
    src = p.read_text(encoding="utf-8")
    pat = re.compile(
        r"(<!-- BUILD:%s -->).*?(<!-- /BUILD:%s -->)" % (marker, marker),
        re.S,
    )
    if not pat.search(src):
        sys.exit(f"marker BUILD:{marker} not found in {path}")
    out = pat.sub(lambda m: m.group(1) + "\n" + html + "\n" + m.group(2), src)
    if out != src:
        p.write_text(out, encoding="utf-8")
    return out != src


def main():
    catalog = json.loads((ROOT / "data/catalog.json").read_text(encoding="utf-8"))
    videos = json.loads((ROOT / "data/videos.json").read_text(encoding="utf-8"))

    catalog.sort(key=lambda r: r["date"], reverse=True)
    tiles = "\n".join(release_tile(r, i < 8) for i, r in enumerate(catalog))
    splice("music.html", "catalog", f'<div class="relgrid">\n{tiles}\n</div>')

    music = [v for v in videos if v["kind"] == "video"]
    streams = [v for v in videos if v["kind"] == "stream"]
    splice("videos.html", "videos",
           '<div class="vgrid">\n%s\n</div>'
           % "\n".join(video_tile(v, i < 8) for i, v in enumerate(music)))
    splice("videos.html", "streams",
           '<div class="vgrid">\n%s\n</div>'
           % "\n".join(video_tile(v) for v in streams))

    print(f"catalog: {len(catalog)} releases | videos: {len(music)} | streams: {len(streams)}")


if __name__ == "__main__":
    main()
