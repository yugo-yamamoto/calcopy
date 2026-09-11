# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""calcopy.src.js から ブックマークレット と index.html を生成する。

    uv run build.py

terser (npx) があれば圧縮し、無ければ元のソースをそのまま使う。
"""
import html
import pathlib
import shutil
import subprocess
import urllib.parse

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "calcopy.src.js"
MIN = ROOT / "calcopy.min.js"
BM = ROOT / "calcopy.bookmarklet.txt"
PAGE = ROOT / "index.html"

# javascript: URL 内で別の意味を持つ文字 (% # " 空白 改行など) は必ずエンコードする
URL_SAFE = "!$&'()*+,-./:;<=>?@[]^_`{|}~"


def minify(source: str) -> str:
    """terser があれば圧縮する。無ければ元のソースを返す。"""
    if not shutil.which("npx"):
        print("! npx が無いため圧縮せずに生成します")
        return source
    try:
        out = subprocess.run(
            ["npx", "--yes", "terser@5", str(SRC), "-c", "-m", "--comments", "false"],
            capture_output=True, text=True, timeout=180, check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"! terser に失敗したため圧縮せずに生成します: {e}")
        return source


def main() -> None:
    source = SRC.read_text(encoding="utf-8")
    mini = minify(source)
    MIN.write_text(mini + "\n", encoding="utf-8")

    encoded = urllib.parse.quote(mini, safe=URL_SAFE)
    assert urllib.parse.unquote(encoded) == mini, "URL エンコードの往復に失敗しました"
    for bad in ("#", '"', " ", "\n", "\t"):
        assert bad not in encoded, f"javascript: URL に危険な文字が残っています: {bad!r}"

    bookmarklet = "javascript:" + encoded
    BM.write_text(bookmarklet, encoding="utf-8")

    template = (ROOT / "index.template.html").read_text(encoding="utf-8")
    PAGE.write_text(
        template
        .replace("{{BOOKMARKLET_HREF}}", html.escape(bookmarklet, quote=True))
        .replace("{{SIZE}}", f"{len(bookmarklet):,}"),
        encoding="utf-8",
    )

    print(f"calcopy.min.js          : {len(mini):,} bytes")
    print(f"calcopy.bookmarklet.txt : {len(bookmarklet):,} bytes")
    print(f"index.html              : 生成しました")


if __name__ == "__main__":
    main()
