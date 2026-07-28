#!/usr/bin/env python3
"""
h3見出し(および原稿中の短い疑似見出し段落)が、直後の内容と同じページに
収まっているかを機械的にスキャンする検証ツール。全ページを目視する代わりに使う。

pdftotextの単純なテキスト一致による簡易チェックなので、コードブロック(```)直後などは
本文と一致せず「None」になることがある(その場合は該当ページを目視で確認する)。
「要確認」が出た場合も、見出しページの検出が別の本文と誤って一致した結果である
可能性があるため、必ず該当ページを目視確認してから対応すること。

使い方: python3 scan_h3_orphans.py <原稿.md> <確認したいPDF>
"""
import sys, re, subprocess, pathlib

def scan(md_path: str, pdf_path: str):
    lines = pathlib.Path(md_path).read_text(encoding="utf-8").splitlines()

    # h3見出しと、その直後の「内容のある行」(空行・コメント・区切りでない行)を抽出
    pairs = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("### "):
            heading = re.sub(r"^###\s*", "", line).strip()
            j = i + 1
            while j < len(lines) and (lines[j].strip() == "" or lines[j].strip().startswith("<!--")):
                j += 1
            if j < len(lines):
                nxt = lines[j].strip()
                nxt = re.sub(r"^[-*]\s*", "", nxt)
                nxt = re.sub(r"[*_`]", "", nxt)
                pairs.append((heading[:18], nxt[:18]))
        i += 1

    text = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], capture_output=True, text=True).stdout
    page = 1
    page_of_line = []
    for line in text.split("\n"):
        if "\f" in line:
            page += line.count("\f")
            line = line.replace("\f", "")
        page_of_line.append((page, line))

    def find_page(snippet):
        snippet = re.sub(r"[*_`]", "", snippet).strip()
        if not snippet:
            return None
        for p, l in page_of_line:
            if snippet in l:
                return p
        return None

    print(f"{'見出し':20} 見出しページ 直後内容ページ")
    for heading, nxt in pairs:
        hp = find_page(heading)
        np_ = find_page(nxt)
        mark = "  <-- 要確認" if (hp and np_ and hp != np_) else ""
        print(f"{heading:20} {str(hp):>6} {str(np_):>10}{mark}")

if __name__ == "__main__":
    scan(sys.argv[1], sys.argv[2])
