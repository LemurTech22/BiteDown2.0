"""Receipt pipeline: image -> text (GLM-OCR, GPU-side, lazy) -> deterministic line parser
(-> optional Gemini structuring). Importing this module needs only the stdlib.

    parse_receipt_text(text) -> {"lines": [{"name","quantity","price","raw"}], "total": float|None}
"""
from __future__ import annotations
import json
import os
import re

# ---------------------------------------------------------------- parser
_PRICE_END = re.compile(r"(?P<neg1>-)?\$?\s?(?P<amt>\d{1,5}[.,]\d{2})\s*(?P<neg2>-)?\s*(?P<flag>[A-Za-z]{1,2})?\s*$")
_PRICE_ONLY = re.compile(r"^\s*(?P<neg1>-)?\$?\s?(?P<amt>\d{1,5}[.,]\d{2})\s*(?P<neg2>-)?\s*(?P<flag>[A-Za-z]{1,2})?\s*$")
_WEIGHT = re.compile(r"(?P<w>\d+(?:\.\d+)?)\s*(?P<u>lbs?|kg|oz|g)\b\.?\s*(?:@|x)\s*\$?\s*(?P<unit>\d+(?:\.\d+)?)", re.I)
_QTY_AT = re.compile(r"(?<![\d.])(?P<q>\d{1,3})\s*(?:@|x|X|×)\s*\$?\s*(?P<unit>\d+\.\d{2})\b")
_MULTIBUY = re.compile(r"(?<![\d.])(?P<q>\d{1,3})\s*(?:@|x|X|×)\s*(?P<m>\d{1,2})\s*(?:/|for\b)\s*\$?\s*(?P<x>\d+(?:\.\d{1,2})?)", re.I)
_VOID = re.compile(r"\bvoid(?:ed)?\b", re.I)
_LEAD_CODE = re.compile(r"^\W*(?:[A-Za-z]{1,2}\s+)?\d{4,14}\s+")
_TRAIL_CODE = re.compile(r"\s+\d{8,14}[A-Za-z]?\s*$")
_TRAIL_FLAG = re.compile(r"\s+[A-Z]{1,2}$")
_ANY_TOTAL = re.compile(r"\btotal\b", re.I)

_SUBTOTAL = re.compile(r"\bsub\s*-?\s*total\b", re.I)
_TOTAL_PREFIX = re.compile(r"^\W*(grand\s+total|order\s+total|total\s+due|total\s+to\s+pay|amount\s+due|amount\s+to\s+pay|balance\s+(?:due|to\s+pay)|you\s+pay|summe|gesamt(?:summe)?|zu\s+zahlen|total(?!\s+(?:savings|saved|items|discount|number|coupon|tax|points|qty|purchase\s+tax)))\b", re.I)
_TAX = re.compile(r"\b(sales\s+)?tax\b|\bgst\b|\bhst\b|\bvat\b", re.I)
# Non-item lines. STRONG phrases are unambiguous labels and skip anywhere in the line. WEAK words are
# ordinary English that real products also contain ("Instant Oatmeal", "Credit Card Cookies"), so they
# only skip a line when the amount is negative, or the word ENDS the label (the line is *named* by it:
# "MEMBER DISCOUNT 0.50", "CASH TEND 20.00"), or a card/account mask is present.
_SKIP_STRONG = re.compile(
    r"\b(you\s+saved|instant\s+savings|mfr|manufacturer|bottle\s+deposit|crv|bag\s+fee|change\s+due|"
    r"approved|authorization|card\s*#|acct|account\s*#|ref\s*#|transaction|terminal|cashier|store\s*#?\s*\d|"
    r"thank|survey|receipt|items?\s+sold|item\s+count|number\s+of\s+items|ebt|barcode|invoice|"
    r"order\s*#|sc\s*\d+|points\s+(?:earned|balance|today|redeemed)|(?:fuel|reward)\s+points)\b|www\.|\.com\b", re.I)
_SKIP_WEAK_END = re.compile(
    r"\b(coupons?|discounts?|savings?|saved|promo(?:tion)?s?|instant|members?|club(?:\s+card)?|rewards?|points|"
    r"cash|change|credit(?:\s+card)?|debit(?:\s+card)?|visa|master\s*card|amex|discover|tender|tend|payment|"
    r"snap|tel(?:ephone)?|phone|trans|register|lane|welcome|tare|auth)$", re.I)
_SKIP_WEAK_ANY = re.compile(_SKIP_WEAK_END.pattern[:-1], re.I)
_CARD_MASK = re.compile(r"[*xX#]{2,}\s*\d{3,4}\b|\b(?:x{3,}|\*{3,})\s*\d{3,4}\b", re.I)


def _is_skip(ln: str, m_end) -> bool:
    if _SKIP_STRONG.search(ln) or _CARD_MASK.search(ln):
        return True
    label = ln[:m_end.start()] if m_end else ln
    if m_end and (m_end.group("neg1") or m_end.group("neg2")) and _SKIP_WEAK_ANY.search(label):
        return True  # negative amount + coupon/discount-ish word: an adjustment, not a product
    return bool(_SKIP_WEAK_END.search(re.sub(r"[^A-Za-z]+", " ", label).strip()))


_DATE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b", re.I)
_PHONE = re.compile(r"\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}")


def _money(m: re.Match) -> float:
    v = float(m.group("amt").replace(",", "."))
    return -v if (m.group("neg1") or m.group("neg2")) else v


def _clean_name(s: str) -> str:
    s = _LEAD_CODE.sub("", s)
    for _ in range(2):  # "NAME 078742013251 F" -> strip tax flag, then the trailing UPC/PLU
        s = _TRAIL_FLAG.sub("", s.rstrip()) if _TRAIL_CODE.search(_TRAIL_FLAG.sub("", s.rstrip())) else s
        s = _TRAIL_CODE.sub("", s)
    s = re.sub(r"[|*#_]+", " ", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" -:.\t$")
    s = re.sub(r"\s+[A-Z]$", "", s)  # stray tax flag left behind
    return s.strip()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _similar(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    from difflib import SequenceMatcher
    ta, tb = set(a.split()), set(b.split())
    if len(ta & tb) / len(ta | tb) >= 0.5:  # same words, different order
        return True
    return SequenceMatcher(None, a, b).ratio() >= 0.6


def _has_name(s: str) -> bool:
    return len(re.findall(r"[A-Za-z]", s)) >= 2


def _preprocess(text: str) -> list[str]:
    out = []
    for ln in text.replace("\r", "\n").split("\n"):
        ln = ln.replace("**", "").replace("`", "")
        ln = re.sub(r"^\s*#+\s*", "", ln)
        if re.fullmatch(r"[\s|:\-=_*.]+", ln):  # markdown rules / separators
            continue
        ln = re.sub(r"\s*\|\s*", "  ", ln).strip()
        ln = re.sub(r"(\d)\s+([.,]\d{2})\b", r"\1\2", ln)  # OCR spacing: "4 .29" -> "4.29"
        if ln:
            out.append(ln)
    return out


def parse_receipt_text(text: str) -> dict:
    lines_in = _preprocess(text or "")
    items: list[dict] = []
    total: float | None = None
    pending: dict | None = None   # a name-only line waiting for its price/qty on a following line
    after_subtotal = False
    i = 0

    def emit(name, qty, price, raw):
        nonlocal pending
        if not _has_name(name):
            return
        items.append({"name": name, "quantity": qty, "price": price, "raw": raw})
        pending = None

    while i < len(lines_in):
        ln = lines_in[i]
        i += 1
        m_end = _PRICE_END.search(ln)

        # ---- voided item: cancel the matching earlier line (never crash if none matches)
        if _VOID.search(ln):
            pending = None
            body = _VOID.sub(" ", ln)
            body = re.sub(r"[*#]+", " ", body)
            mv = _PRICE_END.search(body)
            vprice = abs(_money(mv)) if mv else None
            vname = _clean_name(body[:mv.start()] if mv else body)
            if not _has_name(vname):
                vname = ""
            for idx in range(len(items) - 1, -1, -1):
                it = items[idx]
                price_ok = vprice is None or (it["price"] is not None and abs(abs(it["price"]) - vprice) < 0.005)
                name_ok = (not vname) or _similar(vname, it["name"])
                if price_ok and name_ok and (vname or vprice is not None):
                    del items[idx]
                    break
            continue

        # ---- totals / subtotal / tax (label may be split from its amount by OCR)
        if _SUBTOTAL.search(ln):
            after_subtotal = True; pending = None; continue
        if _TAX.search(ln) and not _WEIGHT.search(ln):
            after_subtotal = True if items else after_subtotal
            pending = None; continue
        if _TOTAL_PREFIX.match(ln):
            amt = None
            if m_end:
                amt = _money(m_end)
            elif i < len(lines_in) and _PRICE_ONLY.match(lines_in[i]):
                amt = _money(_PRICE_ONLY.match(lines_in[i])); i += 1
            if amt is not None and amt >= 0:
                total = amt  # last TOTAL-ish line wins ("BALANCE" after "TOTAL" is the same number)
            after_subtotal = True; pending = None; continue
        if _ANY_TOTAL.search(ln):  # "Merchandise Total", "Item Total": summary, never an item
            pending = None; continue
        if after_subtotal or _is_skip(ln, m_end) or _PHONE.search(ln) or (_DATE.search(ln) and not m_end):
            pending = None; continue

        # ---- weighted item:  [NAME]  1.23 lb @ $2.99/lb  [3.68]
        mw = _WEIGHT.search(ln)
        if mw:
            weight = float(mw.group("w"))
            unit = float(mw.group("unit"))
            head = _clean_name(ln[:mw.start()])
            price = _money(m_end) if m_end and m_end.start() > mw.end() - 1 else None
            if price is None:
                price = round(weight * unit, 2)
            if head and _has_name(head):
                emit(head, weight, price, ln)
            elif pending:
                emit(pending["name"], weight, price, pending["raw"] + " | " + ln)
            elif items and items[-1]["price"] is not None and items[-1]["raw"] is not None:
                items[-1]["quantity"] = weight   # name+price line came first
            continue

        # ---- price-only line completes a pending name-only line
        if _PRICE_ONLY.match(ln):
            p = _money(_PRICE_ONLY.match(ln))
            if pending and p >= 0:
                emit(pending["name"], pending.get("qty", 1.0), p, pending["raw"] + " | " + ln)
            pending = None
            continue

        # ---- multi-buy:  3 @ 2/$5.00  GREEN ONIONS  7.50   (also "N @ M for $X")
        mb = _MULTIBUY.search(ln)
        if mb:
            q, per, tot = float(mb.group("q")), float(mb.group("m")), float(mb.group("x"))
            has_price = bool(m_end and m_end.start() >= mb.end())
            price = _money(m_end) if has_price else (round(q / per * tot, 2) if per else None)
            head = _clean_name(ln[:mb.start()])
            if not _has_name(head):
                tail = ln[mb.end():m_end.start()] if has_price else ln[mb.end():]
                head = _clean_name(tail)
            if _has_name(head):
                emit(head, q, price, ln)
            elif pending:
                emit(pending["name"], q, price, pending["raw"] + " | " + ln)
            continue

        # ---- qty x unit
        mq = _QTY_AT.search(ln)
        if mq:
            q, unit = float(mq.group("q")), float(mq.group("unit"))
            head = _clean_name(ln[:mq.start()])
            price = _money(m_end) if m_end and m_end.start() >= mq.end() - 1 else round(q * unit, 2)
            if not _has_name(head):  # qty-first layout: "3 @ 1.25  GREEK YOGURT  3.75"
                tail = ln[mq.end():m_end.start()] if m_end and m_end.start() >= mq.end() else ln[mq.end():]
                if _has_name(_clean_name(tail)):
                    head = _clean_name(tail)
            if head and _has_name(head):
                emit(head, q, price, ln)
            elif pending:
                emit(pending["name"], q, price, pending["raw"] + " | " + ln)
            continue

        # ---- plain "NAME   price"
        if m_end:
            price = _money(m_end)
            name = _clean_name(ln[:m_end.start()])
            if price < 0:           # coupon / refund style line
                pending = None; continue
            if _has_name(name):
                emit(name, 1.0, price, ln)
            continue

        # ---- name-only line: wait for a following price
        name = _clean_name(ln)
        pending = {"name": name, "raw": ln} if _has_name(name) else None

    return {"lines": items, "total": total}


# ---------------------------------------------------------------- OCR backend
class GlmOcrEngine:
    """zai-org/GLM-OCR via transformers (model card: AutoModelForMultimodalLM + chat template,
    prompt "Text Recognition:"). GPU-side; transformers/torch are imported lazily in load().
    Verified only against the model card text - NOT executed on the VPS."""

    MODEL_ID = "zai-org/GLM-OCR"
    PROMPT = "Text Recognition:"

    def __init__(self, model_id: str | None = None, max_new_tokens: int = 2048):
        self.model_id = model_id or os.environ.get("GLM_OCR_MODEL", self.MODEL_ID)
        self.max_new_tokens = max_new_tokens
        self._tok = self._model = None

    def load(self):
        if self._model is None:
            from transformers import AutoModelForMultimodalLM, AutoTokenizer  # lazy: heavy
            self._tok = AutoTokenizer.from_pretrained(self.model_id)
            self._model = AutoModelForMultimodalLM.from_pretrained(self.model_id, device_map="auto")
        return self

    def image_to_text(self, image) -> str:
        """image: PIL.Image. The card's template takes {"type":"image","url":...}; we pass a data
        file path via a temp PNG so no network fetch is needed."""
        import tempfile
        self.load()
        with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
            image.convert("RGB").save(tmp.name)
            messages = [{"role": "user", "content": [
                {"type": "image", "url": tmp.name}, {"type": "text", "text": self.PROMPT}]}]
            inputs = self._tok.apply_chat_template(
                messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt"
            ).to(self._model.device)
            out = self._model.generate(**inputs, max_new_tokens=self.max_new_tokens)
        return self._tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()


# ---------------------------------------------------------------- optional Gemini structuring
def gemini_structure(text: str, api_key: str | None = None, model: str | None = None) -> dict | None:
    """Ask Gemini to turn raw receipt text into {"lines":[{name,quantity,price}],"total"}.
    Returns None if no key is configured or anything fails (caller keeps the deterministic parse).
    Uses the REST API via urllib so no SDK is required."""
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    import urllib.request
    # GEMINI_MODEL is shared with the backend (.env; decided in docs/DECISIONS.md). The fallback is
    # Google's moving alias, so an unset variable never points at a retired id.
    model = model or os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
    prompt = ("Extract grocery line items from this receipt text. Keep item names exactly as printed "
              "(abbreviations unchanged). Exclude coupons/discounts/tax/subtotal. Reply JSON only: "
              '{"lines":[{"name":str,"quantity":number|null,"price":number|null}],"total":number|null}\n\n' + text)
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"responseMimeType": "application/json"}}).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = json.load(r)["candidates"][0]["content"]["parts"][0]["text"]
        return clean_structured(json.loads(txt))
    except Exception:
        return None


def _to_num(v):
    """Gemini sometimes answers "3.48", "$3.48" or "1,29" instead of a number; None if unusable."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"-?\d+(?:[.,]\d+)?", v.replace("$", ""))
        if m:
            return float(m.group(0).replace(",", "."))
    return None


def clean_structured(d) -> dict | None:
    """Validate a Gemini receipt answer into {"lines":[{name,quantity,price}],"total"} with real
    numbers, so the backend never has to guess types. None if the shape is unusable."""
    if not isinstance(d, dict) or not isinstance(d.get("lines"), list):
        return None
    lines = []
    for l in d["lines"]:
        if not isinstance(l, dict) or not str(l.get("name") or "").strip():
            continue
        q = _to_num(l.get("quantity"))
        lines.append({"name": str(l["name"]).strip(), "quantity": q if q and q > 0 else None,
                      "price": _to_num(l.get("price"))})
    return {"lines": lines, "total": _to_num(d.get("total"))}


def receipt_from_image(image, engine=None, use_gemini: bool = True) -> dict:
    """Full pipeline. Returns {"lines","total","raw_text"} (lines: name/quantity/price only)."""
    engine = engine or GlmOcrEngine()
    raw = engine.image_to_text(image)
    parsed = parse_receipt_text(raw)
    if use_gemini:
        g = gemini_structure(raw)
        if g and g.get("lines"):
            parsed = {"lines": g["lines"], "total": g.get("total", parsed["total"])}
    lines = [{"name": str(l.get("name", "")), "quantity": l.get("quantity"), "price": l.get("price")}
             for l in parsed["lines"]]
    return {"lines": lines, "total": parsed["total"], "raw_text": raw}
