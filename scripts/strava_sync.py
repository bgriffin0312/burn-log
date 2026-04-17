"""Strava -> Supabase sync for Caliber strength sessions.

Caliber has no public API, but it pushes completed strength workouts to
Strava as activities with sport_type 'WeightTraining' or 'Workout'. This
script fetches those from Strava, filters out Garmin-originated activity
types (Run, Ride, etc. — we already have those via GarminGo), and upserts
the strength sessions into burn_entries as source='caliber_via_strava'.

Required env (read from OS env, falls back to .env if present):
  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
  SUPABASE_URL, SUPABASE_KEY

Usage:
  python strava_sync.py              # last 7 days (default)
  python strava_sync.py --days 30    # last 30 days

Strava occasionally rotates refresh tokens. If the refresh response returns
a refresh_token that differs from the one we sent, we log a warning — you'll
need to update the STRAVA_REFRESH_TOKEN secret manually before the token on
record fully expires (usually after one more rotation window).
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from supabase import create_client

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

CALIBER_SPORT_TYPES = {"WeightTraining", "Workout"}
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
STRAVA_ACTIVITY_DETAIL_URL = "https://www.strava.com/api/v3/activities/{id}"


def get_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Error: {name} environment variable not set")
        sys.exit(1)
    return value


def refresh_access_token(client_id, client_secret, refresh_token):
    resp = requests.post(
        STRAVA_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    new_refresh = body.get("refresh_token")
    if new_refresh and new_refresh != refresh_token:
        # Strava rotates refresh tokens occasionally; surface so the user can update secrets.
        print("WARNING: Strava returned a new refresh_token. Update STRAVA_REFRESH_TOKEN in GitHub Secrets:")
        print(f"  new refresh_token: {new_refresh}")
    return body["access_token"]


def fetch_activities(access_token, since_ts):
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"after": since_ts, "per_page": 100}
    resp = requests.get(STRAVA_ACTIVITIES_URL, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_activity_detail(access_token, activity_id):
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(
        STRAVA_ACTIVITY_DETAIL_URL.format(id=activity_id),
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def caliber_activity_to_burn_entry(activity, calories):
    start_local = activity["start_date_local"]  # e.g. "2026-04-15T06:30:00Z"
    date_str = start_local[:10]
    time_str = start_local[11:16]
    duration_mins = round((activity.get("moving_time") or 0) / 60, 1)
    return {
        "date": date_str,
        "time": time_str,
        "name": activity.get("name") or "Strength Session",
        "calories": round(calories or 0, 1),
        "activity_type": "strength",
        "duration_mins": duration_mins,
        "steps": None,
        "source": "caliber_via_strava",
        "strava_id": activity["id"],
    }


def upsert_burn_entries(supa, entries):
    if not entries:
        return 0
    result = supa.table("burn_entries") \
        .upsert(entries, on_conflict="strava_id") \
        .execute()
    return len(result.data or [])


def main():
    parser = argparse.ArgumentParser(description="Sync Caliber strength sessions from Strava.")
    parser.add_argument("--days", type=int, default=7, help="Number of days to sync (default 7)")
    args = parser.parse_args()

    client_id = get_env("STRAVA_CLIENT_ID")
    client_secret = get_env("STRAVA_CLIENT_SECRET")
    refresh_token = get_env("STRAVA_REFRESH_TOKEN")
    supa_url = get_env("SUPABASE_URL")
    supa_key = get_env("SUPABASE_KEY")

    print(f"Syncing last {args.days} days of Strava activities...")

    access_token = refresh_access_token(client_id, client_secret, refresh_token)

    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    since_ts = int(since.timestamp())
    activities = fetch_activities(access_token, since_ts)
    print(f"Strava returned {len(activities)} total activities since {since.date()}")

    caliber_entries = []
    skipped_sport_types = {}
    for act in activities:
        sport = act.get("sport_type") or act.get("type")
        if sport not in CALIBER_SPORT_TYPES:
            skipped_sport_types[sport] = skipped_sport_types.get(sport, 0) + 1
            continue

        # The list endpoint sometimes omits calories; refetch detail to be safe.
        calories = act.get("calories")
        if calories is None:
            detail = fetch_activity_detail(access_token, act["id"])
            calories = detail.get("calories")

        entry = caliber_activity_to_burn_entry(act, calories)
        caliber_entries.append(entry)
        print(f"  + {entry['date']} {entry['time']} — {entry['name']} "
              f"({entry['duration_mins']} min, {entry['calories']} kcal)")

    if skipped_sport_types:
        print(f"Skipped non-Caliber sport types: {skipped_sport_types}")

    supa = create_client(supa_url, supa_key)
    count = upsert_burn_entries(supa, caliber_entries)
    print(f"Upserted {count} Caliber session(s) into burn_entries.")


if __name__ == "__main__":
    main()
