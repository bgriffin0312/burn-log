"""Garmin Connect -> Supabase daily sync.

Fetches the last N days of daily summaries from Garmin Connect and upserts
them into the garmin_daily table in Supabase. Syncing multiple days makes
the job self-healing — if a run is missed, the next one catches up.

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


def fetch_garmin_data(client, target_date):
    """Fetch daily stats for a single date from an authenticated Garmin client."""
    date_str = target_date.isoformat()
    stats = client.get_stats(date_str)

    # Extract body battery from the dedicated endpoint
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
        print(f"Warning: Could not fetch body battery: {e}")

    # Extract sleep data (hours, stages, score)
    sleep_hours = None
    sleep_score = None
    deep_sleep_mins = None
    light_sleep_mins = None
    rem_sleep_mins = None
    awake_mins = None
    try:
        sleep_data = client.get_sleep_data(date_str)
        if sleep_data and sleep_data.get("dailySleepDTO"):
            dto = sleep_data["dailySleepDTO"]
            sleep_seconds = dto.get("sleepTimeInSeconds")
            if sleep_seconds:
                sleep_hours = round(sleep_seconds / 3600, 1)
            # Sleep score (Garmin's computed quality score, 0-100)
            sleep_score = dto.get("sleepScores", {}).get("overall", {}).get("value") if dto.get("sleepScores") else None
            # Sleep stages in seconds → minutes
            deep = dto.get("deepSleepSeconds")
            light = dto.get("lightSleepSeconds")
            rem = dto.get("remSleepSeconds")
            awake = dto.get("awakeSleepSeconds")
            if deep is not None: deep_sleep_mins = round(deep / 60)
            if light is not None: light_sleep_mins = round(light / 60)
            if rem is not None: rem_sleep_mins = round(rem / 60)
            if awake is not None: awake_mins = round(awake / 60)
    except Exception as e:
        print(f"  Warning: Could not fetch sleep data: {e}")

    # Extract HRV (nightly average)
    avg_hrv = None
    try:
        hrv_data = client.get_hrv_data(date_str)
        if hrv_data:
            # Try common response shapes
            if isinstance(hrv_data, dict):
                summary = hrv_data.get("hrvSummary") or hrv_data.get("summary") or hrv_data
                avg_hrv = (
                    summary.get("lastNightAvg")
                    or summary.get("lastNight5MinHigh")
                    or summary.get("weeklyAvg")
                    or summary.get("nightlyAvg")
                )
    except Exception as e:
        print(f"  Warning: Could not fetch HRV data: {e}")

    return {
        "date": date_str,
        "total_steps": stats.get("totalSteps", 0) or 0,
        "active_calories": stats.get("activeKilocalories", 0) or 0,
        "resting_hr": stats.get("restingHeartRate"),
        "stress_avg": stats.get("averageStressLevel"),
        "sleep_hours": sleep_hours,
        "sleep_score": sleep_score,
        "deep_sleep_mins": deep_sleep_mins,
        "light_sleep_mins": light_sleep_mins,
        "rem_sleep_mins": rem_sleep_mins,
        "awake_mins": awake_mins,
        "avg_hrv": avg_hrv,
        "body_battery_high": bb_high,
        "body_battery_low": bb_low,
    }


def upsert_to_supabase(url, key, data):
    """Upsert daily Garmin data into Supabase."""
    client = create_client(url, key)
    result = client.table("garmin_daily").upsert(data, on_conflict="date").execute()
    return result.data


def main():
    email = get_env("GARMIN_EMAIL")
    password = get_env("GARMIN_PASSWORD")
    supa_url = get_env("SUPABASE_URL")
    supa_key = get_env("SUPABASE_KEY")
    sync_days = int(os.environ.get("SYNC_DAYS", "3"))

    print(f"Logging into Garmin Connect...")
    try:
        client = Garmin(email, password)
        client.login()
    except GarminConnectAuthenticationError as e:
        print(f"Auth failed: {e}")
        sys.exit(1)

    today = date.today()
    failed = 0

    for i in range(sync_days):
        target_date = today - timedelta(days=i)
        print(f"\n--- {target_date.isoformat()} ---")

        try:
            data = fetch_garmin_data(client, target_date)
        except GarminConnectTooManyRequestsError:
            print("Rate limited by Garmin. Stopping.")
            sys.exit(1)
        except Exception as e:
            print(f"  Fetch failed: {e}")
            failed += 1
            continue

        print(f"  Steps: {data['total_steps']}")
        print(f"  Active cal: {data['active_calories']}")
        print(f"  Resting HR: {data['resting_hr']}")
        print(f"  Sleep: {data['sleep_hours']}h (score: {data['sleep_score']})")
        print(f"  Sleep stages: deep={data['deep_sleep_mins']}m light={data['light_sleep_mins']}m REM={data['rem_sleep_mins']}m awake={data['awake_mins']}m")
        print(f"  HRV avg: {data['avg_hrv']}")
        print(f"  Body Battery: {data['body_battery_low']}-{data['body_battery_high']}")
        print(f"  Stress avg: {data['stress_avg']}")

        try:
            upsert_to_supabase(supa_url, supa_key, data)
            print("  Upserted to Supabase.")
        except Exception as e:
            print(f"  Supabase upsert failed: {e}")
            failed += 1

    print(f"\nDone. Synced {sync_days - failed}/{sync_days} days.")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
