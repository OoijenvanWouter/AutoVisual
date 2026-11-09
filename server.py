#!/usr/bin/env python3
"""AutoVisual helper: serveert de app en zet links om naar lokale mediabestanden.

Browsers mogen geen pixels lezen uit YouTube/Instagram/TikTok-embeds, dus WebGL-effecten
kunnen daar niet op werken. Deze helper haalt het beeld op (via yt-dlp), bewaart het in
./cache en serveert het vanaf dezelfde origin. Luistert alleen op 127.0.0.1.
"""
import hashlib
import html
import http.server
import ipaddress
import json
import re
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
PORT = 8765
MAX_BYTES = 300 * 1024 * 1024
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
PLATFORMS = ("youtube.com", "youtu.be", "instagram.com", "tiktok.com", "vimeo.com", "x.com", "twitter.com", "facebook.com", "fb.watch", "reddit.com")
FORMAT = "bv*[height<=720][vcodec^=avc1][ext=mp4]/b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/best"
TYPES = {
    "image/jpeg": ("image", ".jpg"), "image/png": ("image", ".png"), "image/gif": ("image", ".gif"),
    "image/webp": ("image", ".webp"), "image/avif": ("image", ".avif"), "image/bmp": ("image", ".bmp"),
    "video/mp4": ("video", ".mp4"), "video/webm": ("video", ".webm"),
}
SERVE = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
    ".bmp": "image/bmp", ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/mp4",
}

downloads = threading.Semaphore(3)
key_locks: dict[str, threading.Lock] = {}
key_locks_guard = threading.Lock()


class ResolveError(Exception):
    pass


ytdlp_found = False


def has_ytdlp() -> bool:
    """Controleer in een nieuw proces: yt-dlp kan geïnstalleerd zijn terwijl de server draait."""
    global ytdlp_found
    if not ytdlp_found:
        check = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True)
        ytdlp_found = check.returncode == 0
    return ytdlp_found


def host_of(url: str) -> str:
    return (urllib.parse.urlsplit(url).hostname or "").lower()


def is_platform(url: str) -> bool:
    host = host_of(url)
    return any(host == p or host.endswith("." + p) for p in PLATFORMS)


def require_public(url: str) -> None:
    """Weiger alles behalve http(s) naar publieke adressen."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ResolveError("Alleen http(s)-links worden ondersteund.")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443)
    except socket.gaierror as exc:
        raise ResolveError(f"Host niet gevonden: {parts.hostname}") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
            raise ResolveError("Lokale of privé-adressen zijn niet toegestaan.")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


opener = urllib.request.build_opener(SafeRedirect)


def open_url(url: str):
    require_public(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        return opener.open(req, timeout=30)
    except urllib.error.HTTPError as exc:
        raise ResolveError(f"Server gaf HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise ResolveError(f"Ophalen mislukt: {exc.reason}") from exc


def store(resp, key: str, kind: str, ext: str) -> Path:
    target = CACHE / f"{key}{ext}"
    part = target.with_suffix(ext + ".part")
    total = 0
    with part.open("wb") as handle:
        while chunk := resp.read(1 << 16):
            total += len(chunk)
            if total > MAX_BYTES:
                handle.close()
                part.unlink(missing_ok=True)
                raise ResolveError("Bestand is groter dan 300 MB.")
            handle.write(chunk)
    part.replace(target)
    return target


def meta_tag(page: str, prop: str) -> str | None:
    for pattern in (
        rf'<meta[^>]+(?:property|name)=["\']{prop}["\'][^>]+content=["\']([^"\']+)',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{prop}["\']',
    ):
        found = re.search(pattern, page, re.I)
        if found:
            return html.unescape(found.group(1))
    return None


def fetch_direct(url: str, key: str, allow_page: bool = True) -> dict:
    with open_url(url) as resp:
        ctype = (resp.headers.get_content_type() or "").lower()
        if ctype in TYPES:
            kind, ext = TYPES[ctype]
            return {"kind": kind, "src": f"/cache/{store(resp, key, kind, ext).name}", "title": Path(urllib.parse.urlsplit(url).path).name}
        if ctype not in ("text/html", "application/xhtml+xml") or not allow_page:
            raise ResolveError(f"Geen bruikbaar beeld ({ctype or 'onbekend type'}).")
        page = resp.read(1 << 20).decode("utf-8", "replace")
    title = meta_tag(page, "og:title") or ""
    for prop in ("og:video:secure_url", "og:video", "og:image", "twitter:image"):
        candidate = meta_tag(page, prop)
        if candidate:
            result = fetch_direct(urllib.parse.urljoin(url, candidate), key, allow_page=False)
            result["title"] = title or result["title"]
            return result
    raise ResolveError("Geen beeld gevonden op deze pagina.")


def fetch_ytdlp(url: str, key: str) -> dict:
    if not has_ytdlp():
        raise ResolveError("yt-dlp ontbreekt. Start de app via start.bat om het te installeren.")
    cmd = [
        sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings", "--no-progress", "--encoding", "utf-8",
        "--max-filesize", "300M", "-f", FORMAT, "-o", str(CACHE / f"{key}.%(ext)s"),
        "--print", "after_move:%(filepath)s\t%(title)s", "--", url,
    ]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=420)
    except subprocess.TimeoutExpired as exc:
        raise ResolveError("Download duurde te lang.") from exc
    lines = [line for line in done.stdout.splitlines() if "\t" in line]
    if done.returncode or not lines:
        reason = next((l for l in reversed(done.stderr.splitlines()) if "ERROR" in l), "onbekende fout")
        raise ResolveError(reason.replace("ERROR: ", "")[:240])
    path, title = lines[-1].split("\t", 1)
    return {"kind": "video", "src": f"/cache/{Path(path).name}", "title": title}


def resolve(url: str) -> dict:
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    meta = CACHE / f"{key}.json"
    with key_locks_guard:
        lock = key_locks.setdefault(key, threading.Lock())
    with lock:
        if meta.exists():
            saved = json.loads(meta.read_text("utf-8"))
            if (CACHE / Path(saved["src"]).name).exists():
                return saved
        require_public(url)
        with downloads:
            if is_platform(url):
                try:
                    result = fetch_ytdlp(url, key)
                except ResolveError as first:
                    try:
                        result = fetch_direct(url, key)  # bv. Instagram-foto: og:image
                    except ResolveError:
                        raise first
            else:
                try:
                    result = fetch_direct(url, key)
                except ResolveError as first:
                    if not has_ytdlp():
                        raise
                    try:
                        result = fetch_ytdlp(url, key)
                    except ResolveError:
                        raise first
        meta.write_text(json.dumps(result, ensure_ascii=False), "utf-8")
        return result


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "AutoVisual"

    def log_message(self, *_):
        pass

    def allowed(self) -> bool:
        origins = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
        if self.headers.get("Host") not in origins:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.split("://", 1)[-1] in origins

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return self.fail(403)
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == "/api/health":
            return self.send_json({"ok": True, "ytdlp": has_ytdlp()})
        if parts.path == "/api/resolve":
            url = urllib.parse.parse_qs(parts.query).get("url", [""])[0]
            try:
                return self.send_json(resolve(url))
            except ResolveError as exc:
                return self.send_json({"error": str(exc)}, 422)
            except Exception as exc:  # een kapotte link mag de server niet stoppen
                return self.send_json({"error": f"Onverwachte fout: {exc}"}, 500)
        self.serve_file(urllib.parse.unquote(parts.path))

    def serve_file(self, path: str) -> None:
        relative = "index.html" if path == "/" else path.lstrip("/")
        target = (ROOT / relative).resolve()
        top = Path(relative).parts[0] if Path(relative).parts else ""
        if not target.is_relative_to(ROOT) or not target.is_file() or target.suffix.lower() not in SERVE:
            return self.fail(404)
        if top not in ("index.html", "style.css", "js", "cache"):
            return self.fail(404)
        size = target.stat().st_size
        start, end, status = 0, size - 1, 200
        wanted = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if wanted and size and (wanted[1] or wanted[2]):
            if wanted[1]:
                start, end = int(wanted[1]), min(int(wanted[2] or size - 1), size - 1)
            else:
                start = max(size - int(wanted[2]), 0)
            if start > end:
                return self.fail(416)
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", SERVE[target.suffix.lower()])
        self.send_header("Content-Length", str(end - start + 1 if size else 0))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache" if top != "cache" else "max-age=86400")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with target.open("rb") as handle:
            handle.seek(start)
            remaining = end - start + 1
            try:
                while remaining > 0 and (chunk := handle.read(min(1 << 16, remaining))):
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (ConnectionError, TimeoutError):
                self.close_connection = True


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/"
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"AutoVisual draait al op {url}")
        webbrowser.open(url)
        return
    server.daemon_threads = True
    print(f"AutoVisual draait op {url}  (sluit dit venster om te stoppen)")
    if not has_ytdlp():
        print("Let op: yt-dlp ontbreekt, YouTube/Instagram/TikTok-links werken dan niet.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
