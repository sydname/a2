#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
아이온 2 캐릭터 정보 자동 수집기.

characters.json 에 적힌 캐릭터들의 공식 홈페이지 비공식 JSON API 를 호출해서
docs/data/all.json (사이트가 읽는 파일) 과 docs/data/index.json (요약) 을 만든다.

- 외부 라이브러리 없음(파이썬 표준 라이브러리만) → GitHub Actions 에서 pip install 불필요
- 캐릭터 한 명이 실패해도 나머지는 계속 진행, 실패한 캐릭터는 직전 데이터 유지
- 자동 수집 항목만 만든다. 오드/체크박스/잠재력 같은 수동 값은 manual.json (프론트에서 병합)

사용법:
    python scripts/fetch.py
    python scripts/fetch.py --config characters.json --out docs/data
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

# 장비 슬롯 한글 이름
SLOT_KO = {
    "MainHand": "무기", "SubHand": "가더",
    "Helmet": "투구", "Shoulder": "견갑", "Torso": "상의", "Pants": "하의",
    "Gloves": "장갑", "Boots": "신발", "Cape": "망토",
    "Pendant": "펜던트", "Necklace": "목걸이",
    "Earring1": "귀걸이1", "Earring2": "귀걸이2",
    "Ring1": "반지1", "Ring2": "반지2",
    "Bracelet1": "팔찌1", "Bracelet2": "팔찌2",
    "Belt": "허리띠", "Brooch1": "브로치1", "Brooch2": "브로치2",
    "Amulet": "인장", "Rune1": "룬1", "Rune2": "룬2",
}
for _i in range(1, 13):
    SLOT_KO["Arcana%d" % _i] = "아르카나%d" % _i

# 돌파 그룹 (카드뷰 요약용)
WEAPON_SLOTS = {"MainHand", "SubHand"}
ARMOR_SLOTS = {"Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape"}
ACCESSORY_SLOTS = {"Necklace", "Earring1", "Earring2", "Ring1", "Ring2",
                   "Bracelet1", "Bracelet2", "Brooch1", "Brooch2"}

# 강화관리 표에 쓰는 돌파 슬롯 순서
BREAKTHROUGH_SLOTS = ["MainHand", "SubHand", "Necklace", "Earring1", "Earring2",
                      "Ring1", "Ring2", "Bracelet1", "Bracelet2", "Brooch1", "Brooch2"]

# 데바니온 보드 (보드 ID 는 직업마다 다르므로 이름으로 매칭)
DAEV_BASIC_NAMES = {"네자칸", "지켈", "바이젤", "트리니엘"}
DAEV_YUSTIEL_NAME = "유스티엘"

ARCANA_RE = re.compile(r"^Arcana\d+$")


# ---------------------------------------------------------------------------
def http_get_json(path, params, referer, retries=4):
    url = "%s%s?%s" % (BASE, path, urllib.parse.urlencode(params))
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": referer,
        "Origin": BASE,
    }
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            last_err = "HTTP %s %s %s" % (e.code, url, body)
            if 400 <= e.code < 500 and e.code != 429:
                break
        except Exception as e:  # noqa: BLE001
            last_err = "%s %s" % (type(e).__name__, e)
        time.sleep(1.5 * (attempt + 1) + random.uniform(0, 1.0))
    raise RuntimeError(last_err or "unknown error")


def parse_target(entry):
    if entry.get("serverId") and entry.get("characterId"):
        return str(entry["serverId"]), str(entry["characterId"])
    url = entry.get("url", "")
    m = URL_RE.search(url)
    if not m:
        raise ValueError("url 에서 serverId/characterId 를 찾지 못했습니다: %r" % url)
    server_id, character_id = m.group(1), urllib.parse.unquote(m.group(2))
    try:
        character_id.encode("ascii")
    except UnicodeEncodeError:
        raise ValueError("characterId 가 올바르지 않습니다(한글 포함). 공식 페이지 주소를 다시 복사하세요.")
    if "PASTE_" in character_id:
        raise ValueError("characters.json 의 예시 주소를 실제 캐릭터 주소로 바꿔주세요.")
    return server_id, character_id


def char_key(server_id, character_id):
    return "%s-%s" % (server_id, hashlib.sha1(str(character_id).encode()).hexdigest()[:12])


def stat_value(stat_list, type_name):
    for s in stat_list or []:
        if s.get("type") == type_name:
            return s.get("value")
    return None


def summarize_exceed(equip_by_slot, slot_set):
    slots, total = [], 0
    for name in sorted(slot_set):
        it = equip_by_slot.get(name)
        if not it:
            continue
        exceed = int(it.get("exceedLevel") or 0)
        total += exceed
        slots.append({
            "slot": name, "slotKo": SLOT_KO.get(name, name),
            "name": it.get("name"), "grade": it.get("grade"),
            "enchant": it.get("enchantLevel"), "exceed": exceed, "icon": it.get("icon"),
        })
    return {"total": total, "count": len(slots), "slots": slots}


def build_record(entry, info, equip):
    profile = info.get("profile", {}) or {}
    stat_list = (info.get("stat", {}) or {}).get("statList", []) or []
    equip_list = (equip.get("equipment", {}) or {}).get("equipmentList", []) or []
    petwing = equip.get("petwing", {}) or {}
    skill_list = (equip.get("skill", {}) or {}).get("skillList", []) or []
    title = info.get("title", {}) or {}
    daev_boards = (info.get("daevanion", {}) or {}).get("boardList", []) or []

    item_level = profile.get("itemLevel") or stat_value(stat_list, "ItemLevel")
    equip_by_slot = {it.get("slotPosName"): it for it in equip_list}

    # 전체 장비 목록
    equipment = []
    for it in sorted(equip_list, key=lambda x: x.get("slotPos", 999)):
        name = it.get("slotPosName", "")
        equipment.append({
            "slotPos": it.get("slotPos"), "slot": name,
            "slotKo": SLOT_KO.get(name, name), "name": it.get("name"),
            "grade": it.get("grade"), "enchant": it.get("enchantLevel"),
            "exceed": it.get("exceedLevel"), "icon": it.get("icon"),
            "isArcana": bool(ARCANA_RE.match(name)),
        })
    arcana = [e for e in equipment if e["isArcana"]]

    weapon = summarize_exceed(equip_by_slot, WEAPON_SLOTS)
    armor = summarize_exceed(equip_by_slot, ARMOR_SLOTS)
    accessory = summarize_exceed(equip_by_slot, ACCESSORY_SLOTS)

    # 강화관리 표: 슬롯별 돌파 + 팬던트 강화수치
    bt = {}
    for name in BREAKTHROUGH_SLOTS:
        it = equip_by_slot.get(name)
        bt[name] = int(it.get("exceedLevel") or 0) if it else None
    pend = equip_by_slot.get("Pendant")
    amul = equip_by_slot.get("Amulet")
    breakthrough = {
        "bySlot": bt,
        "pendantEnchant": int(pend.get("enchantLevel") or 0) if pend else None,
        "amuletEnchant": int(amul.get("enchantLevel") or 0) if amul else None,
    }

    # 스티그마 = skillList category "Dp"/"Stigma" 중 장착(equip==1), 레벨 내림차순 상위 6
    stig = [s for s in skill_list if s.get("category") in ("Dp", "Stigma") and s.get("equip")]
    stig.sort(key=lambda s: (s.get("skillLevel") or 0), reverse=True)
    stigma = [{
        "name": s.get("name"), "level": s.get("skillLevel"),
        "icon": s.get("icon"), "id": s.get("id"),
    } for s in stig[:6]]

    # 데바니온 (보드 이름으로 매칭)
    def board_nodes_by_name(name):
        for b in daev_boards:
            if b.get("name") == name:
                return int(b.get("openNodeCount") or 0)
        return 0
    daev = {
        "openedBoards": sum(1 for b in daev_boards if b.get("open")),
        "totalBoards": len(daev_boards),
        "openNodeTotal": sum(int(b.get("openNodeCount") or 0) for b in daev_boards),
        "nodeTotal": sum(int(b.get("totalNodeCount") or 0) for b in daev_boards),
        "basic": sum(board_nodes_by_name(n) for n in DAEV_BASIC_NAMES),
        "yustiel": board_nodes_by_name(DAEV_YUSTIEL_NAME),
        "boards": [{
            "id": b.get("id"), "name": b.get("name"), "icon": b.get("icon"),
            "open": b.get("open"), "openNodeCount": b.get("openNodeCount"),
            "totalNodeCount": b.get("totalNodeCount"), "openPercent": b.get("openPercent"),
        } for b in daev_boards],
    }

    titles = {
        "ownedCount": title.get("ownedCount"), "totalCount": title.get("totalCount"),
        "equipped": [{
            "category": t.get("equipCategory"), "name": t.get("name"),
            "grade": t.get("grade"), "ownedPercent": t.get("ownedPercent"),
        } for t in (title.get("titleList") or [])],
    }
    stats = [{
        "type": s.get("type"), "name": s.get("name"), "value": s.get("value"),
        "effects": s.get("statSecondList") or [],
    } for s in stat_list if s.get("type") != "ItemLevel"]

    server_id, character_id = parse_target(entry)
    return {
        "key": char_key(server_id, character_id),
        "label": entry.get("label") or profile.get("characterName") or character_id,
        "serverId": int(server_id),
        "serverName": profile.get("serverName"),
        "characterId": character_id,
        "officialUrl": "%s/ko-kr/characters/%s/%s" % (
            BASE, server_id, urllib.parse.quote(str(character_id), safe="=")),
        "profile": {
            "name": profile.get("characterName"),
            "level": profile.get("characterLevel"),
            "className": profile.get("className"),
            "raceName": profile.get("raceName"),
            "genderName": profile.get("genderName"),
            "guildName": profile.get("regionName"),
            "combatPower": profile.get("combatPower"),
            "itemLevel": item_level,
            "profileImage": profile.get("profileImage"),
            "titleName": profile.get("titleName"),
        },
        "exceed": {"weapon": weapon, "armor": armor, "accessory": accessory},
        "breakthrough": breakthrough,
        "stigma": stigma,
        "daevanion": daev,
        "arcana": arcana,
        "equipment": equipment,
        "petwing": {"pet": petwing.get("pet"), "wing": petwing.get("wing"),
                    "wingSkin": petwing.get("wingSkin")},
        "titles": titles,
        "stats": stats,
    }


# --------------------------- history / delta -------------------------------
def kst_today():
    return (dt.datetime.utcnow() + dt.timedelta(hours=9)).strftime("%Y-%m-%d")


def snapshot_row(rec):
    return {
        "date": kst_today(),
        "combatPower": rec["profile"]["combatPower"],
        "itemLevel": rec["profile"]["itemLevel"],
        "weaponExceed": rec["exceed"]["weapon"]["total"],
        "armorExceed": rec["exceed"]["armor"]["total"],
        "accessoryExceed": rec["exceed"]["accessory"]["total"],
        "daevanionBasic": rec["daevanion"]["basic"],
        "daevanionOpenNodes": rec["daevanion"]["openNodeTotal"],
    }


def merge_history(rec, prev_rec, keep=30):
    history = list((prev_rec or {}).get("history") or [])
    row = snapshot_row(rec)
    history = [h for h in history if h.get("date") != row["date"]]
    history.append(row)
    history.sort(key=lambda h: h["date"])
    history = history[-keep:]
    rec["history"] = history

    baseline = history[-2] if len(history) >= 2 else None
    if baseline:
        def d(k):
            a, b = row.get(k), baseline.get(k)
            return (a - b) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None
        rec["delta"] = {
            "sinceDate": baseline["date"],
            "combatPower": d("combatPower"), "itemLevel": d("itemLevel"),
            "weaponExceed": d("weaponExceed"), "armorExceed": d("armorExceed"),
            "accessoryExceed": d("accessoryExceed"), "daevanionBasic": d("daevanionBasic"),
        }
    else:
        rec["delta"] = None
    return rec


# --------------------------------- main -----------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="characters.json")
    ap.add_argument("--out", default="docs/data")
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    lang = cfg.get("language", "ko")
    keep = int(cfg.get("historyDays", 30))
    entries = cfg.get("characters", [])
    if not entries:
        print("characters.json 에 캐릭터가 없습니다.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    all_path = os.path.join(args.out, "all.json")
    prev_by_key = {}
    if os.path.exists(all_path):
        try:
            with open(all_path, encoding="utf-8") as f:
                for r in json.load(f).get("characters", []):
                    prev_by_key[r.get("key")] = r
        except Exception as e:  # noqa: BLE001
            print("기존 all.json 을 읽지 못했습니다: %s" % e, file=sys.stderr)

    manual_labels = set()
    mp = os.path.join(os.path.dirname(args.config) or ".", "manual.json")
    if os.path.exists(mp):
        try:
            with open(mp, encoding="utf-8") as f:
                manual_labels = set((json.load(f).get("characters") or {}).keys())
        except Exception:
            pass

    results, errors = [], []
    for i, entry in enumerate(entries):
        label = entry.get("label", "?")
        try:
            server_id, character_id = parse_target(entry)
        except Exception as e:  # noqa: BLE001
            print("  [SKIP] %s : %s" % (label, e), file=sys.stderr)
            errors.append({"label": label, "error": str(e)})
            continue

        referer = "%s/ko-kr/characters/%s/%s" % (BASE, server_id, character_id)
        params = {"lang": lang, "characterId": character_id, "serverId": server_id}
        key = char_key(server_id, character_id)
        prev = prev_by_key.get(key)
        try:
            info = http_get_json("/api/character/info", params, referer)
            time.sleep(random.uniform(0.8, 1.8))
            equip = http_get_json("/api/character/equipment", params, referer)
            rec = build_record(entry, info, equip)
            rec = merge_history(rec, prev, keep)
            rec["updatedAt"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            rec["ok"] = True
            results.append(rec)
            if manual_labels and rec["label"] not in manual_labels:
                print("  [note] manual.json 에 '%s' 항목이 없습니다(오드/잠재력 비게 됨)." % rec["label"])
            print("  [OK]   %s  전투력 %s  아이템레벨 %s  스티그마 %d개" % (
                rec["label"], rec["profile"]["combatPower"], rec["profile"]["itemLevel"], len(rec["stigma"])))
        except Exception as e:  # noqa: BLE001
            print("  [FAIL] %s : %s" % (label, e), file=sys.stderr)
            errors.append({"label": label, "error": str(e)})
            if prev:
                prev = dict(prev)
                prev["ok"] = False
                prev["lastError"] = str(e)
                results.append(prev)
        if i < len(entries) - 1:
            time.sleep(random.uniform(1.5, 3.0))

    if not results:
        print("수집된 캐릭터가 없습니다.", file=sys.stderr)
        sys.exit(1)

    order = {}
    for idx, entry in enumerate(entries):
        try:
            sid, cid = parse_target(entry)
            order[char_key(sid, cid)] = idx
        except Exception:
            pass
    results.sort(key=lambda r: order.get(r.get("key"), 999))
    generated_at = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    with open(all_path, "w", encoding="utf-8") as f:
        json.dump({"generatedAt": generated_at, "characters": results}, f, ensure_ascii=False, indent=1)

    index = {
        "generatedAt": generated_at,
        "characters": [{
            "key": r["key"], "label": r["label"], "ok": r.get("ok", True),
            "updatedAt": r.get("updatedAt"), "officialUrl": r.get("officialUrl"),
            "name": r["profile"]["name"], "className": r["profile"]["className"],
            "combatPower": r["profile"]["combatPower"], "itemLevel": r["profile"]["itemLevel"],
            "weaponExceed": r["exceed"]["weapon"]["total"],
            "armorExceed": r["exceed"]["armor"]["total"],
            "accessoryExceed": r["exceed"]["accessory"]["total"],
            "daevanionBasic": r["daevanion"]["basic"],
            "daevanionYustiel": r["daevanion"]["yustiel"],
            "daevanionOpened": r["daevanion"]["openedBoards"],
            "daevanionTotal": r["daevanion"]["totalBoards"],
        } for r in results],
    }
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"generatedAt": generated_at, "count": len(results), "errors": errors},
                  f, ensure_ascii=False, indent=1)

    print("\n완료: %d명 저장, 실패 %d명 → %s" % (len(results), len(errors), all_path))
    if errors and len(errors) >= len(entries):
        sys.exit(1)


if __name__ == "__main__":
    main()
