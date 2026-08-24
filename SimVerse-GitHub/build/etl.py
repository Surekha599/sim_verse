#!/usr/bin/env python3
"""
SimVerse ETL -- converts the four source Google Sheets (downloaded as .xlsx)
into a single normalised data structure used by the web app.

Handles the real-world messiness found in the source sheets:
  * different platform column sets on every tab
  * Chemistry Gr.11/12 : Chapter | (Activity code, unlabelled) | Topic
  * Chemistry Gr.10    : Chapter | Activity | Topic
  * Physics Gr.9/10    : tab names are "Grade 9th (topicwise)"
  * Biology Gr.9       : "Chapter" header missing but chapter data present
  * forward-filled (merged) chapter cells
  * 66 cells whose URL only exists as a hidden cell hyperlink
  * 6 cells that are notes only ("app based only", "only for ipad", ...)
  * URLs written without a scheme, with trailing junk, or repeated

Usage:  python3 etl.py
Writes: ../data/data.js   (window.SIMVERSE_DATA = {...})
"""
import json
import os
import re
import unicodedata
from collections import OrderedDict

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "data", "data.js"))

# ---------------------------------------------------------------- platforms
# canonical name -> (display name, css class, home url, blurb)
PLATFORMS = OrderedDict([
    ("phet",            ("PhET", "phet", "https://phet.colorado.edu", "University of Colorado Boulder")),
    ("olabs",           ("OLabs", "olabs", "https://www.olabs.edu.in", "Amrita / CDAC virtual lab")),
    ("diksha",          ("DIKSHA", "diksha", "https://diksha.gov.in", "Govt. of India e-content")),
    ("javalab",         ("JavLab", "javalab", "https://javalab.org", "Korean interactive science lab")),
    ("ck12",            ("CK-12", "ck12", "https://www.ck12.org", "Flexbook interactives & PLIX")),
    ("labxchange",      ("LabXchange", "labxchange", "https://www.labxchange.org", "Harvard digital lab")),
    ("concord",         ("Concord", "concord", "https://concord.org", "Concord Consortium interactives")),
    ("khan",            ("Khan Academy", "khan", "https://www.khanacademy.org", "Video + practice")),
    ("geogebra",        ("GeoGebra", "geogebra", "https://www.geogebra.org", "Dynamic geometry & algebra")),
    ("desmos",          ("Desmos", "desmos", "https://www.desmos.com", "Graphing calculator")),
    ("mathigon",        ("Mathigon", "mathigon", "https://mathigon.org", "Interactive textbooks")),
    ("matlab",          ("MATLAB", "matlab", "https://www.mathworks.com", "Numerical computing")),
    ("ophysics",        ("oPhysics", "ophysics", "https://ophysics.com", "Physics applets")),
    ("algodoo",         ("Algodoo", "algodoo", "http://www.algodoo.com", "2D physics sandbox")),
    ("physion",         ("Physion", "physion", "https://physion.net", "Physics sandbox (app)")),
    ("chemsims",        ("ChemSims", "chemsims", "http://chemsims.com", "Chemistry simulations")),
    ("chemcollective",  ("ChemCollective", "chemcollective", "https://chemcollective.org", "CMU virtual lab")),
    ("chemreacts",      ("ChemReacts", "chemreacts", "https://concord.org", "Reaction modelling")),
    ("labster",         ("Labster", "labster", "https://www.labster.com", "3D virtual lab")),
    ("praxilabs",       ("PraxiLabs", "praxilabs", "https://praxilabs.com", "3D virtual lab")),
    ("biosimulations",  ("BioSimulations", "biosimulations", "https://biosimulations.org", "Computational biology models")),
    ("biologysimulations", ("Biology Simulations", "biologysimulations", "https://www.biologysimulations.com", "Classroom bio sims")),
    ("berts",           ("Bert's Simulations", "berts", "https://static-archives.git-pages.mst.edu/userweb-gbert/links.html", "Missouri S&T gas-law sims")),
])

# header text (normalised) -> canonical platform key
HEADER_MAP = {
    "phet": "phet", "phet ": "phet",
    "olabs": "olabs", "olab": "olabs", "olabs simulator": "olabs",
    "diksha": "diksha",
    "javalabs": "javalab", "javalab": "javalab",
    "ck12": "ck12",
    "ck12 (assessment with simulation basic integration as pics only)": "ck12",
    "labxchange": "labxchange",
    "concord": "concord",
    "khan academy": "khan",
    "geogebra": "geogebra",
    "desmos": "desmos",
    "mathigon": "mathigon",
    "matlab": "matlab",
    "ophysics": "ophysics",
    "algodoo": "algodoo",
    "physion": "physion",
    "chemsims": "chemsims", "chem sims": "chemsims",
    "chemcollective": "chemcollective",
    "chemreacts": "chemreacts",
    "labster": "labster",
    "praxilabs": "praxilabs",
    "bio simulations-  https://biosimulations.org/": "biosimulations",
    "bio simulations - https://biosimulations.org/": "biosimulations",
    "biosimulations": "biosimulations",
    "biology simulations - https://www.biologysimulations.com/": "biologysimulations",
    "biology simulations": "biologysimulations",
    "https://static-archives.git-pages.mst.edu/userweb-gbert/links.html": "berts",
}

STRUCTURAL = {"chapter", "topic", "activity", "subtopic", "sub-topic", "sub topic"}

SOURCES = [
    ("physics.xlsx",   "Physics",   "physics"),
    ("chemistry.xlsx", "Chemistry", "chemistry"),
    ("maths.xlsx",     "Mathematics", "mathematics"),
    ("biology.xlsx",   "Biology",   "biology"),
]

GRADE_ORDER = [9, 10, 11, 12]


# ------------------------------------------------------------------ helpers
def norm(s):
    """Collapse whitespace + strip accents for matching."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"\s+", " ", s).strip()


def clean_text(s):
    """Human-readable text: keep newlines meaningful, drop stray pipes noise."""
    if s is None:
        return ""
    t = norm(s)
    t = re.sub(r"\s*\|\s*", " | ", t)
    return t.strip(" |-")


def grade_from_tab(title):
    m = re.search(r"(\d{1,2})", title)
    if not m:
        return None
    n = int(m.group(1))
    return n if n in GRADE_ORDER else None


URL_START = re.compile(r"(?:https?://|www\.)")

# matches a URL anywhere in free text
URL_RE = re.compile(
    r"(?:https?://[^\s,;'\"<>]+|www\.[^\s,;'\"<>]+|"
    r"[a-z0-9][a-z0-9.-]*\.(?:edu|org|com|in|io|net|co|uk)(?:/[^\s,;'\"<>]*)?)",
    re.I,
)


def tidy_url(u):
    u = u.strip().rstrip(".,;:)")
    if u.startswith("www."):
        u = "https://" + u
    elif not u.lower().startswith("http"):
        u = "https://" + u
    # a URL used as a redirect param is not a second link
    m = re.match(r"^(.*?[?&](?:backUrl|redirect|url|next)=)https?://.*$", u)
    if m:
        u = m.group(1).rstrip("&?")
        if u.endswith("?"):
            u = u.split("?")[0]
    return u


def extract_urls(value, hyperlink_target=None):
    """
    Return (urls, note_text).

    URLs are located by regex so surrounding prose keeps its spacing;
    whatever text is left over becomes the human-readable note. The cell's
    hidden hyperlink target is used when the visible text is only a title.
    """
    raw = "" if value is None else str(value)

    found = [(m.start(), m.end(), m.group(0)) for m in URL_RE.finditer(raw)]
    urls, seen = [], set()

    if hyperlink_target:
        u = tidy_url(str(hyperlink_target))
        if u and u not in seen:
            seen.add(u)
            urls.append(u)

    # leftover prose = note
    rest = raw
    for start, end, _ in reversed(found):
        rest = rest[:start] + " " + rest[end:]
    note = clean_text(rest)

    for _, _, token in found:
        u = tidy_url(token)
        if not u or u in seen:
            continue
        seen.add(u)
        urls.append(u)

    # The cell was a title carried by a hidden hyperlink -> keep the title as a
    # label, but only if it really is prose (not a scheme-less URL, and not text
    # that was already fully consumed by URL matching).
    if hyperlink_target and not note:
        title = clean_text(raw)
        leftover = re.sub(r"\s+", "", rest)
        if title and leftover and not URL_RE.fullmatch(title.strip()):
            note = title
    return urls, note


def map_platform(header_text, url=""):
    h = norm(header_text).lower()
    if h in HEADER_MAP:
        return HEADER_MAP[h]
    # fuzzy: strip parentheticals / trailing urls
    h2 = re.sub(r"\(.*?\)", "", h).strip()
    h2 = re.sub(r"https?://\S+", "", h2).strip(" -")
    if h2 in HEADER_MAP:
        return HEADER_MAP[h2]
    for key, canon in HEADER_MAP.items():
        if key and (key in h2 or h2 in key) and len(h2) > 3:
            return canon
    # last resort: guess from the URL host
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    for needle, canon in [
        ("phet.colorado", "phet"), ("olabs.edu.in", "olabs"),
        ("diksha.gov.in", "diksha"), ("javalab.org", "javalab"),
        ("ck12.org", "ck12"), ("labxchange.org", "labxchange"),
        ("concord.org", "concord"), ("khanacademy", "khan"),
        ("geogebra", "geogebra"), ("desmos", "desmos"), ("mathigon", "mathigon"),
        ("mathworks", "matlab"), ("ophysics", "ophysics"), ("algodoo", "algodoo"),
        ("physion", "physion"), ("chemsims", "chemsims"),
        ("chemcollective", "chemcollective"), ("labster", "labster"),
        ("praxilabs", "praxilabs"), ("biosimulations", "biosimulations"),
        ("biologysimulations", "biologysimulations"), ("mst.edu", "berts"),
    ]:
        if needle in host:
            return canon
    return None


def tidy_label(text):
    """Clean a simulation label: drop branding suffixes and any raw URL."""
    if not text:
        return ""
    t = clean_text(text)
    if not t or URL_RE.fullmatch(t.strip()):
        return ""
    for junk in (" - PhET Interactive Simulations", " - PhET Interactives",
                 " - PhET", " | PhET Interactive Simulations", " | PhET",
                 " (PhET)", " - CK-12", " | CK-12"):
        t = t.replace(junk, "")
    t = re.sub(r"\s+", " ", t).strip(" |-,")
    if not t or URL_RE.fullmatch(t):
        return ""
    return t[:120]


def chapter_sort_key(item):
    """
    Order chapters by the number in 'Chapter 5: ...' / 'Unit 3 ...' when one is
    present; otherwise keep the order the sheet lists them (source order is the
    syllabus order). `item` is (appearance_index, chapter_name).
    """
    idx, name = item
    m = re.match(r"^\s*(?:chapter|unit)\s*(\d+)\b", name, re.I)
    if m:
        return (0, int(m.group(1)), idx)
    return (1, 0, idx)


# --------------------------------------------------------------------- main
def build():
    db = {
        "meta": {},
        "platforms": {k: {"name": v[0], "cls": v[1], "home": v[2], "org": v[3]}
                      for k, v in PLATFORMS.items()},
        "grades": {},
    }

    stats = {"links": 0, "notes": 0, "topics": 0, "chapters": 0, "skipped_platform_cells": []}

    for fname, subject, key in SOURCES:
        path = os.path.join(HERE, fname)
        wb = openpyxl.load_workbook(path, data_only=False)
        for ws in wb.worksheets:
            grade = grade_from_tab(ws.title)
            if grade is None:
                continue

            # ---- detect layout from row 1 --------------------------------
            headers = {}
            for c in range(1, ws.max_column + 1):
                v = ws.cell(1, c).value
                if v not in (None, ""):
                    headers[c] = norm(v)

            chapter_col = topic_col = activity_col = None
            platform_cols = {}
            remark_col = None
            for c, h in headers.items():
                hl = h.lower()
                if hl == "chapter" and chapter_col is None:
                    chapter_col = c
                elif hl in ("topic", "activity") and topic_col is None:
                    # first 'Topic'/'Activity' label = the topic column
                    topic_col = c
                    if hl == "activity":
                        activity_col = c
                elif hl == "activity":
                    activity_col = c
                elif hl.startswith("remarks"):
                    remark_col = c
                elif hl in STRUCTURAL:
                    pass
                else:
                    platform_cols[c] = h

            # Chemistry Gr.11/12 special case: header row reads
            #   A=Chapter | (B empty) | C=Activity | D.. platforms
            # but B holds the activity code and C holds the topic text.
            for c in range(1, min(ws.max_column, 6) + 1):
                if headers.get(c, "").lower() != "activity":
                    continue
                probe_b, probe_c = [], []
                for r in range(2, min(ws.max_row, 40) + 1):
                    b = ws.cell(r, c - 1).value if c > 1 else None
                    cc = ws.cell(r, c).value
                    if b not in (None, ""):
                        probe_b.append(str(b))
                    if cc not in (None, ""):
                        probe_c.append(str(cc))
                if probe_b and probe_c:
                    codey = sum(1 for x in probe_b
                                if re.match(r"^\d+(\.\d+)*[a-z]?$", x.strip())) / len(probe_b)
                    if codey > 0.6 and len(probe_c) > len(probe_b) * 0.5:
                        activity_col = c - 1
                        topic_col = c
                        platform_cols.pop(c, None)
                        platform_cols.pop(c - 1, None)
                break

            if topic_col is None:
                topic_col = 2
            if chapter_col is None:
                # Biology Gr.9 has chapter data in col A but no header
                for r in range(2, min(ws.max_row, 60) + 1):
                    v = ws.cell(r, 1).value
                    if v not in (None, "") and re.search(r"chapter|unit", str(v), re.I):
                        chapter_col = 1
                        break
            platform_cols = {c: h for c, h in platform_cols.items()
                             if c not in (chapter_col, topic_col, activity_col, remark_col)}

            # ---- walk rows ------------------------------------------------
            cur_chapter = None
            gkey = str(grade)
            db["grades"].setdefault(gkey, {"grade": grade, "label": f"Class {grade}", "subjects": {}})
            subj = db["grades"][gkey]["subjects"].setdefault(
                key, {"key": key, "name": subject, "chapters": OrderedDict()})

            last = 0
            for r in range(2, ws.max_row + 1):
                if any(ws.cell(r, c).value not in (None, "")
                       for c in range(1, ws.max_column + 1)):
                    last = r
            for r in range(2, last + 1):
                ch_raw = ws.cell(r, chapter_col).value if chapter_col else None
                tp_raw = ws.cell(r, topic_col).value
                ac_raw = ws.cell(r, activity_col).value if activity_col else None
                rm_raw = ws.cell(r, remark_col).value if remark_col else None

                ch = clean_text(ch_raw)
                if ch:
                    cur_chapter = ch
                topic = clean_text(tp_raw)
                if not topic:
                    continue

                chapter_name = cur_chapter or "General"
                subj["chapters"].setdefault(chapter_name, OrderedDict())
                bucket = subj["chapters"][chapter_name]

                sims, notes = [], []
                seen = set()
                for c in sorted(platform_cols):
                    cell = ws.cell(r, c)
                    if cell.value in (None, "") and not cell.hyperlink:
                        continue
                    header = platform_cols[c]
                    target = cell.hyperlink.target if cell.hyperlink else None
                    urls, note = extract_urls(cell.value, target)
                    pkey = map_platform(header, urls[0] if urls else "")
                    if pkey is None:
                        stats["skipped_platform_cells"].append(
                            f"{subject}/{ws.title}/r{r}c{c} header={header!r} val={str(cell.value)[:40]!r}")
                        continue
                    if urls:
                        for u in urls:
                            sig = (pkey, u)
                            if sig in seen:
                                continue
                            seen.add(sig)
                            entry = {"platform": pkey, "url": u}
                            if note and len(urls) == 1:
                                lbl = tidy_label(note)
                                if lbl:
                                    entry["label"] = lbl
                                note = ""
                            sims.append(entry)
                            stats["links"] += 1
                    elif note and note.strip():
                        notes.append({"platform": pkey, "note": note[:160]})
                        stats["notes"] += 1
                    note = ""

                tkey = (topic + "§" + (clean_text(ac_raw) or "")).lower()
                if tkey in bucket:
                    # merge duplicates within the same chapter
                    existing = bucket[tkey]
                    have = {(s["platform"], s["url"]) for s in existing["sims"]}
                    for s in sims:
                        if (s["platform"], s["url"]) not in have:
                            existing["sims"].append(s)
                    for n in notes:
                        if n not in existing["notes"]:
                            existing["notes"].append(n)
                    if rm_raw and not existing.get("remark"):
                        existing["remark"] = clean_text(rm_raw)
                    continue

                rec = {"title": topic, "sims": sims, "notes": notes}
                ac = clean_text(ac_raw)
                if ac:
                    rec["activity"] = ac
                if rm_raw and clean_text(rm_raw):
                    rec["remark"] = clean_text(rm_raw)
                bucket[tkey] = rec
                stats["topics"] += 1

    # ---- final shaping ---------------------------------------------------
    grades_out = OrderedDict()
    for g in GRADE_ORDER:
        gkey = str(g)
        if gkey not in db["grades"]:
            continue
        gnode = db["grades"][gkey]
        subs_out = OrderedDict()
        for skey in ["physics", "chemistry", "mathematics", "biology"]:
            if skey not in gnode["subjects"]:
                continue
            snode = gnode["subjects"][skey]
            chapters = sorted(enumerate(snode["chapters"].items()),
                              key=lambda kv: chapter_sort_key((kv[0], kv[1][0])))
            ch_list = []
            for _, (cname, topics) in chapters:
                t_list = list(topics.values())
                if not t_list:
                    continue
                ch_list.append({
                    "title": cname,
                    "topics": t_list,
                    "simCount": sum(len(t["sims"]) for t in t_list),
                    "ready": sum(1 for t in t_list if t["sims"]),
                })
                stats["chapters"] += 1
            if not ch_list:
                continue
            subs_out[skey] = {
                "key": skey, "name": snode["name"], "chapters": ch_list,
                "topicCount": sum(len(c["topics"]) for c in ch_list),
                "simCount": sum(c["simCount"] for c in ch_list),
                "readyCount": sum(c["ready"] for c in ch_list),
            }
        if subs_out:
            grades_out[gkey] = {"grade": g, "label": f"Class {g}", "subjects": subs_out}
    db["grades"] = grades_out

    # ---- summary + flat search index ------------------------------------
    plat_counts = {}
    index = []
    total_topics = total_sims = total_ready = 0
    for gkey, gnode in grades_out.items():
        for skey, snode in gnode["subjects"].items():
            total_topics += snode["topicCount"]
            total_sims += snode["simCount"]
            total_ready += snode["readyCount"]
            for ci, ch in enumerate(snode["chapters"]):
                for ti, t in enumerate(ch["topics"]):
                    for s in t["sims"]:
                        plat_counts[s["platform"]] = plat_counts.get(s["platform"], 0) + 1
                    index.append({
                        "g": gkey, "s": skey, "c": ci, "t": ti,
                        "n": t["title"],
                        "ch": ch["title"],
                        "k": len(t["sims"]),
                    })
    db["meta"] = {
        "name": "SimVerse",
        "tagline": "Every simulation your syllabus needs — in one place.",
        "grades": len(grades_out),
        "subjects": 4,
        "chapters": stats["chapters"],
        "topics": total_topics,
        "sims": total_sims,
        "readyTopics": total_ready,
        "platforms": len(plat_counts),
        "notes": stats["notes"],
        "builtFrom": [s[0] for s in SOURCES],
    }
    db["platformCounts"] = dict(sorted(plat_counts.items(), key=lambda kv: -kv[1]))
    db["index"] = index

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* SimVerse dataset - generated by build/etl.py. Do not edit by hand. */\n")
        f.write("window.SIMVERSE_DATA = ")
        json.dump(db, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    size = os.path.getsize(OUT)
    print(f"OK  wrote {OUT}")
    print(f"    size            : {size/1024:.1f} KB")
    print(f"    grades          : {len(grades_out)}")
    print(f"    chapters        : {stats['chapters']}")
    print(f"    topics          : {total_topics}   (with sims: {total_ready})")
    print(f"    simulation links: {total_sims}")
    print(f"    note-only cells : {stats['notes']}")
    print(f"    platforms used  : {len(plat_counts)}")
    if stats["skipped_platform_cells"]:
        print(f"    UNMAPPED platform cells: {len(stats['skipped_platform_cells'])}")
        for s in stats["skipped_platform_cells"][:20]:
            print("       ", s)
    else:
        print("    UNMAPPED platform cells: 0")
    return db


if __name__ == "__main__":
    build()
