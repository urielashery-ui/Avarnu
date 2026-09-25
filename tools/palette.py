# החלפת ערכת צבעים בכל האתר (דף, מיילים, אייקון) בפעולה אחת.
# שימוש: python3 tools/palette.py <שם>   (אפשרויות: indigo, royal, violet)
import sys, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["src/app.html", "build.mjs", "server/connectors/email.js", "server/movers.js", "server/admin.js"]
# מפתח = הצבע הירוק הנוכחי. ירוק של "הצלחה" (✓) נשאר ירוק בכוונה.
KEYS = "0D4735 177A58 3DBE82 12704E 13261E 4D5E56 76857D E3F2EA E2F4EA EAF6EF D5E6DC D5EDE1 0B6E4F FAF7F0 F4EFE4 E3DCCD 07130E 0E2019 132B22 21443A EAF7F0 A8C6B8 7FA597 6FD8A6 04150E 12372B 10342A 0A2E22 0F4533 2FB47C".split()
RGBA = ["5,18,13", "120,224,170", "61,190,130", "13,71,53", "19,38,30", "0,30,20"]
P = {
 "indigo": ("101A44 27368F 5B6CFF 3040C4 141A33 50576E 7A8199 E8EBFF ECEEFF EEF0FF DADFFA D7DCF7 3040C4 F8F7FB F0EEF6 E2DFEC 080B1C 10152E 161C3B 2A3260 EEF0FF B3B9DA 8A91BA 9AA6FF 070A1C 1D2555 1A2150 0B1233 18215A 6C7BFF",
            ["8,10,30", "120,140,255", "91,108,255", "16,26,68", "20,26,51", "5,10,40"], {"--btn:#FFC23D": "--btn:#FF8A3D"}),
 "royal":  ("0A2463 1452CC 3D8BFF 1452CC 0F1B33 4F5B70 78839A E6EEFF EAF1FF EDF3FF D6E2FA D6E4FA 1452CC F7F9FC EEF2F8 DDE3EE 060D1E 0D1830 122040 233A66 EEF4FF AFC0DE 8398C0 7FB0FF 04112A 14305E 132C58 081A40 0F2E6B 4D8DFF",
            ["4,12,30", "110,170,255", "61,139,255", "10,36,99", "15,27,51", "0,15,45"], {}),
 "violet": ("2A1052 5B21B6 A855F7 6D28D9 1C1430 5A5270 83799B F1E9FF F3ECFF F4EEFF E3D6FA E4D9FB 6D28D9 FBF8FD F3EEF8 E6DEEE 0E0718 1A1029 221538 3B2A5E F4EEFF C6B7E0 9D8CC0 C4A1FF 14062A 33205A 2E1C52 1C0B38 3A1880 A06BFF",
            ["16,6,30", "190,140,255", "168,85,247", "42,16,82", "28,20,48", "25,5,45"], {}),
}
def apply(name, root=ROOT):
    hexes, rgbas, extra = P[name]; hexes = hexes.split()
    assert len(hexes) == len(KEYS) and len(rgbas) == len(RGBA)
    for f in FILES:
        p = root / f
        if not p.exists(): continue
        s = p.read_text()
        for a, b in zip(KEYS, hexes): s = re.sub("#" + a + r"\b", "#" + b, s, flags=re.I)
        for a, b in zip(RGBA, rgbas): s = s.replace("rgba(" + a + ",", "rgba(" + b + ",")
        for a, b in extra.items(): s = s.replace(a, b)
        p.write_text(s)
if __name__ == "__main__":
    apply(sys.argv[1], pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT)
    print("palette:", sys.argv[1])
