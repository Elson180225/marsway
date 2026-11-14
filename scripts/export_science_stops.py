"""Export Kelly's stops.json handoff from the app's existing science-stop file.

Run from any directory: python scripts/export_science_stops.py
The app continues to load science-stops.json; edit that file, then rerun this.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / "app/public/routes/science-stops.json"
    science = json.loads(source.read_text(encoding="utf-8"))
    area = json.loads((ROOT / "data/processed/area.json").read_text(encoding="utf-8"))
    stops = science["stops"]
    if len(stops) != 4 or len({stop["id"] for stop in stops}) != 4:
        raise ValueError("Expected four distinct science stops")
    if science.get("status") != "ready":
        raise ValueError("Science stops must be ready for this handoff")
    if [stop.get("order") for stop in stops] != [1, 2, 3, 4]:
        raise ValueError("Stop order must match the array order, 1 through 4")
    bonus = [stop for stop in stops if stop.get("is_bonus") is True]
    if len(bonus) != 1 or bonus[0]["id"] != science.get("bonus_stop_id"):
        raise ValueError("Mark exactly one bonus stop matching bonus_stop_id")
    for stop in stops:
        if type(stop.get("stop_minutes")) not in (int, float) or not 0 < stop["stop_minutes"] < float("inf"):
            raise ValueError(f"{stop['id']}: add a positive finite visit duration in minutes")
        if type(stop.get("is_bonus")) is not bool:
            raise ValueError(f"{stop['id']}: is_bonus must be true or false")
        if not stop.get("why") or "\n" in stop["why"]:
            raise ValueError(f"{stop['id']}: add a one-line why")
        if not (0 <= stop["x"] < area["sizeMetres"] and 0 < stop["y"] <= area["sizeMetres"]):
            raise ValueError(f"{stop['id']}: outside Elson's area")
        photo = ROOT / "app/public" / stop["photo_url"].lstrip("/")
        if not photo.is_file():
            raise ValueError(f"{stop['id']}: photo missing")
    for target in (ROOT / "data/processed/stops.json", ROOT / "app/public/routes/stops.json"):
        target.write_text(json.dumps(science, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Exported {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
