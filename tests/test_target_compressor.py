import io
import os
import random
import pytest
from pathlib import Path
from PIL import Image, ImageDraw
import pillow_heif
from starlette.testclient import TestClient

from backend.main import app
from backend.services.image_service import compress_to_target_size

client = TestClient(app)

def create_complex_image(width: int = 800, height: int = 600, mode: str = "RGB") -> Image.Image:
    """Create an image with visual texture/noise so quality adjustments produce real file size differences."""
    img = Image.new(mode, (width, height), (30, 40, 50) if mode == "RGB" else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Add colored rectangles
    for i in range(120):
        x0 = random.randint(0, width - 80)
        y0 = random.randint(0, height - 80)
        color = (
            random.randint(50, 255),
            random.randint(50, 255),
            random.randint(50, 255),
            random.randint(150, 255) if mode == "RGBA" else None
        )
        fill = color if mode == "RGBA" else color[:3]
        draw.rectangle([x0, y0, x0 + 70, y0 + 70], fill=fill)
    return img

@pytest.fixture
def complex_jpg_bytes() -> bytes:
    img = create_complex_image(800, 600, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()

@pytest.fixture
def transparent_png_bytes() -> bytes:
    img = create_complex_image(600, 450, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

@pytest.fixture
def real_heic_bytes() -> bytes:
    img = create_complex_image(400, 300, "RGB")
    buf = io.BytesIO()
    pillow_heif.from_pillow(img).save(buf, format="HEIF")
    return buf.getvalue()

# --- TARGET SIZE COMPRESSOR TESTS ---

def test_compress_jpg_target_size(complex_jpg_bytes, tmp_path):
    orig_size = len(complex_jpg_bytes)
    target_bytes = 40 * 1024  # 40 KB target

    res = compress_to_target_size(
        input_bytes=complex_jpg_bytes,
        original_filename="photo.jpg",
        target_size_bytes=target_bytes,
        output_format="jpg",
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    out_size = out_file.stat().st_size
    assert out_size <= target_bytes
    assert res["stats"]["output_format"] == "JPG"
    assert res["stats"]["original_size"] == orig_size
    assert res["stats"]["target_size"] == target_bytes
    assert res["stats"]["output_size"] == out_size
    assert res["stats"]["percent_saved"] > 0
    # Verify valid JPEG
    out_img = Image.open(out_file)
    assert out_img.format == "JPEG"
    assert out_img.size == (800, 600)

def test_compress_webp_target_size(complex_jpg_bytes, tmp_path):
    target_bytes = 30 * 1024  # 30 KB target

    res = compress_to_target_size(
        input_bytes=complex_jpg_bytes,
        original_filename="scenery.jpg",
        target_size_bytes=target_bytes,
        output_format="webp",
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    out_file = Path(res["output_path"])
    assert out_file.stat().st_size <= target_bytes
    assert res["stats"]["output_format"] == "WEBP"
    out_img = Image.open(out_file)
    assert out_img.format == "WEBP"

def test_image_already_smaller_than_target(tmp_path):
    # Create small image (e.g. 5 KB)
    img = Image.new("RGB", (100, 100), color=(100, 200, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    small_bytes = buf.getvalue()
    small_size = len(small_bytes)

    # Ask for 2 MB target
    target_bytes = 2 * 1024 * 1024

    res = compress_to_target_size(
        input_bytes=small_bytes,
        original_filename="small.jpg",
        target_size_bytes=target_bytes,
        output_format="jpg",
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    assert "already smaller than the target size" in res["target_explanation"]
    # Make sure we didn't artificially bloat the file
    out_file = Path(res["output_path"])
    assert out_file.stat().st_size <= small_size + 100

def test_transparent_png_lossless_when_fits(tmp_path):
    # Small transparent icon
    img = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([10, 10, 70, 70], fill=(255, 0, 0, 180))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    # Target 500 KB (easily fits)
    target_bytes = 500 * 1024

    res = compress_to_target_size(
        input_bytes=png_bytes,
        original_filename="icon.png",
        target_size_bytes=target_bytes,
        output_format="png",
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    assert res["stats"]["output_format"] == "PNG"
    out_img = Image.open(res["output_path"])
    assert out_img.format == "PNG"
    assert out_img.mode in ("RGBA", "P")

def create_patterned_transparent_png() -> bytes:
    img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i in range(200):
        draw.line([(i * 2, 0), (400, i * 2)], fill=(i % 256, (i * 3) % 256, (i * 5) % 256, 200), width=3)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def test_transparent_png_fallback_to_webp(tmp_path):
    # Patterned PNG is ~8.5 KB lossless, ~6.2 KB quantized; target 4 KB forces WebP conversion
    pattern_png = create_patterned_transparent_png()
    target_bytes = 4 * 1024

    res = compress_to_target_size(
        input_bytes=pattern_png,
        original_filename="pattern_transparent.png",
        target_size_bytes=target_bytes,
        output_format="png",
        allow_png_fallback=True,
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    assert res["stats"]["output_format"] in ("WEBP", "JPG")
    out_img = Image.open(res["output_path"])
    if out_img.format == "WEBP":
        assert out_img.mode == "RGBA"
    assert res["fidelity_warning"] is not None
    assert "Converted to" in res["fidelity_warning"]

def test_png_fallback_disallowed(tmp_path):
    # Patterned PNG is ~8.5 KB lossless, target 4 KB with fallback disabled
    pattern_png = create_patterned_transparent_png()
    target_bytes = 4 * 1024

    res = compress_to_target_size(
        input_bytes=pattern_png,
        original_filename="pattern_transparent.png",
        target_size_bytes=target_bytes,
        output_format="png",
        allow_png_fallback=False,
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    # Must truthfully report target NOT achieved
    assert res["target_achieved"] is False
    assert "lossless PNG" in res["target_explanation"]
    assert res["stats"]["output_format"] == "PNG"

def test_heic_image_target_size(real_heic_bytes, tmp_path):
    target_bytes = 25 * 1024

    res = compress_to_target_size(
        input_bytes=real_heic_bytes,
        original_filename="iphone_shot.heic",
        target_size_bytes=target_bytes,
        output_format="jpg",
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    assert res["target_achieved"] is True
    out_file = Path(res["output_path"])
    assert out_file.stat().st_size <= target_bytes
    out_img = Image.open(out_file)
    assert out_img.format == "JPEG"
    assert out_img.size == (400, 300)

def test_impossible_target_truthful_reporting(complex_jpg_bytes, tmp_path):
    # Ask for 500 bytes on an 800x600 complex image (impossible without massive downsizing)
    impossible_target = 500

    res = compress_to_target_size(
        input_bytes=complex_jpg_bytes,
        original_filename="big.jpg",
        target_size_bytes=impossible_target,
        output_format="jpg",
        auto_downscale=False,
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    # MUST NOT claim target achieved
    assert res["target_achieved"] is False
    assert "too aggressive" in res["target_explanation"]
    assert res["stats"]["quality_used"] == 5

def test_optional_max_dimensions(complex_jpg_bytes, tmp_path):
    res = compress_to_target_size(
        input_bytes=complex_jpg_bytes,
        original_filename="big.jpg",
        target_size_bytes=50 * 1024,
        output_format="jpg",
        max_width=400,
        max_height=300,
        custom_output_dir=str(tmp_path)
    )

    assert res["success"] is True
    out_img = Image.open(res["output_path"])
    assert out_img.width <= 400
    assert out_img.height <= 300
    # Aspect ratio check (800x600 is 4:3 -> 400x300)
    assert out_img.size == (400, 300)

def test_invalid_input(tmp_path):
    res = compress_to_target_size(
        input_bytes=b"",
        original_filename="empty.jpg",
        target_size_bytes=1000,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is False

    corrupt_res = compress_to_target_size(
        input_bytes=b"not an image",
        original_filename="corrupt.jpg",
        target_size_bytes=1000,
        custom_output_dir=str(tmp_path)
    )
    assert corrupt_res["success"] is False

# --- API ENDPOINT TESTS ---

def test_api_compress_target_size_batch(complex_jpg_bytes, tmp_path):
    response = client.post(
        "/api/images/compress-target-size",
        data={
            "target_size_kb": "45",
            "output_format": "jpg",
            "allow_png_fallback": "true",
            "auto_downscale": "false",
            "custom_output_dir": str(tmp_path)
        },
        files=[
            ("files", ("img1.jpg", complex_jpg_bytes, "image/jpeg")),
            ("files", ("img2.jpg", complex_jpg_bytes, "image/jpeg")),
        ]
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 2
    for r in data["results"]:
        assert r["success"] is True
        assert r["target_achieved"] is True
        assert r["stats"]["output_size"] <= 45 * 1024

def test_api_download_endpoint(tmp_path):
    test_file = tmp_path / "download_me.txt"
    test_file.write_text("Hello download")

    res = client.get(f"/api/system/download?path={str(test_file)}")
    assert res.status_code == 200
    assert res.content == b"Hello download"

# --- 10 ACCEPTANCE CRITERIA VERIFICATION TESTS ---

def test_workflow_req1_standard_compression_default(complex_jpg_bytes, tmp_path):
    """Req 1: Standard compression works without specifying a target size."""
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "auto",
            "quality": "80",
            "enable_resize": "false",
            "enable_target_size": "false",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("photo.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    assert res["stats"]["output_format"] == "JPG"
    assert res["stats"]["output_size"] > 0
    assert Path(res["output_path"]).exists()

def test_workflow_req2_custom_target_size(complex_jpg_bytes, tmp_path):
    """Req 2: Custom target-size compression works when enabled."""
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "enable_target_size": "true",
            "target_size_kb": "35",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("scenic.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    assert res["target_achieved"] is True
    assert res["stats"]["output_size"] <= 35 * 1024

def test_workflow_req3_kb_and_mb_inputs(complex_jpg_bytes, tmp_path):
    """Req 3: Custom KB and MB inputs are interpreted correctly."""
    # 50 KB
    res_kb = client.post(
        "/api/images/process",
        data={
            "enable_target_size": "true",
            "target_size_kb": "50",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("kb_test.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert res_kb.status_code == 200
    assert res_kb.json()["results"][0]["stats"]["target_size"] == 50 * 1024

    # 1.5 MB = 1536 KB
    res_mb = client.post(
        "/api/images/process",
        data={
            "enable_target_size": "true",
            "target_size_kb": str(1.5 * 1024),
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("mb_test.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert res_mb.status_code == 200
    assert res_mb.json()["results"][0]["stats"]["target_size"] == int(1.5 * 1024 * 1024)

def test_workflow_req4_resize_pixels(complex_jpg_bytes, tmp_path):
    """Req 4: Resize by pixels changes real output dimensions."""
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "enable_resize": "true",
            "resize_mode": "pixels",
            "target_width": "300",
            "target_height": "200",
            "maintain_aspect_ratio": "false",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("resize_px.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    assert res["stats"]["output_dimensions"] == {"width": 300, "height": 200}
    with Image.open(res["output_path"]) as img:
        assert img.size == (300, 200)

def test_workflow_req5_resize_percentage(complex_jpg_bytes, tmp_path):
    """Req 5: Resize by percentage changes real output dimensions."""
    # Original is 800x600, 25% -> 200x150
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "enable_resize": "true",
            "resize_mode": "percentage",
            "resize_percentage": "25",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("percent_test.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    assert res["stats"]["output_dimensions"] == {"width": 200, "height": 150}
    with Image.open(res["output_path"]) as img:
        assert img.size == (200, 150)

def test_workflow_req6_aspect_ratio_preservation(complex_jpg_bytes, tmp_path):
    """Req 6: Aspect ratio is preserved when enabled."""
    # 800x600 (4:3) with target_width=400, target_height=500 and aspect ratio maintained -> should be 400x300
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "enable_resize": "true",
            "resize_mode": "pixels",
            "target_width": "400",
            "target_height": "500",
            "maintain_aspect_ratio": "true",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("aspect.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["stats"]["output_dimensions"] == {"width": 400, "height": 300}
    with Image.open(res["output_path"]) as img:
        assert img.size == (400, 300)

def test_workflow_req7_no_method_not_allowed(complex_jpg_bytes, tmp_path):
    """Req 7: Verify all endpoints return 200 OK (no 405 Method Not Allowed) for both slash and no-slash."""
    endpoints = [
        "/api/images/process",
        "/api/images/process/",
        "/api/images/compress-target-size",
        "/api/images/compress-target-size/",
    ]
    for ep in endpoints:
        data = {
            "target_format": "jpg",
            "target_size_kb": "50",
            "custom_output_dir": str(tmp_path)
        }
        res = client.post(ep, data=data, files=[("files", ("test.jpg", complex_jpg_bytes, "image/jpeg"))])
        assert res.status_code == 200, f"Endpoint {ep} failed with {res.status_code}"

def test_workflow_req8_download_openable(complex_jpg_bytes, tmp_path):
    """Req 8: Download produces a valid, openable output file."""
    response = client.post(
        "/api/images/process",
        data={"target_format": "jpg", "quality": "80", "custom_output_dir": str(tmp_path)},
        files=[("files", ("download_src.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    out_path = response.json()["results"][0]["output_path"]
    download_res = client.get(f"/api/system/download?path={out_path}")
    assert download_res.status_code == 200
    with Image.open(io.BytesIO(download_res.content)) as im:
        assert im.format == "JPEG"

def test_workflow_req9_png_transparency_to_jpeg(transparent_png_bytes, tmp_path):
    """Req 9: PNG transparency is handled correctly when converting to JPEG (no black square artifacts)."""
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "bg_color_hex": "#ffffff",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("trans.png", transparent_png_bytes, "image/png"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    with Image.open(res["output_path"]) as im:
        assert im.format == "JPEG"
        assert im.mode == "RGB"

def test_workflow_req10_impossible_target_honesty(complex_jpg_bytes, tmp_path):
    """Req 10: Impossible target sizes are reported honestly with warning."""
    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "enable_target_size": "true",
            "target_size_kb": "0.1",  # 100 bytes - impossible for 800x600 photo
            "auto_downscale": "false",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("impossible.jpg", complex_jpg_bytes, "image/jpeg"))]
    )
    assert response.status_code == 200
    res = response.json()["results"][0]
    assert res["success"] is True
    assert res["target_achieved"] is False
    assert "too aggressive" in res["target_explanation"]

