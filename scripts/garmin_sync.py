"""Garmin Connect -> Supabase daily sync.

Fetches the last N days of daily summaries from Garmin Connect and upserts
them into the garmin_daily table in Supabase. Syncing multiple days makes
the job self-healing — if a run is missed, the next one catches up.

Sleep and HRV are nightly metrics — Garmin reports them on the wake-up date,
but we attribute them to the PREVIOUS day (when the night started). So sleep
from the night of 4/14→4/15 goes on the 4/14 record.

Required env vars:
  GARMIN_EMAIL, GARMIN_PASSWORD, SUPABASE_URL, SUPABASE_KEY
Optional:
  SYNC_DAYS — number of days to sync (default: 3)
"""

import os
import sys
from datetime import date, timedelta

from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from supabase import create_client


def get_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Error: {name} environment variable not set")
        sys.exit(1)
    return value


def fetch_daytime_stats(client, target_date):
    """Fetch daytime metrics: steps, calories, stress, body battery, resting HR."""
    date_str = target_date.isoformat()
    stats = client.get_stats(date_str)

    # Body battery
    bb_high = None
    bb_low = None
    try:
        bb_data = client.get_body_battery(date_str)
        if bb_data and isinstance(bb_data, list) and len(bb_data) > 0:
            values = [p.get("bodyBatteryLevel", 0) for p in bb_data if p.get("bodyBatteryLevel") is not None]
            if values:
                bb_high = max(values)
                bb_low = min(values)
    except Exception as e:
        print(f"  Warning: Could not fetch body battery: {e}")

    return {
        "total_steps": stats.get("totalSteps", 0) or 0,
        "active_calories": stats.get("activeKilocalories", 0) or 0,
        "resting_hr": stats.get("restingHeartRate"),
        "stress_avg": stats.get("averageStressLevel"),
        "body_battery_high": bb_high,
        "body_battery_low": bb_low,
    }


def fetch_night_stats(client, wake_date):
    """Fetch nightly metrics for the night ENDING on wake_date.

    Returns sleep and HRV data that should be attributed to (wake_date - 1),
    i.e. the night that STARTED on the previous evening.
    """
    date_str = wake_date.isoformat()
    result = {}

    # Sleep data
    try:
        sleep_data = client.get_sleep_data(date_str)
        if sleep_data and sleep_data.get("dailySleepDTO"):
            dto = sleep_data["dailySleepDTO"]
            sleep_seconds = dto.get("sleepTimeInSeconds")
            if sleep_seconds:
                result["sleep_hours"] = round(sleep_seconds / 3600, 1)
            # Sleep score
            if dto.get("sleepScores"):
                score = dto["sleepScores"].get("overall", {}).get("value")
                if score is not None:
                    result["sleep_score"] = score
            # Sleep stages (seconds → minutes)
            for field, key in [("deepSleepSeconds", "deep_sleep_mins"),
                               ("lightSleepSeconds", "light_sleep_mins"),
                               ("remSleepSeconds", "rem_sleep_mins"),
                               ("awakeSleepSeconds", "awake_mins")]:
                val = dto.get(field)
                if val is not None:
                    result[key] = round(val / 60)
    except Exception as e:
        print(f"  Warning: Could not fetch sleep data: {e}")

    # HRV (nightly average)
    try:
        hrv_data = client.get_hrv_data(date_str)
        if hrv_data and isinstance(hrv_data, dict):
            summary = hrv_data.get("hrvSummary") or hrv_data.get("summary") or hrv_data
            avg_hrv = (
                summary.get("lastNightAvg")
                or summary.get("lastNight5MinHigh")
                or summary.get("weeklyAvg")
                or summary.get("nightlyAvg")
            )
            if avg_hrv is not None:
                result["avg_hrv"] = avg_hrv
    except Exception as e:
        print(f"  Warning: Could not fetch HRV data: {e}")

    return result


def upsert_to_supabase(supa_client, data):
    """Upsert daily Garmin data into Supabase."""
    result = supa_client.table("garmin_daily").upsert(data, on_conflict="date").execute()
    return result.data


def main():
    email = get_env("GARMIN_EMAIL")
    password = get_env("GARMIN_PASSWORD")
    supa_url = get_env("SUPABASE_URL")
    supa_key = get_env("SUPABASE_KEY")
    sync_days = int(os.environ.get("SYNC_DAYS", "3"))

    print("Logging into Garmin Connect...")
    try:
        garmin = Garmin(email, password)
        garmin.login()
    except GarminConnectAuthenticationError as e:
        print(f"Auth failed: {e}")
        sys.exit(1)

    supa = create_client(supa_url, supa_key)
    today = date.today()
    failed = 0

    # Collect records keyed by date — we'll merge daytime and nighttime data
    records = {}

    for i in range(sync_days):
        target_date = today - timedelta(days=i)
        date_str = target_date.isoformat()
        print(f"\n--- {date_str} (daytime) ---")

        try:
            daytime = fetch_daytime_stats(garmin, target_date)
            records.setdefault(date_str, {"date": date_str})
            records[date_str].update(daytime)
            print(f"  Steps: {daytime['total_steps']}")
            print(f"  Active cal: {daytime['active_calories']}")
            print(f"  Resting HR: {daytime['resting_hr']}")
            print(f"  Stress avg: {daytime['stress_avg']}")
            print(f"  Body Battery: {daytime['body_battery_low']}-{daytime['body_battery_high']}")
        except GarminConnectTooManyRequestsError:
            print("Rate limited by Garmin. Stopping.")
            sys.exit(1)
        except Exception as e:
            print(f"  Daytime fetch failed: {e}")
            failed += 1

        # Fetch nightly data for this wake-up date → attribute to previous day
        prev_date_str = (target_date - timedelta(days=1)).isoformat()
        print(f"  Fetching night data (for {prev_date_str})...")

        try:
            night = fetch_night_stats(garmin, target_date)
            if night:
                records.setdefault(prev_date_str, {"date": prev_date_str})
                records[prev_date_str].update(night)
                print(f"  Sleep: {night.get('sleep_hours')}h (score: {night.get('sleep_score')})")
                print(f"  Stages: deep={night.get('deep_sleep_mins')}m light={night.get('light_sleep_mins')}m REM={night.get('rem_sleep_mins')}m awake={night.get('awake_mins')}m")
                print(f"  HRV avg: {night.get('avg_hrv')}")
            else:
                print("  No night data available.")
        except GarminConnectTooManyRequestsError:
            print("Rate limited by Garmin. Stopping.")
            sys.exit(1)
        except Exception as e:
            print(f"  Night fetch failed: {e}")

    # Upsert all collected records
    print(f"\n--- Upserting {len(records)} records ---")
    for date_str, data in sorted(records.items()):
        try:
            upsert_to_supabase(supa, data)
            print(f"  {date_str}: OK")
        except Exception as e:
            print(f"  {date_str}: FAILED - {e}")
            failed += 1

    print(f"\nDone. {len(records)} dates processed, {failed} failures.")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
