"""Independent QA for PR #79: services/crops.py on hostile input (bombs, truncation, modes, boxes, EXIF)."""
import io
import os
import struct
import tempfile
import warnings

import pytest
from PIL import Image, ImageOps

from app.services import crops


def encode(img, fmt="JPEG", **kw):
    b = io.BytesIO()
    img.save(b, fmt, **kw)
    return b.getvalue()


def quad(size=(160, 96)):
    """Four distinct quadrants so any flip / rotation is visible."""
    w, h = size
    img = Image.new("RGB", size)
    colors = {(0, 0): (255, 0, 0), (1, 0): (0, 255, 0), (0, 1): (0, 0, 255), (1, 1): (255, 255, 0)}
    for (qx, qy), c in colors.items():
        img.paste(c, (qx * w // 2, qy * h // 2, (qx + 1) * w // 2, (qy + 1) * h // 2))
    return img


def with_orientation(img, o, fmt="JPEG"):
    ex = Image.Exif()
    ex[0x0112] = o
    return encode(img, fmt, exif=ex.tobytes(), quality=95)


@pytest.fixture
def ctx(app):
    with app.app_context():
        yield app


def ok(out):
    assert out is not None
    im = Image.open(io.BytesIO(out))
    assert im.format == "JPEG"
    im.load()
    return im


# ---- Pillow's decompression-bomb limit is intact and honoured ---------------------------------------------
def test_module_does_not_disable_max_image_pixels(ctx):
    assert Image.MAX_IMAGE_PIXELS == 89478485, "crops.py must not touch the global bomb limit"


def test_pixel_ceiling_is_checked_from_the_header_before_decoding(ctx, monkeypatch):
    big = encode(Image.new("RGB", (8000, 7000), "white"), "PNG", compress_level=9)  # 56 MP, tiny file
    called = []
    real_load = Image.Image.load
    monkeypatch.setattr(Image.Image, "load", lambda self, *a, **k: called.append(1) or real_load(self, *a, **k))
    assert crops.make(big, [[0, 0, 500, 500]]) == [None]
    assert called == [], "pixel data must not be decoded for an over-limit image"


def test_just_under_limit_works_and_is_bounded(ctx):
    img = encode(Image.new("RGB", (6000, 6000), (10, 200, 10)), "PNG", compress_level=9)  # 36 MP
    out = crops.make(img, [[100, 100, 4000, 4000]])
    im = ok(out[0])
    assert max(im.size) == 512


def test_extreme_bomb_over_pillows_own_limit_is_none_not_500(ctx):
    # 20000 x 20000 1-bit = 400 MP > 2 x MAX_IMAGE_PIXELS: Image.open itself raises DecompressionBombError
    bomb = encode(Image.new("1", (20000, 20000), 1), "PNG", compress_level=9)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # a DecompressionBombWarning must not leak either
        assert crops.make(bomb, [[0, 0, 800, 800]]) == [None]


def test_config_ceiling_lowers_the_limit(ctx, monkeypatch):
    monkeypatch.setitem(ctx.config, "ENRICH_MAX_PIXELS", 10_000)
    assert crops.make(encode(quad((200, 200))), [[0, 0, 150, 150]]) == [None]
    monkeypatch.setitem(ctx.config, "ENRICH_MAX_PIXELS", 10_000_000)
    assert crops.make(encode(quad((200, 200))), [[0, 0, 150, 150]])[0] is not None


# ---- corrupt, truncated and odd inputs ------------------------------------------------------------------------
@pytest.mark.parametrize("data", [b"", b"x", b"\xff\xd8\xff", b"not an image at all" * 100,
                                   # explicit id: xdist workers must collect identical node ids
                                   pytest.param(os.urandom(4096), id="urandom-4096"),
                                   b"GIF89a", b"\x89PNG\r\n\x1a\n" + b"\x00" * 50])
def test_garbage_bytes(ctx, data):
    assert crops.make(data, [[0, 0, 100, 100], None]) == [None, None]


def test_truncated_jpeg_is_none(ctx):
    full = encode(Image.effect_noise((600, 400), 80).convert("RGB"), quality=90)
    for cut in (len(full) // 4, len(full) // 2, len(full) - 20):
        assert crops.make(full[:cut], [[0, 0, 300, 300]]) == [None], cut


def test_truncated_png_is_none(ctx):
    full = encode(Image.effect_noise((600, 400), 80).convert("RGB"), "PNG")
    assert crops.make(full[: len(full) // 2], [[0, 0, 300, 300]]) == [None]


@pytest.mark.parametrize("mode,fmt", [("RGBA", "PNG"), ("LA", "PNG"), ("P", "PNG"), ("L", "JPEG"), ("CMYK", "JPEG"),
                                       ("I;16", "PNG"), ("1", "PNG"), ("RGB", "GIF"), ("RGB", "BMP"), ("RGB", "WEBP")])
def test_modes_and_formats_give_a_valid_jpeg(ctx, mode, fmt):
    src = quad((300, 300)) if mode in ("RGB",) else quad((300, 300)).convert("RGB").convert(mode if mode != "I;16" else "L")
    if mode == "I;16":
        src = Image.frombytes("I;16", (300, 300), struct.pack("<H", 40000) * 90000)
    if mode == "P":
        src = quad((300, 300)).convert("P")
    data = encode(src, fmt)
    out = crops.make(data, [[10, 10, 250, 250]])
    im = ok(out[0])
    assert im.mode == "RGB"


def test_rgba_transparent_png_does_not_crash_and_is_not_all_garbage(ctx):
    img = Image.new("RGBA", (200, 200), (255, 0, 0, 0))
    img.paste((0, 255, 0, 255), (50, 50, 150, 150))
    im = ok(crops.make(encode(img, "PNG"), [[0, 0, 200, 200]])[0])
    assert im.getpixel((im.width // 2, im.height // 2))[1] > 200  # the opaque green centre survives


def test_16bit_png_is_not_blank(ctx):
    """I;16 -> RGB in Pillow clips 16-bit values, which can turn a real photo white. Evidence only: asserts the
    pipeline does not crash; the brightness is reported in docs/qa/backend.md."""
    img = Image.frombytes("I;16", (200, 200), struct.pack("<H", 20000) * 40000)
    im = ok(crops.make(encode(img, "PNG"), [[0, 0, 200, 200]])[0])
    assert im.size[0] > 0


# ---- boxes -----------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("box", [
    None, [], [1, 2, 3], [1, 2, 3, 4, 5], "abcd", {"x": 1}, 5, [0, 0, 0, 0], [10, 10, 10, 100], [10, 10, 100, 10],
    [float("nan")] * 4, [0, 0, float("inf"), 100], [0, 0, -float("inf"), 100], ["a", 0, 10, 10], [[1], 2, 3, 4],
    [None, None, None, None], [-500, -500, -100, -100], [5000, 5000, 6000, 6000], [0, 0, 10, 10], [0, 0, 31, 31],
    [1e308, 1e308, 1.5e308, 1.5e308], [-1e308, -1e308, 1e308, 1e308],
])
def test_bad_boxes_are_none_and_never_raise(ctx, box):
    out = crops.make(encode(quad((300, 300))), [box])
    assert len(out) == 1 and (out[0] is None or ok(out[0]))


def test_nan_and_inf_literals_survive_as_none(ctx):
    img = encode(quad((300, 300)))
    assert crops.make(img, [[float("nan"), 0, 100, 100]]) == [None]


def test_reversed_box_is_normalised(ctx):
    img = encode(quad((300, 300)))
    a = ok(crops.make(img, [[200, 200, 50, 50]])[0])
    b = ok(crops.make(img, [[50, 50, 200, 200]])[0])
    assert a.size == b.size


def test_partly_outside_box(ctx):
    img = encode(quad((300, 300)))
    assert crops.make(img, [[150, 150, 350, 350]])[0] is not None   # 56% inside -> ok
    assert crops.make(img, [[250, 250, 450, 450]])[0] is None        # 25% inside -> frame is wrong


def test_order_and_length_are_preserved_with_mixed_boxes(ctx):
    boxes = [[0, 0, 100, 100], None, [0, 0, 1, 1], [50, 50, 250, 250], "x"]
    out = crops.make(encode(quad((300, 300))), boxes)
    assert [o is not None for o in out] == [True, False, False, True, False]


def test_all_boxes_bad_never_decodes(ctx, monkeypatch):
    monkeypatch.setattr(crops, "_decode", lambda *a: pytest.fail("decoded for nothing"))
    assert crops.make(b"whatever", [None, [0, 0, 0, 0]]) == [None, None]


def test_output_is_capped_and_never_upscaled(ctx):
    big = ok(crops.make(encode(quad((3000, 2000))), [[0, 0, 3000, 2000]])[0])
    assert max(big.size) == 512 and abs(big.size[0] / big.size[1] - 1.5) < 0.02
    small = ok(crops.make(encode(quad((300, 200))), [[0, 0, 100, 100]])[0])
    assert max(small.size) <= 108 + 1


def test_many_boxes_one_bad_decode_does_not_cost_others(ctx, monkeypatch):
    real = crops._cut
    calls = []

    def flaky(img, o, box):
        calls.append(box)
        if len(calls) == 2:
            raise RuntimeError("boom")
        return real(img, o, box)

    monkeypatch.setattr(crops, "_cut", flaky)
    out = crops.make(encode(quad((300, 300))), [[0, 0, 100, 100]] * 3)
    assert [o is not None for o in out] == [True, False, True]


# ---- EXIF orientation: crops come out upright, matching Pillow's own exif_transpose -------------------------------
@pytest.mark.parametrize("o", range(1, 9))
def test_full_frame_crop_equals_exif_transpose(ctx, o):
    src = quad((160, 96))
    data = with_orientation(src, o)
    ref = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    got = ok(crops.make(data, [[0, 0, 160, 96]])[0])
    assert got.size == ref.size, (o, got.size, ref.size)
    w, h = ref.size
    for fx, fy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
        p, q = ref.getpixel((int(w * fx), int(h * fy))), got.getpixel((int(w * fx), int(h * fy)))
        assert all(abs(a - b) < 40 for a, b in zip(p, q)), (o, fx, fy, p, q)


@pytest.mark.parametrize("o", [3, 6, 8])
def test_sub_box_in_raw_frame_is_the_right_pixels_upright(ctx, o):
    """A box over the red quadrant (raw top-left) must yield a red crop whatever the orientation."""
    data = with_orientation(quad((200, 200)), o)
    im = ok(crops.make(data, [[10, 10, 80, 80]])[0])
    r, g, b = im.getpixel((im.width // 2, im.height // 2))
    assert r > 200 and g < 60 and b < 60


def test_corrupt_exif_does_not_lose_the_photo(ctx):
    data = encode(quad((200, 200)))
    # splice a broken APP1 Exif segment right after SOI
    seg = b"\xff\xe1" + struct.pack(">H", 20) + b"Exif\x00\x00" + b"\xde\xad" * 6
    data = data[:2] + seg + data[2:]
    out = crops.make(data, [[0, 0, 100, 100]])
    assert out[0] is None or ok(out[0])


def test_upright_frame_config_transposes_first(ctx, monkeypatch):
    monkeypatch.setitem(ctx.config, "ML_BBOX_FRAME", "upright")
    data = with_orientation(quad((200, 100)), 6)  # upright image is 100 x 200
    im = ok(crops.make(data, [[0, 0, 100, 200]])[0])
    assert im.size == (100, 200)


# ---- privacy: EXIF / GPS / ICC / XMP / comments never reach Gemini -------------------------------------------
def _jpeg_markers(b):
    i, out = 2, []
    while i < len(b) - 3 and b[i] == 0xFF:
        m = b[i + 1]
        if m in (0xDA, 0xD9):
            break
        out.append(m)
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    return out


def test_exif_gps_icc_xmp_comment_are_all_stripped(ctx):
    ex = Image.Exif()
    ex[0x010F], ex[0x0110], ex[0x0112] = "SecretMake", "SecretModel", 6
    ex.get_ifd(0x8825).update({1: "N", 2: (33.0, 0.0, 0.0), 3: "W", 4: (96.0, 0.0, 0.0)})
    ex[0x9003] = "2026:01:01 12:00:00"
    src = Image.new("RGB", (300, 300), (120, 120, 120))
    data = encode(src, exif=ex.tobytes(), icc_profile=b"\x00" * 128 + b"secret-icc")
    data = data[:2] + b"\xff\xe1" + struct.pack(">H", 2 + 29 + 20) + b"http://ns.adobe.com/xap/1.0/\x00" + b"<x:xmpmeta>secret</x:xmpmeta>"[:20] + data[2:]
    assert b"SecretMake" in data and b"ns.adobe.com" in data  # the fixture really has metadata
    out = crops.make(data, [[0, 0, 300, 300]])[0]
    for needle in (b"SecretMake", b"SecretModel", b"Exif", b"GPS", b"secret-icc", b"ICC_PROFILE", b"adobe", b"xmp"):
        assert needle not in out, needle
    im = Image.open(io.BytesIO(out))
    assert len(im.getexif()) == 0 and "icc_profile" not in im.info
    assert set(_jpeg_markers(out)) <= {0xE0, 0xDB, 0xC0, 0xC2, 0xC4}, [hex(m) for m in _jpeg_markers(out)]


def test_jpeg_comment_segment_is_stripped(ctx):
    src = Image.new("RGB", (300, 300), (120, 120, 120))
    data = encode(src, comment=b"secret-comment-text")
    assert b"secret-comment-text" in data
    out = crops.make(data, [[0, 0, 300, 300]])[0]
    assert b"secret-comment-text" not in out


def test_png_text_chunks_do_not_carry_over(ctx):
    from PIL import PngImagePlugin
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Location", "secret-place")
    data = encode(Image.new("RGB", (200, 200), "blue"), "PNG", pnginfo=meta)
    assert b"secret-place" in data
    assert b"secret-place" not in crops.make(data, [[0, 0, 200, 200]])[0]


# ---- nothing is written to disk -------------------------------------------------------------------------------------------------
def test_nothing_touches_the_filesystem(ctx, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    before = (set(os.listdir(tempfile.gettempdir())), set(os.listdir(tmp_path)))
    real_save = Image.Image.save

    def save(self, fp, *a, **k):
        assert isinstance(fp, io.BytesIO), f"save() to {fp!r}"
        return real_save(self, fp, *a, **k)

    monkeypatch.setattr(Image.Image, "save", save)
    monkeypatch.setattr(tempfile, "mkstemp", lambda *a, **k: pytest.fail("tempfile"))
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", lambda *a, **k: pytest.fail("tempfile"))
    monkeypatch.setattr(tempfile, "TemporaryFile", lambda *a, **k: pytest.fail("tempfile"))
    crops.make(with_orientation(quad((300, 300)), 6), [[0, 0, 200, 200], [100, 100, 290, 290]])
    after = (set(os.listdir(tempfile.gettempdir())), set(os.listdir(tmp_path)))
    assert before[1] == after[1] and not (after[0] - before[0])


def test_source_has_no_file_apis():
    import inspect
    src = inspect.getsource(crops)
    for bad in ("open(", "tempfile", "os.", "pathlib", "write(", ".save(\""):
        assert bad not in src.replace("Image.open(io.BytesIO", "").replace("img.save", ""), bad
