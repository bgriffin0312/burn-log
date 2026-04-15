"""Garmin Connect -> Supabase daily sync.

Fetches today's daily summary from Garmin Connect and upserts it into the
garmin_daily table in Supabase. Designed to run as a scheduled GitHub Action.

Required env vars:
  GARMIN_EMAIL, GARMIN_PASSWORD, SUPABASE_URL, SUPABASE_KEY
"""

import os
import sys
from datetime import date

from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from supabase import create_client


def get_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Error: {name} environment variable not set")
        sys.exit(1)
    return value


def fetch_garmin_data(email, password, target_date):
    """Log into Garmin Connect and fetch daily stats."""
    client = Garmin(email, password)
    client.login()

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

    # Extract sleep hours
    sleep_hours = None
    try:
        sleep_data = client.get_sleep_data(date_str)
        if sleep_data and sleep_data.get("dailySleepDTO"):
            sleep_seconds = sleep_data["dailySleepDTO"].get("sleepTimeInSeconds")
            if sleep_seconds:
                sleep_hours = round(sleep_seconds / 3600, 1)
    except Exception as e:
        print(f"Warning: Could not fetch sleep data: {e}")

    return {
        "date": date_str,
        "total_steps": stats.get("totalSteps", 0) or 0,
        "active_calories": stats.get("activeKilocalories", 0) or 0,
        "resting_hr": stats.get("restingHeartRate"),
        "stress_avg": stats.get("averageStressLevel"),
        "sleep_hours": sleep_hours,
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

    target_date = date.today()
    print(f"Syncing Garmin data for {target_date.isoformat()}...")

    try:
        data = fetch_garmin_data(email, password, target_date)
    except GarminConnectAuthenticationError as e:
        print(f"Auth failed: {e}")
        sys.exit(1)
    except GarminConnectTooManyRequestsError:
        print("Rate limited by Garmin. Try again later.")
        sys.exit(1)
    except Exception as e:
        print(f"Garmin fetch failed: {e}")
        sys.exit(1)

    print(f"  Steps: {data['total_steps']}")
    print(f"  Active cal: {data['active_calories']}")
    print(f"  Resting HR: {data['resting_hr']}")
    print(f"  Sleep: {data['sleep_hours']}h")
    print(f"  Body Battery: {data['body_battery_low']}-{data['body_battery_high']}")
    print(f"  Stress avg: {data['stress_avg']}")

    try:
        upsert_to_supabase(supa_url, supa_key, data)
        print("Upserted to Supabase successfully.")
    except Exception as e:
        print(f"Supabase upsert failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
