#!/usr/bin/env python3
"""
冊子PDF共通エンジン — Markdown解釈(章/Q&A/POINT/HINT/COLUMN/表など)とページネーションを
全テンプレート共通で担当する。テンプレートは template.json(パレット等)と style.css だけを持つ。

使い方: python3 engine.py <テンプレートディレクトリ> <原稿.md> <出力.pdf>
"""
import sys, re, json, pathlib, shutil, subprocess, tempfile
import markdown
from bs4 import BeautifulSoup, Comment
from playwright.sync_api import sync_playwright

DEFAULT_PALETTE = ["#3D6BFF", "#FF6B5E", "#8B5CF6", "#10B7A6",
                    "#F59E0B", "#EC4899", "#22C55E", "#0EA5E9"]

def md_to_html(md_text: str) -> str:
    return markdown.markdown(md_text, extensions=["tables", "fenced_code"])

def transform(html: str, css: str, palette: list) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # ===== 手動マーカー(イレギュラー対応用) =====
    # 原稿に単独行として <!-- page-break --> と書くとそこで強制改ページ、
    # <!-- space: 8mm --> と書くとそこに指定量の余白を挿入する。
    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        text = c.strip()
        space_m = re.match(r"^space:\s*([\d.]+)\s*mm$", text, re.I)
        if space_m:
            spacer = soup.new_tag("div", **{"class": "pb-space"})
            spacer["style"] = f"height: {space_m.group(1)}mm;"
            c.replace_with(spacer)
        elif re.match(r"^page-break$", text, re.I):
            marker = soup.new_tag("div", **{"class": "force-break"})
            c.replace_with(marker)

    # ===== 表紙材料の回収 =====
    h1 = soup.find("h1")
    title_main, title_sub = (h1.get_text(), "") if h1 else ("無題", "")
    if "—" in title_main:
        title_main, title_sub = [s.strip() for s in title_main.split("—", 1)]
    meta_lines, consumed = [], [h1] if h1 else []
    node = h1.find_next_sibling() if h1 else None
    while node is not None and node.name == "p" and len(meta_lines) < 3:
        meta_lines.append(str(node.decode_contents()))
        consumed.append(node)
        node = node.find_next_sibling()
    for n in consumed:
        if n: n.extract()

    # ===== h3: Qマーカー =====
    for h3 in soup.find_all("h3"):
        m = re.match(r"^(Q\d*|Q)[..\s]*(.*)$", h3.get_text())
        if m and not h3.get_text().startswith("コラム"):
            h3.clear()
            q = soup.new_tag("span", **{"class": "q-marker"})
            q.string = "Q" + re.sub(r"\D", "", m.group(1))
            h3.append(q)
            h3.append(m.group(2))

    # ===== 要点整理カード(コラムより先に生成すること) =====
    for p in soup.find_all("p"):
        st = p.find("strong")
        if st and "覚えること" in st.get_text() and len(p.get_text()) == len(st.get_text()):
            ul = p.find_next_sibling()
            if ul is not None and ul.name == "ul":
                box = soup.new_tag("div", **{"class": "summary-box"})
                title = soup.new_tag("div", **{"class": "summary-title"})
                title.string = "POINT — " + st.get_text()
                p.insert_before(box)
                box.append(title)
                box.append(ul.extract())
                p.extract()

    # ===== 覚え方チップ =====
    for p in soup.find_all("p"):
        if p.get_text().startswith("覚え方"):
            p["class"] = (p.get("class") or []) + ["oboekata"]
            inner = p.decode_contents()
            p.clear()
            span = soup.new_tag("span", **{"class": "hi"})
            span.append(BeautifulSoup(inner, "html.parser"))
            p.append(span)

    # ===== ヒントカード(コラムより先に生成すること) =====
    for p in soup.find_all("p"):
        if p.get_text().lstrip().startswith("ヒント"):
            inner = re.sub(r"^\s*ヒント[::]\s*", "", p.decode_contents())
            box = soup.new_tag("div", **{"class": "hint-box"})
            label = soup.new_tag("div", **{"class": "hint-label"})
            label.string = "HINT"
            p.insert_before(box)
            box.append(label)
            newp = soup.new_tag("p")
            newp.append(BeautifulSoup(inner, "html.parser"))
            box.append(newp)
            p.extract()

    # ===== リスト項目「**用語**: 説明」をコロンで改行 =====
    for li in soup.find_all("li"):
        st = li.find("strong")
        if st and li.contents and li.contents[0] is st:
            nxt = st.next_sibling
            if nxt and isinstance(nxt, str) and re.match(r"^\s*[::]", nxt):
                rest = re.sub(r"^\s*[::]\s*", "", nxt)
                nxt.extract()
                desc = soup.new_tag("span", **{"class": "li-desc"})
                desc.append(rest)
                node = st.next_sibling
                while node is not None:
                    nn = node.next_sibling
                    desc.append(node.extract())
                    node = nn
                st.insert_after(desc)
                li["class"] = (li.get("class") or []) + ["li-def"]

    # ===== 引用内 NG/OK バッジ行 =====
    for bq in soup.find_all("blockquote"):
        for p in bq.find_all("p"):
            t = p.get_text().lstrip()
            for label, cls in (("NG", "ng"), ("OK", "ok")):
                if t.startswith(label):
                    inner = re.sub(r"^\s*" + label + r"[::]?\s*", "", p.decode_contents())
                    p.clear()
                    badge = soup.new_tag("span", **{"class": f"bq-badge {cls}"})
                    badge.string = label
                    p.append(badge)
                    p.append(BeautifulSoup(inner, "html.parser"))
                    p["class"] = ["bq-row", cls + "-row"]
                    break

    # ===== コラム: h2/h3/生成済みカードで停止して取り込み =====
    STOP_CLASSES = {"summary-box", "hint-box", "column-box"}
    for h3 in soup.find_all("h3"):
        text = h3.get_text()
        if not text.startswith("コラム"):
            continue
        box = soup.new_tag("div", **{"class": "column-box"})
        label = soup.new_tag("div", **{"class": "column-label"})
        label.string = "COLUMN"
        h3.insert_before(box)
        box.append(label)
        h3["class"] = "column-head"
        h3.string = re.sub(r"^コラム[::]\s*", "", text)
        node = box.next_sibling
        while node is not None:
            nxt = node.next_sibling
            name = getattr(node, "name", None)
            if name is None:
                box.append(node.extract())          # 空白テキスト
            elif node is h3:
                box.append(node.extract())          # コラム見出し本体
            elif name in ("h2", "h3") or (STOP_CLASSES & set(node.get("class") or [])):
                break
            else:
                box.append(node.extract())
            node = nxt

    # ===== 表ラップ =====
    for tb in soup.find_all("table"):
        wrap = soup.new_tag("div", **{"class": "table-wrap"})
        tb.insert_before(wrap)
        wrap.append(tb.extract())

    # ===== 末尾注記 =====
    for p in soup.find_all("p"):
        em = p.find("em")
        if em and len(p.get_text()) == len(em.get_text()):
            p["class"] = (p.get("class") or []) + ["colophon"]

    # ===== 章section化 + 章カラー割当 =====
    out = BeautifulSoup("", "html.parser")
    current, idx = None, 0
    for node in list(soup.children):
        if getattr(node, "name", None) == "h2":
            m = re.match(r"^(第(\d+)章|実践編(\d+)|付録|まとめ|おわりに)[\s::]*(.*)$", node.get_text())
            color = palette[idx % len(palette)]
            idx += 1
            current = soup.new_tag("section", **{"class": "chapter"})
            current["style"] = f"--accent: {color};"
            head = soup.new_tag("div", **{"class": "chapter-head"})
            if m and (m.group(2) or m.group(3)):
                no = soup.new_tag("div", **{"class": "ch-no"})
                no.string = (m.group(2) or m.group(3)).zfill(2)
                lab = soup.new_tag("div", **{"class": "ch-label"})
                lab.string = m.group(1)
                ttl = soup.new_tag("div", **{"class": "ch-title"})
                ttl.string = m.group(4) or node.get_text()
                head.extend([no, lab, ttl])
            else:
                ttl = soup.new_tag("div", **{"class": "ch-title"})
                ttl.string = node.get_text()
                head.append(ttl)
            head.append(soup.new_tag("div", **{"class": "ch-bar"}))
            current.append(head)
            out.append(current)
            node.extract()
        else:
            node.extract()
            (current if current is not None else out).append(node)

    # ===== Q&Aブロック化(h3〜次のh3/カードまで) =====
    for sec in out.find_all("section", class_="chapter"):
        children = [c for c in sec.children if getattr(c, "name", None)]
        i = 0
        while i < len(children):
            node = children[i]
            if node.name == "h3":
                block = out.new_tag("div", **{"class": "qa-block"})
                node.insert_before(block)
                block.append(node.extract())
                j = i + 1
                while j < len(children):
                    nxt = children[j]
                    if nxt.name == "h3" or (STOP_CLASSES & set(nxt.get("class") or [])):
                        break
                    block.append(nxt.extract())
                    j += 1
                i = j
            else:
                i += 1

    body = str(out)

    # ===== 表紙HTML =====
    ver, kept = "", []
    for m_line in meta_lines:
        plain = re.sub(r"<[^>]+>", "", m_line)
        if "バージョン" in plain and not ver:
            ver = f'<span class="ver">{plain.strip()}</span><br>'
        else:
            kept.append(m_line)
    meta_html = "".join(f"<p>{m}</p>" for m in kept)
    dots = "".join(f'<span style="background:{c}"></span>' for c in palette[:6])

    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><style>{css}</style></head>
<body>
<div class="cover"><div class="cover-card">
  <div class="cover-label">LEARNING GUIDE</div>
  <div class="cover-dots">{dots}</div>
  <div class="cover-title">{title_main}</div>
  <div class="cover-subtitle">{title_sub}</div>
  <div class="cover-meta">{ver}{meta_html}</div>
</div></div>
<div class="page-body">{body}</div>
</body></html>"""

PAGINATE_JS = """
  (cfg) => {
    const MM = 3.77953;
    const PAGE = 297 * MM, TOP = 13 * MM, BOT = 15 * MM;
    const CAP = PAGE - BOT - TOP;
    const ATOMIC = '.table-wrap, blockquote, .summary-box, .column-box, .hint-box, pre, .chapter-head';
    // 1ページに収まらないコードブロックを行単位で事前分割(自然分割による位置ズレを根絶)
    const maxH = CAP * 0.92;
    document.querySelectorAll('.page-body pre').forEach(pre => {
      if (pre.getBoundingClientRect().height <= maxH) return;
      const cs = getComputedStyle(pre);
      const lineH = parseFloat(cs.lineHeight) || 16;
      const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const perChunk = Math.max(5, Math.floor((maxH - padV) / lineH));
      const code = pre.querySelector('code');
      const lines = (code || pre).textContent.split('\\n');
      const frag = document.createDocumentFragment();
      for (let s = 0; s < lines.length; s += perChunk) {
        const np = pre.cloneNode(false);
        const chunk = lines.slice(s, s + perChunk).join('\\n');
        if (code) {
          const nc = code.cloneNode(false);
          nc.textContent = chunk;
          np.appendChild(nc);
        } else {
          np.textContent = chunk;
        }
        frag.appendChild(np);
      }
      pre.replaceWith(frag);
    });

    // カード類に属さない箇条書き(ul/ol)はli単位に分割し、途中改ページを許可する
    // (リスト全体が1ブロック扱いだと、入りきらない時に丸ごと次ページへ送られて
    //  手前のページに大きな空白が残るため)
    document.querySelectorAll('.page-body ul, .page-body ol').forEach(list => {
      if (list.closest('.summary-box, .column-box, .hint-box')) return;
      const items = Array.from(list.children).filter(c => c.tagName === 'LI');
      if (items.length <= 1) return;
      const frag = document.createDocumentFragment();
      items.forEach((li, idx) => {
        const nl = list.cloneNode(false);
        nl.style.marginBottom = (idx === items.length - 1) ? '' : '0';
        if (nl.tagName === 'OL') nl.setAttribute('start', String(idx + 1));
        li.style.marginBottom = '0';
        nl.appendChild(li);
        frag.appendChild(nl);
      });
      list.replaceWith(frag);
    });

    const units = [];
    const collect = (el) => {
      if (el.matches('section.chapter')) {
        el.querySelectorAll(':scope > *').forEach(collect);
      } else if (el.classList.contains('qa-block')) {
        el.querySelectorAll(':scope > *').forEach(c => units.push(c));
      } else {
        units.push(el);
      }
    };
    document.querySelectorAll('.page-body > *').forEach(collect);
    const tops = units.map(u => u.getBoundingClientRect().top);
    const consumed = units.map((u, i) =>
      (i + 1 < units.length) ? tops[i + 1] - tops[i]
                             : u.getBoundingClientRect().height);
    const newPage = (u, withBreak) => {
      const sp = document.createElement('div');
      sp.style.height = TOP + 'px';
      if (withBreak) sp.style.breakBefore = 'page';
      u.parentNode.insertBefore(sp, u);
      u.style.marginTop = '0';
    };
    let cur = TOP;
    let pageFirst = 0, last = -1, lastH = 0;
    let chapterCount = 0;
    const SHORT_P = 12 * MM; // これ以下の高さの<p>は「見出しラベルだけの段落」とみなす目安(ほぼ1行)。
                              // 長めに取ると「便利さゆえの罠: 説明文...」のような完結した1文まで
                              // 誤って後続とペアリングし、逆に不要な改ページを招くため狭めに取る。
    const SAFETY = 5 * MM;   // 際どい余裕での誤判定を避けるための安全マージン
    const isHeadingLikeAt = (idx) => {
      const el = units[idx];
      if (!el) return false;
      if (el.tagName === 'H3') return true;
      if (el.tagName !== 'P' || consumed[idx] > SHORT_P || idx + 1 >= units.length) return false;
      // 句点(。！？)で終わる完結した1文は、短くても「見出しラベル」ではなく独立した文なので
      // 後続とペアリングしない(例: 「便利さゆえの罠: 説明。」「これを置いておけば…なります。」)。
      // 「コツ3: 読者別に変換させる」のように句点なしで終わる短い段落だけを疑似見出しとみなす。
      return !/[。！？]$/.test(el.textContent.trim());
    };
    // 見出し的ユニットが連鎖する限り、後続をまとめて合算する(例: Q見出し→短い導入文→表)
    const lookaheadNeed = (idx) => {
      let total = consumed[idx];
      let k = idx;
      while (isHeadingLikeAt(k) && k + 1 < units.length) {
        const nh = consumed[k + 1];
        total += (nh <= CAP ? nh : Math.min(nh, 34 * MM));
        k += 1;
      }
      return total;
    };
    units.forEach((u, i) => {
      const h = consumed[i];
      if (i === 0) { newPage(u, false); cur = TOP + h; pageFirst = 0; last = 0; lastH = h; return; }
      // 手動マーカー: <!-- page-break --> はここで問答無用に改ページする
      if (u.classList.contains('force-break')) {
        newPage(u, true);
        cur = TOP + h;
        pageFirst = i; last = i; lastH = h;
        return;
      }
      const isChapter = u.classList.contains('chapter-head');
      const isSummary = u.classList.contains('summary-box');
      const isHeadingLike = isHeadingLikeAt(i);
      const need = isHeadingLike ? lookaheadNeed(i) : h;
      const tooTall = need > CAP;
      let doBreak = false;
      if (isChapter) {
        chapterCount += 1;
        // 章扉を前ページに流し込んでよいか(template.json の pagination.chapter_inline)
        //   'first'(既定) … 最初の章扉だけ。直前の注意書き等と同じページに収まるなら流し込む
        //   'all'          … すべての章扉で同じ判定をする(章の切れ目は弱くなるがページ数は減る)
        //   'never'        … 章扉は常に新ページから始める
        const inlineAllowed = cfg.chapter_inline === 'all'
                           || (cfg.chapter_inline === 'first' && chapterCount === 1);
        doBreak = !inlineAllowed || cur > TOP + CAP * cfg.chapter_inline_ratio;
        if (!doBreak) u.style.marginTop = '10mm';
      } else {
        // 短い「単独の」段落(目安3行以内、後続とペアリングされていないもの)は、
        // 実際のChromium描画がJS側の見積もりより早く改ページしてしまうことがあるため、
        // 追加の安全マージンを取る。isHeadingLikeで既に後続とセット判定されている
        // 段落(例: 「1. 根拠となる資料を渡す」+直後のカード)はneedに後続分を
        // 織り込み済みなので対象外(ここにも適用すると過剰に細かく改ページされる)。
        const extraSafety = (u.tagName === 'P' && h <= 20 * MM && !isHeadingLike) ? 20 * MM : 0;
        if (cur + need > PAGE - BOT - SAFETY - extraSafety && !tooTall) {
          doBreak = true;
        }
      }
      // 孤立ページ防止: 改ページ後に単独になると予測されるユニットは直前ブロックを道連れに
      // ただしPOINT/COLUMN/HINTカードはラベル付きで単体でも完結して見えるため対象外
      // (直前の段落まで巻き込んで無駄な空白を作らない)
      const isSelfContainedCard = u.classList.contains('summary-box')
        || u.classList.contains('column-box') || u.classList.contains('hint-box');
      if (doBreak && !isChapter && !isSelfContainedCard) {
        let willBeAlone = true;
        if (i + 1 < units.length && !units[i + 1].classList.contains('chapter-head')) {
          const nneed = isHeadingLikeAt(i + 1) ? lookaheadNeed(i + 1) : consumed[i + 1];
          willBeAlone = h + nneed > CAP;
        }
        if (willBeAlone && last > pageFirst && lastH + h <= CAP
            && !units[last].classList.contains('chapter-head')) {
          newPage(units[last], true);
          cur = TOP + lastH + h;
          pageFirst = last;
          last = i; lastH = h;
          return;
        }
      }
      if (doBreak) {
        newPage(u, true);
        cur = TOP + h;
        pageFirst = i;
      } else {
        cur += h;
        if (cur > PAGE - BOT) {
          cur = TOP + ((cur - TOP) % CAP);
          pageFirst = i;
        }
      }
      last = i; lastH = h;
    });
  }
"""

# ノンブル(ページ番号)の既定値。template.json の "nombre" で上書きできる。
# ノンブルはPDFのフッター領域に描画されるため、テンプレートのCSSからは届かない。
DEFAULT_NOMBRE = {
    "font_size": "7pt",
    "color": "#7A8194",
    "font_family": "'Noto Sans CJK JP'",
    "align": "right",
    "format": "{page} / {total}",  # {page}=ページ番号, {total}=総ページ数
    "skip_cover": False,           # Trueにすると1ページ目(表紙)にノンブルを入れない
}

# ページ送りの既定値。template.json の "pagination" で上書きできる。
DEFAULT_PAGINATION = {
    "chapter_inline": "first",     # first | all | never (章扉を前ページに流し込む範囲)
    "chapter_inline_ratio": 0.25,  # 前ページの使用量がこの割合以内なら流し込む
}

PDF_MARGIN = {"top": "0mm", "bottom": "14mm", "left": "0mm", "right": "0mm"}

def _footer_html(n: dict) -> str:
    body = (n["format"]
            .replace("{page}", '<span class="pageNumber"></span>')
            .replace("{total}", '<span class="totalPages"></span>'))
    return (f'<div style="width:100%; font-size:{n["font_size"]}; color:{n["color"]};'
            f' padding:0 18mm; text-align:{n["align"]};'
            f' font-family:{n["font_family"]};">{body}</div>')

def html_to_pdf(html: str, out_path: str, nombre=None, pagination=None):
    n = {**DEFAULT_NOMBRE, **(nombre or {})}
    pg = {**DEFAULT_PAGINATION, **(pagination or {})}
    footer = _footer_html(n)
    common = dict(format="A4", print_background=True, margin=PDF_MARGIN)

    # 表紙だけノンブルを外す場合は、1ページ目と2ページ目以降を別々に書き出して結合する。
    # Chromiumのフッターはページごとに出し分けられないため、この方法しかない。
    # page_ranges で分割してもノンブルは振り直されない(検証済み)。
    skip_cover = bool(n["skip_cover"]) and shutil.which("pdfunite") is not None
    if bool(n["skip_cover"]) and not skip_cover:
        print("警告: pdfunite(poppler)が無いため、表紙のノンブルを除外できません。"
              "全ページに入った状態で出力します。", file=sys.stderr)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        # 測定レイアウトを印刷レイアウトに一致させる(A4 = 794×1123 CSS px)
        page = browser.new_page(viewport={"width": 794, "height": 1123})
        page.set_content(html, wait_until="networkidle")
        page.evaluate(PAGINATE_JS, pg)

        if skip_cover:
            with tempfile.TemporaryDirectory() as td:
                cover = str(pathlib.Path(td) / "cover.pdf")
                rest = str(pathlib.Path(td) / "rest.pdf")
                page.pdf(path=cover, display_header_footer=False,
                         page_ranges="1", **common)
                has_rest = True
                try:
                    page.pdf(path=rest, display_header_footer=True,
                             header_template="<span></span>", footer_template=footer,
                             page_ranges="2-", **common)
                except Exception:
                    has_rest = False  # 全1ページの原稿
                if has_rest:
                    subprocess.run(["pdfunite", cover, rest, out_path], check=True)
                else:
                    shutil.copyfile(cover, out_path)
        else:
            page.pdf(path=out_path, display_header_footer=True,
                     header_template="<span></span>", footer_template=footer,
                     **common)
        browser.close()

def load_template(template_dir: pathlib.Path):
    css = (template_dir / "style.css").read_text(encoding="utf-8")
    config = {}
    config_path = template_dir / "template.json"
    if config_path.exists():
        config = json.loads(config_path.read_text(encoding="utf-8"))
    palette = config.get("palette") or DEFAULT_PALETTE
    nombre = config.get("nombre") or {}
    pagination = config.get("pagination") or {}
    return css, palette, nombre, pagination

def build(template_dir: str, src: str, dst: str):
    template_dir = pathlib.Path(template_dir)
    css, palette, nombre, pagination = load_template(template_dir)
    md_text = pathlib.Path(src).read_text(encoding="utf-8")
    html = transform(md_to_html(md_text), css, palette)
    html_to_pdf(html, dst, nombre, pagination)

def main():
    template_dir, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    build(template_dir, src, dst)
    print(f"OK: {dst}")

if __name__ == "__main__":
    main()
