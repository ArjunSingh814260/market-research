"""
Convert Accord's *_Displayformat.xlsx files (CompanyFundamentals/) into
src/lib/displayFormats.json, which the company fundamentals page uses to lay
out each statement (row order, labels, indentation, bold, formulas).

Accord emails new display-format files when they change. Drop them into
CompanyFundamentals/ and re-run:

    pip install openpyxl
    python3 scripts/build_display_formats.py
"""
import json
import pathlib

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "CompanyFundamentals"
OUT = ROOT / "src" / "lib" / "displayFormats.json"

FILES = {
    "bs": "Finance_bs_Displayformat.xlsx",
    "pl": "Finance_pl_Displayformat.xlsx",
    "cf": "Finance_cf_Displayformat.xlsx",
    "fr": "Finance_fr_Displayformat.xlsx",
    "resultsStd": "Results_IndAS_Displayformat_Std.xlsx",
    "resultsCons": "Results_IndAS_Displayformat_Cons.xlsx",
    "shp": "Shp_Displayformat.xlsx",
}


def clean(v):
    if v is None:
        return None
    s = str(v).replace("\xa0", " ")
    return None if s.strip() in ("", "NULL", "None") else s


def rows_of(path):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    head = [str(h).strip() if h else "" for h in next(it)]
    for r in it:
        if any(c is not None for c in r):
            yield dict(zip(head, r))


def build(key, path):
    out = {}
    for r in rows_of(path):
        fmt = clean(r.get("Format") or r.get("Display_Format")) or "ALL"
        order = r.get("Disporder") or r.get("Display_Order") or r.get("DispOrder")
        desc = clean(r.get("Description"))
        field = clean(r.get("FieldName"))
        indent = len(desc) - len(desc.lstrip(" ")) if desc else 0
        if key == "shp" and desc:
            indent = (clean(r.get("HTML_Head")) or "").count("&nbsp;")
        type_flag = (clean(r.get("Type_Flag")) or "").strip() or None
        out.setdefault(fmt.strip(), []).append(
            {
                "order": int(order),
                "label": desc.strip() if desc else "",
                "field": field.strip() if field else None,
                "indent": indent,
                "bold": str(r.get("Bold") or "").strip() == "T",
                # T = monetary value, scale by the row's Unit (annual statements only)
                "useUnit": (clean(r.get("UseUnit")) or "").strip() == "T",
                # S = standalone rows, C = shown only for consolidated statements
                "typeFlag": type_flag,
            }
        )
    for fmt in out:
        out[fmt].sort(key=lambda x: x["order"])
    return out


result = {key: build(key, SRC / name) for key, name in FILES.items()}
OUT.write_text(json.dumps(result, separators=(",", ":")))
print(f"wrote {OUT.relative_to(ROOT)}", {k: sorted(v) for k, v in result.items()})
