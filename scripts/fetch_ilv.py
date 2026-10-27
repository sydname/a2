#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
아이템레벨 시뮬용 상세만 따로 수집한다. (수동 실행 전용, 캐릭터 지정 가능)

캐릭터 1명당: equipment 1회 + 착용 아이템 수만큼 item 상세 + 개방 데바니온 보드 수만큼 상세 호출.
결과는 docs/data/ilv.json 에 캐릭터별로 병합 저장 (지정하지 않은 캐릭터 값은 유지).

사용법:
    python scripts/fetch_ilv.py --label 감자밍
    python scripts/fetch_ilv.py --label all
"""

import argparse
import datetime as dt
import json
import os
import random
import sys
import time

from fetch import BASE, char_key, http_get_json, parse_target


def fetch_one(params, referer):
    info = http_get_json("/api/character/info", params, referer)
    time.sleep(random.uniform(0.6, 1.2))
    equip = http_get_json("/api/character/equipment", params, referer)
    items = {}
    for it in (equip.get("equipment", {}) or {}).get("equipmentList", []) or []:
        p = dict(params, id=it.get("id"), enchantLevel=it.get("enchantLevel") or 0,
                 slotPos=it.get("slotPos"))
        time.sleep(random.uniform(0.2, 0.5))
        try:
            r = http_get_json("/api/character/equipment/item", p, referer, retries=2)
        except Exception as e:  # noqa: BLE001
            print("    [item] %s 실패: %s" % (it.get("slotPosName"), e), file=sys.stderr)
            continue
        items[it.get("slotPosName")] = {
            "name": it.get("name"),
            "baseLevel": r.get("level"),
            "maxEnchant": r.get("maxEnchantLevel"),
            "maxExceed": r.get("maxExceedEnchantLevel"),
            "stones": [m.get("grade") for m in (r.get("magicStoneStat") or [])],
            "stoneSlots": r.get("magicStoneSlotCount"),
            "godStones": [g.get("grade") for g in (r.get("godStoneStat") or [])],
        }
    nodes, open_total = {}, 0
    for b in (info.get("daevanion", {}) or {}).get("boardList", []) or []:
        if not b.get("open"):
            continue
        open_total += int(b.get("openNodeCount") or 0)
        time.sleep(random.uniform(0.2, 0.5))
        r = http_get_json("/api/character/daevanion/detail",
                          dict(params, boardId=b.get("id")), referer, retries=2)
        for n in r.get("nodeList") or []:
            g = n.get("grade")
            if n.get("open") and g and g != "None":
                nodes[g] = nodes.get(g, 0) + 1
    return {"items": items, "nodeGrades": nodes, "openNodeTotal": open_total}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="characters.json")
    ap.add_argument("--out", default="docs/data")
    ap.add_argument("--label", default="all", help="캐릭터 label (all = 전체)")
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    lang = cfg.get("language", "ko")
    entries = cfg.get("characters", [])
    if args.label != "all":
        entries = [e for e in entries if e.get("label") == args.label]
        if not entries:
            print("characters.json 에 '%s' 가 없습니다." % args.label, file=sys.stderr)
            sys.exit(1)

    path = os.path.join(args.out, "ilv.json")
    data = {"characters": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

    fails = 0
    for i, entry in enumerate(entries):
        label = entry.get("label", "?")
        try:
            sid, cid = parse_target(entry)
            referer = "%s/ko-kr/characters/%s/%s" % (BASE, sid, cid)
            rec = fetch_one({"lang": lang, "characterId": cid, "serverId": sid}, referer)
            rec["label"] = label
            rec["updatedAt"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            data["characters"][char_key(sid, cid)] = rec
            print("  [OK]   %s  아이템 %d개  데바니온 노드 %d" % (label, len(rec["items"]), rec["openNodeTotal"]))
        except Exception as e:  # noqa: BLE001
            fails += 1
            print("  [FAIL] %s : %s" % (label, e), file=sys.stderr)
        if i < len(entries) - 1:
            time.sleep(random.uniform(1.5, 3.0))

    data["generatedAt"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    if fails and fails >= len(entries):
        sys.exit(1)


if __name__ == "__main__":
    main()
