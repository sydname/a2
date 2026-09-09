#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
아르카나 '상세 강화 내역'만 따로 수집한다. (자주 바뀌지 않으므로 수동 실행 전용)

GitHub Actions 의 'arcana' 워크플로를 Run workflow 로 눌렀을 때만 돌아가고,
결과를 docs/data/arcana.json 에 커밋한다. 사이트 카드뷰 아르카나 구획이 이 파일을 읽는다.

캐릭터 1명당: equipment 1회 + 착용 아르카나 수(최대 12)만큼 item 상세 호출.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://aion2.plaync.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
URL_RE = re.compile(r"/characters/(\d+)/([^/?#\s]+)")
ARCANA_RE = re.compile(r"^Arcana(\d+)$")


def http_get_json(path, params, referer, retries=4):
    url = "%s%s?%s" % (BASE, path, urllib.parse.urlencode(params))
    headers = {
        "User-Agent": UA, "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", "Referer": referer, "Origin": BASE,
    }
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            if 400 <= e.code < 500 and e.code != 429:
                break
        except Exception as e:  # noqa: BLE001
            last = "%s %s" % (type(e).__name__, e)
        time.sleep(1.5 * (i + 1) + random.uniform(0, 1))
    raise RuntimeError(last or "unknown error")


def parse_target(entry):
    if entry.get("serverId") and entry.get("characterId"):
        return str(entry["serverId"]), str(entry["characterId"])
    m = URL_RE.search(entry.get("url", ""))
    if not m:
        raise ValueError("url 파싱 실패")
    cid = urllib.parse.unquote(m.group(2))
    cid.encode("ascii")
    if "PASTE_" in cid:
        raise ValueError("예시 주소")
    return m.group(1), cid


def key_of(sid, cid):
    return "%s-%s" % (sid, hashlib.sha1(str(cid).encode()).hexdigest()[:12])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="characters.json")
    ap.add_argument("--out", default="docs/data")
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    lang = cfg.get("language", "ko")
    entries = cfg.get("characters", [])

    result = {}
    errors = []
    for i, entry in enumerate(entries):
        label = entry.get("label", "?")
        try:
            sid, cid = parse_target(entry)
        except Exception as e:  # noqa: BLE001
            print("  [SKIP] %s : %s" % (label, e), file=sys.stderr)
            continue
        referer = "%s/ko-kr/characters/%s/%s" % (BASE, sid, cid)
        base_params = {"lang": lang, "characterId": cid, "serverId": sid}
        try:
            equip = http_get_json("/api/character/equipment", base_params, referer)
            eq_list = (equip.get("equipment", {}) or {}).get("equipmentList", []) or []
            arc_slots = []
            for it in eq_list:
                m = ARCANA_RE.match(it.get("slotPosName", "") or "")
                if m:
                    arc_slots.append((it, 40 + int(m.group(1))))
            arc_slots.sort(key=lambda x: x[1])

            details = []
            for it, slot_pos in arc_slots:
                time.sleep(random.uniform(0.7, 1.5))
                p = dict(base_params)
                p.update({"id": it.get("id"), "enchantLevel": it.get("enchantLevel") or 0,
                          "slotPos": slot_pos})
                try:
                    d = http_get_json("/api/character/equipment/item", p, referer)
                except Exception as e:  # noqa: BLE001
                    print("    [arc fail] %s %s : %s" % (label, it.get("name"), e), file=sys.stderr)
                    continue
                st = d.get("set") or {}
                details.append({
                    "slot": it.get("slotPosName"),
                    "slotKo": "아르카나%d" % (slot_pos - 40),
                    "name": d.get("name"), "grade": d.get("grade"),
                    "icon": d.get("icon"), "category": d.get("categoryName"),
                    "enchant": d.get("enchantLevel"), "maxEnchant": d.get("maxEnchantLevel"),
                    "mainStats": [{
                        "name": s.get("name"), "value": s.get("value"), "extra": s.get("extra"),
                    } for s in (d.get("mainStats") or [])],
                    "subSkills": [{
                        "name": s.get("name"), "level": s.get("level"), "icon": s.get("icon"),
                    } for s in (d.get("subSkills") or [])],
                    "set": {
                        "name": st.get("name"),
                        "equippedCount": st.get("equippedCount"),
                        "bonuses": [{
                            "degree": b.get("degree"),
                            "descriptions": b.get("descriptions") or [],
                        } for b in (st.get("bonuses") or [])],
                    } if st else None,
                })

            # 방어구 7부위 영혼각인(subStats) + 전체 장착장비의 영혼각인 스킬 합계
            ARMOR_KO = {"Helmet": "투구", "Shoulder": "견갑", "Torso": "상의", "Pants": "하의",
                        "Gloves": "장갑", "Boots": "신발", "Cape": "망토"}
            ARMOR_ORDER = ["Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape"]
            eq_by_slot = {it.get("slotPosName"): it for it in eq_list}
            gear_items = [it for it in eq_list
                          if not ARCANA_RE.match(it.get("slotPosName", "") or "")]

            item_detail = {}
            for it in gear_items:
                time.sleep(random.uniform(0.6, 1.3))
                p = dict(base_params)
                p.update({"id": it.get("id"), "enchantLevel": it.get("enchantLevel") or 0,
                          "slotPos": it.get("slotPos")})
                try:
                    item_detail[it.get("slotPosName")] = http_get_json(
                        "/api/character/equipment/item", p, referer)
                except Exception as e:  # noqa: BLE001
                    print("    [item fail] %s %s : %s" % (label, it.get("slotPosName"), e), file=sys.stderr)

            soul = []
            for slot_name in ARMOR_ORDER:
                d = item_detail.get(slot_name)
                it = eq_by_slot.get(slot_name)
                if not d:
                    soul.append({"slot": slot_name, "slotKo": ARMOR_KO[slot_name],
                                 "name": it.get("name") if it else None,
                                 "subStatCount": None, "subStats": []})
                    continue
                soul.append({
                    "slot": slot_name, "slotKo": ARMOR_KO[slot_name],
                    "name": d.get("name"), "grade": d.get("grade"),
                    "subStatCount": d.get("subStatCount"),
                    "subStats": [{"name": s.get("name"), "value": s.get("value")}
                                 for s in (d.get("subStats") or [])],
                })

            equip_skills = {}
            for d in item_detail.values():
                for s in (d.get("subSkills") or []):
                    nm = s.get("name")
                    if nm:
                        equip_skills[nm] = equip_skills.get(nm, 0) + int(s.get("level") or 0)

            result[key_of(sid, cid)] = {
                "label": label,
                "updatedAt": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                "arcana": details,
                "soul": soul,
                "equipSkills": equip_skills,
            }
            print("  [OK]   %s  아르카나 %d개 + 장비 %d부위(스킬 %d종)" % (
                label, len(details), len(item_detail), len(equip_skills)))
        except Exception as e:  # noqa: BLE001
            print("  [FAIL] %s : %s" % (label, e), file=sys.stderr)
            errors.append({"label": label, "error": str(e)})
        if i < len(entries) - 1:
            time.sleep(random.uniform(1.5, 3.0))

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "arcana.json")

    # 실패한 캐릭터는 기존 데이터 유지
    if os.path.exists(out_path):
        try:
            with open(out_path, encoding="utf-8") as f:
                old = json.load(f).get("characters", {})
            for k, v in old.items():
                result.setdefault(k, v)
        except Exception:
            pass

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "generatedAt": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "characters": result,
        }, f, ensure_ascii=False, indent=1)
    print("\n완료: %d명 → %s" % (len(result), out_path))
    if errors and len(errors) >= len(entries):
        sys.exit(1)


if __name__ == "__main__":
    main()
