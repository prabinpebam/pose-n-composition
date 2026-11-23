"""Encode a Blender-baked, unpremultiplied RGBA atlas and package its GLB."""
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

source, dest = map(Path, sys.argv[1:3])
dest.parent.mkdir(parents=True, exist_ok=True)
rgba = np.load(source/"atlas.npy")
if rgba.shape != (2048, 2048, 4) or rgba.dtype != np.uint8:
    raise ValueError("Expected a 2048-square uint8 RGBA atlas")
def chunk(name, data):
    return struct.pack(">I", len(data))+name+data+struct.pack(">I", zlib.crc32(name+data))
pixels = b"".join(b"\x00"+row.tobytes() for row in rgba)
png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", 2048, 2048, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(pixels, 9))+chunk(b"IEND", b"")
dest.with_suffix(".png").write_bytes(png)
raw = (source/"Body.glb").read_bytes()
length = struct.unpack_from("<I", raw, 12)[0]
gltf = json.loads(raw[20:20+length])
skin = next(m for m in gltf["materials"] if m["name"] == "Skin")
for material in gltf["materials"]:
    if material["name"] == "SculptedHair" and "baseColorTexture" not in material["pbrMetallicRoughness"]:
        material["pbrMetallicRoughness"]["baseColorTexture"] = skin["pbrMetallicRoughness"]["baseColorTexture"]
        material["pbrMetallicRoughness"]["baseColorFactor"] = [1, 1, 1, 1]
gltf["asset"]["extras"] = {"studioConversion": "17-joint adult figure; UV0 skin/native hair; UV1 modest outfit atlas"}
data = json.dumps(gltf, separators=(",", ":")).encode()
data += b" "*(-len(data) % 4)
binary = raw[20+length:]
dest.write_bytes(struct.pack("<III", 0x46546c67, 2, 20+len(data)+len(binary))+
                 struct.pack("<II", len(data), 0x4e4f534a)+data+binary)
print(json.dumps({"glb": str(dest), "bytes": dest.stat().st_size,
                  "atlas": str(dest.with_suffix(".png"))}))
