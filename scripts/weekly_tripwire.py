"""Weekly Tripwire System — Thursday check-in and Sunday scorecard.

Queries Supabase for the current week's Burn Log data, computes scorecard
metrics, stores the scorecard, and sends an email via Resend with an .ics
calendar attachment.

Required env vars:
  SUPABASE_URL, SUPABASE_KEY, RESEND_API_KEY
  REPORT_TYPE: 'thursday_check' or 'sunday_review'
Optional:
  RECIPIENT_EMAIL — override default (bgriffin@texasappleseed.org)
  APP_BASE_URL   — base URL where tripwire.html is hosted (GitHub Pages URL).
                   Response CTA is omitted from emails when this is not set.
"""

import os
import sys
import json
import secrets
import base64
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from uuid import uuid4

import requests
from supabase import create_client

CENTRAL = ZoneInfo("America/Chicago")
DEFAULT_EMAIL = "bgriffin@texasappleseed.org"

# Rating thresholds
# Cardio (running/cycling/swimming/sports/other — excludes walking): ≥4 blue, ≥3 green, 2 yellow, ≤1 red
# Lifts (strength): ≥3 blue, ≥2 green, 1 yellow, 0 red
ALCOHOL_THRESHOLDS = {"green": 7, "yellow": 14}   # <= green, <= yellow, else red
SLEEP_THRESHOLDS = {"green": 7.0, "yellow": 6.0}  # >= green, >= yellow, else red
LOGGING_THRESHOLDS = {"green": 7, "yellow": 5}     # >= green, >= yellow, else red

CARDIO_ACTIVITY_TYPES = {"running", "cycling", "cardio", "sports", "other"}
LIFT_ACTIVITY_TYPES = {"strength"}


def get_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Error: {name} environment variable not set")
        sys.exit(1)
    return value


def get_week_bounds(report_type):
    """Return (monday, end_date) for the current week in Central Time.

    Thursday check: Mon-Thu of this week.
    Sunday review: Mon-Sun of this week.
    """
    now = datetime.now(CENTRAL)
    today = now.date()
    # Monday of this week
    monday = today - timedelta(days=today.weekday())

    if report_type == "thursday_check":
        end = monday + timedelta(days=3)  # Thursday
    else:
        end = monday + timedelta(days=6)  # Sunday

    return monday, end


def fetch_week_data(supa, start, end):
    """Query food_entries, burn_entries, and garmin_daily for the date range."""
    start_str = start.isoformat()
    end_str = end.isoformat()

    food = supa.table("food_entries") \
        .select("date, calories, standard_drinks") \
        .gte("date", start_str) \
        .lte("date", end_str) \
        .execute().data or []

    burns = supa.table("burn_entries") \
        .select("date, source, activity_type, calories") \
        .gte("date", start_str) \
        .lte("date", end_str) \
        .execute().data or []

    garmin = supa.table("garmin_daily") \
        .select("date, sleep_hours") \
        .gte("date", start_str) \
        .lte("date", end_str) \
        .execute().data or []

    return food, burns, garmin


def compute_scorecard(food, burns, garmin, start, end):
    """Compute scorecard metrics from raw data."""
    num_days = (end - start).days + 1
    all_dates = [(start + timedelta(days=i)).isoformat() for i in range(num_days)]

    manual_burns = [b for b in burns if b.get("source") == "manual"]
    cardio_dates = set(b["date"] for b in manual_burns
                       if (b.get("activity_type") or "other") in CARDIO_ACTIVITY_TYPES)
    lift_dates = set(b["date"] for b in manual_burns
                     if (b.get("activity_type") or "") in LIFT_ACTIVITY_TYPES)
    cardio_days = len(cardio_dates)
    lift_days = len(lift_dates)

    total_drinks = sum(f.get("standard_drinks", 0) or 0 for f in food)

    sleep_values = [g["sleep_hours"] for g in garmin
                    if g.get("sleep_hours") and g["sleep_hours"] > 0]
    avg_sleep = round(sum(sleep_values) / len(sleep_values), 1) if sleep_values else None

    food_dates = set(f["date"] for f in food)
    days_logged = len(food_dates)

    # Missing data: any activity would mark the day as present
    any_activity_dates = cardio_dates | lift_dates
    drink_dates = set(f["date"] for f in food if (f.get("standard_drinks", 0) or 0) > 0)
    missing_days = [d for d in all_dates
                    if d not in food_dates and d not in any_activity_dates and d not in drink_dates]

    cardio_rating = rate_cardio(cardio_days)
    lift_rating = rate_lifts(lift_days)
    alcohol_rating = rate_alcohol(total_drinks)
    sleep_rating = rate_sleep(avg_sleep)
    logging_rating = rate_logging(days_logged, num_days)

    ratings = [cardio_rating, lift_rating, alcohol_rating, sleep_rating, logging_rating]
    red_count = sum(1 for r in ratings if r == "red")

    return {
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "cardio_days": cardio_days,
        "lift_days": lift_days,
        "total_drinks": round(total_drinks, 1),
        "avg_sleep": avg_sleep,
        "days_logged": days_logged,
        "cardio_rating": cardio_rating,
        "lift_rating": lift_rating,
        "alcohol_rating": alcohol_rating,
        "sleep_rating": sleep_rating,
        "logging_rating": logging_rating,
        "missing_days": json.dumps(missing_days),
        "red_count": red_count,
    }


def rate_cardio(days):
    if days >= 4:
        return "blue"
    if days >= 3:
        return "green"
    if days == 2:
        return "yellow"
    return "red"


def rate_lifts(days):
    if days >= 3:
        return "blue"
    if days >= 2:
        return "green"
    if days == 1:
        return "yellow"
    return "red"


def rate_alcohol(drinks):
    if drinks <= ALCOHOL_THRESHOLDS["green"]:
        return "green"
    if drinks <= ALCOHOL_THRESHOLDS["yellow"]:
        return "yellow"
    return "red"


def rate_sleep(avg):
    if avg is None:
        return "yellow"  # No data — not red, but flag it
    if avg >= SLEEP_THRESHOLDS["green"]:
        return "green"
    if avg >= SLEEP_THRESHOLDS["yellow"]:
        return "yellow"
    return "red"


def rate_logging(days_logged, total_days):
    if days_logged >= total_days:
        return "green"
    if days_logged >= LOGGING_THRESHOLDS["yellow"]:
        return "yellow"
    return "red"


def check_cascade(supa, current_week_start):
    """Check previous Sunday reviews for consecutive weeks with 2+ reds."""
    # Fetch the last 3 Sunday review scorecards before this week
    result = supa.table("weekly_scorecards") \
        .select("week_start, red_count") \
        .eq("report_type", "sunday_review") \
        .lt("week_start", current_week_start) \
        .order("week_start", desc=True) \
        .limit(3) \
        .execute()

    prev_scorecards = result.data or []
    consecutive = 0
    for sc in prev_scorecards:
        if (sc.get("red_count", 0) or 0) >= 2:
            consecutive += 1
        else:
            break

    return consecutive


def generate_ics(summary, dt, description):
    """Generate a minimal .ics calendar event."""
    uid = str(uuid4())
    dtstart = dt.strftime("%Y%m%dT%H%M%S")
    dtend = (dt + timedelta(minutes=30)).strftime("%Y%m%dT%H%M%S")
    # Escape special chars for iCal
    desc_escaped = description.replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")
    summary_escaped = summary.replace(",", "\\,").replace(";", "\\;")

    return f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//BurnLog//Tripwire//EN
BEGIN:VEVENT
UID:{uid}
DTSTART;TZID=America/Chicago:{dtstart}
DTEND;TZID=America/Chicago:{dtend}
SUMMARY:{summary_escaped}
DESCRIPTION:{desc_escaped}
BEGIN:VALARM
TRIGGER:PT0M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR"""


def format_date_short(iso_date):
    """Format 2026-04-14 as 'Tue'."""
    d = date.fromisoformat(iso_date)
    return d.strftime("%A")


def rating_color(rating):
    """Return hex color for rating."""
    return {
        "blue": "#3b82f6",
        "green": "#22c55e",
        "yellow": "#eab308",
        "red": "#ef4444",
    }.get(rating, "#888")


def rating_emoji(rating):
    return {
        "blue": "\U0001f4aa",
        "green": "\u2705",
        "yellow": "\u26a0\ufe0f",
        "red": "\u274c",
    }.get(rating, "")


def _cta_button_html(label, url):
    if not url:
        return ""
    return f"""
    <div style="text-align:center; margin:20px 0;">
      <a href="{url}" style="display:inline-block; background:#a3e635; color:#0a0a0a; font-size:15px; font-weight:600; text-decoration:none; padding:12px 24px; border-radius:8px;">
        {label}
      </a>
      <p style="color:#525252; font-size:11px; margin:8px 0 0 0;">Link expires in 10 days.</p>
    </div>"""


def _lever_panel_html(lever, footer_line=None):
    if not lever:
        return ""
    footer = (f'<p style="color:#737373; font-size:12px; margin:8px 0 0 0;">{footer_line}</p>'
              if footer_line else "")
    return f"""
    <div style="background:#0f1a0f; border:1px solid #264d26; border-radius:10px; padding:14px; margin:16px 0;">
      <p style="color:#a3a3a3; font-size:12px; margin:0 0 6px 0; text-transform:uppercase; letter-spacing:0.5px;">Last Sunday's lever</p>
      <p style="color:#d4d4d4; font-size:14px; line-height:1.5; margin:0;">{lever}</p>
      {footer}
    </div>"""


def build_thursday_email(scorecard, food, burns, response_url=None, prior_sunday_response=None):
    """Build HTML email for Thursday planning prompt.

    prior_sunday_response: last week's submitted Sunday review (carries lever_next_week).
    """
    cardio = scorecard["cardio_days"]
    lifts = scorecard["lift_days"]
    drinks = scorecard["total_drinks"]

    def stat_color(rating):
        return rating_color(rating)

    cardio_c = stat_color(rate_cardio(cardio))
    lift_c = stat_color(rate_lifts(lifts))
    drink_c = "#22c55e" if drinks <= 4 else "#eab308" if drinks <= 7 else "#ef4444"

    closure_html = _lever_panel_html(
        (prior_sunday_response or {}).get("lever_next_week"))
    cta_html = _cta_button_html("Log your weekend pre-commit &rarr;", response_url)

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0a0a0a; color:#e5e5e5; font-family:'Helvetica Neue',Arial,sans-serif; padding:20px; margin:0;">
  <div style="max-width:480px; margin:0 auto;">
    <h1 style="color:#a3e635; font-size:20px; margin-bottom:4px;">Weekend Plan</h1>
    <p style="color:#737373; font-size:13px; margin-top:0;">Burn Log &middot; Thursday Check-in</p>

    {closure_html}

    <div style="background:#141414; border:1px solid #262626; border-radius:10px; padding:16px; margin:16px 0;">
      <h2 style="color:#d4d4d4; font-size:15px; margin:0 0 12px 0;">Mon&ndash;Thu So Far</h2>
      <div style="display:flex; gap:20px; flex-wrap:wrap;">
        <div>
          <div style="font-family:monospace; font-size:28px; color:{cardio_c};">{cardio}</div>
          <div style="font-size:12px; color:#737373;">cardio</div>
        </div>
        <div>
          <div style="font-family:monospace; font-size:28px; color:{lift_c};">{lifts}</div>
          <div style="font-size:12px; color:#737373;">lifts</div>
        </div>
        <div>
          <div style="font-family:monospace; font-size:28px; color:{drink_c};">{drinks}</div>
          <div style="font-size:12px; color:#737373;">standard drinks</div>
        </div>
      </div>
    </div>

    <div style="background:#141414; border:1px solid #262626; border-radius:10px; padding:16px; margin:16px 0;">
      <h2 style="color:#d4d4d4; font-size:15px; margin:0 0 8px 0;">Weekend Pre-Commit</h2>
      <p style="color:#a3a3a3; font-size:14px; line-height:1.5; margin:0;">
        How many cardio and lifting sessions Fri&ndash;Sun?<br>
        What&rsquo;s your drink ceiling for the weekend?
      </p>
    </div>

    {cta_html}

    <p style="color:#404040; font-size:11px; text-align:center; margin-top:24px;">
      Burn Log Tripwire System
    </p>
  </div>
</body>
</html>"""
    return html


def build_sunday_email(scorecard, cascade_level, response_url=None,
                       same_week_thursday_response=None, prior_sunday_response=None):
    """Build HTML email for Sunday weekly review.

    same_week_thursday_response: this week's Thursday pre-commit (if submitted),
        used to evaluate the commitment vs this week's actuals.
    prior_sunday_response: last week's Sunday reflection (for lever continuity).
    """
    missing = json.loads(scorecard.get("missing_days", "[]"))

    metrics = [
        ("Cardio", f"{scorecard['cardio_days']} sessions", scorecard["cardio_rating"],
         "4+ blue, 3 green, 2 yellow, 0-1 red"),
        ("Lifts", f"{scorecard['lift_days']} sessions", scorecard["lift_rating"],
         "3+ blue, 2 green, 1 yellow, 0 red"),
        ("Alcohol", f"{scorecard['total_drinks']} drinks", scorecard["alcohol_rating"],
         "\u22647 green, 8-14 yellow, 15+ red"),
        ("Sleep", f"{scorecard['avg_sleep']}h avg" if scorecard["avg_sleep"] else "No data",
         scorecard["sleep_rating"], "7+ green, 6-7 yellow, <6 red"),
        ("Logging", f"{scorecard['days_logged']}/7 days", scorecard["logging_rating"],
         "7/7 green, 5-6 yellow, \u22644 red"),
    ]

    rows_html = ""
    for label, value, rating, scale in metrics:
        color = rating_color(rating)
        emoji = rating_emoji(rating)
        rows_html += f"""
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #262626; color:#d4d4d4; font-size:14px;">{label}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #262626; font-family:monospace; font-size:14px; color:{color};">{emoji} {value}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #262626; color:#525252; font-size:11px;">{scale}</td>
      </tr>"""

    # Missing data section
    missing_html = ""
    if missing:
        day_names = [format_date_short(d) for d in missing]
        missing_html = f"""
    <div style="background:#1c1007; border:1px solid #78350f; border-radius:10px; padding:14px; margin:16px 0;">
      <p style="color:#d97706; font-size:14px; margin:0;">
        <strong>{', '.join(day_names)}</strong> {'has' if len(missing) == 1 else 'have'} no data &mdash;
        did you stop logging?
      </p>
    </div>"""

    # Cascade warning
    cascade_html = ""
    if cascade_level >= 2:
        cascade_html = """
    <div style="background:#1c0707; border:2px solid #ef4444; border-radius:10px; padding:16px; margin:16px 0;">
      <p style="color:#ef4444; font-size:15px; font-weight:bold; margin:0 0 8px 0;">
        \U0001f6a8 Three weeks sliding.
      </p>
      <p style="color:#fca5a5; font-size:14px; margin:0;">
        Time to reset. Consider: no alcohol in the house this week, and commit to just 2 runs.
      </p>
    </div>"""
    elif cascade_level >= 1:
        cascade_html = """
    <div style="background:#1c1007; border:2px solid #f97316; border-radius:10px; padding:16px; margin:16px 0;">
      <p style="color:#f97316; font-size:15px; font-weight:bold; margin:0 0 8px 0;">
        \u26a0\ufe0f Two rough weeks in a row.
      </p>
      <p style="color:#fdba74; font-size:14px; margin:0;">
        This is usually when everything collapses. Pick ONE thing to protect this week &mdash;
        exercise or alcohol ceiling &mdash; and just do that one.
      </p>
    </div>"""

    # Commitment check: compare this week's Thursday pre-commit vs full-week actuals
    commitment_html = ""
    if same_week_thursday_response:
        r = same_week_thursday_response
        bits = []
        if r.get("planned_cardio") is not None:
            actual = scorecard["cardio_days"]
            planned = r["planned_cardio"]
            icon = "\u2705" if actual >= planned else "\u274c"
            bits.append(f"{icon} Cardio: committed {planned}, logged {actual}")
        if r.get("planned_lifts") is not None:
            actual = scorecard["lift_days"]
            planned = r["planned_lifts"]
            icon = "\u2705" if actual >= planned else "\u274c"
            bits.append(f"{icon} Lifts: committed {planned}, logged {actual}")
        if r.get("drink_ceiling") is not None:
            drinks_actual = scorecard["total_drinks"]
            ceiling = r["drink_ceiling"]
            icon = "\u2705" if drinks_actual <= ceiling else "\u274c"
            bits.append(f"{icon} Drinks: ceiling {ceiling}, at {drinks_actual}")
        if bits:
            commitment_html = f"""
    <div style="background:#0f1a0f; border:1px solid #264d26; border-radius:10px; padding:14px; margin:16px 0;">
      <p style="color:#a3a3a3; font-size:12px; margin:0 0 6px 0; text-transform:uppercase; letter-spacing:0.5px;">Thursday commitment vs actual</p>
      <p style="color:#d4d4d4; font-size:14px; line-height:1.6; margin:0;">{'<br>'.join(bits)}</p>
    </div>"""

    red_count = scorecard["red_count"]
    red_footer = f"This week: {red_count} red{'s' if red_count != 1 else ''}."
    lever_html = _lever_panel_html(
        (prior_sunday_response or {}).get("lever_next_week"),
        footer_line=red_footer,
    )
    closure_html = commitment_html + lever_html
    cta_html = _cta_button_html("Reflect &amp; pick next week's lever &rarr;", response_url)

    week_label = f"{scorecard['week_start']} to {scorecard['week_end']}"

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0a0a0a; color:#e5e5e5; font-family:'Helvetica Neue',Arial,sans-serif; padding:20px; margin:0;">
  <div style="max-width:520px; margin:0 auto;">
    <h1 style="color:#a3e635; font-size:20px; margin-bottom:4px;">Weekly Scorecard</h1>
    <p style="color:#737373; font-size:13px; margin-top:0;">Burn Log &middot; {week_label}</p>

    {closure_html}

    <table style="width:100%; border-collapse:collapse; background:#141414; border:1px solid #262626; border-radius:10px; margin:16px 0;">
      {rows_html}
    </table>

    {missing_html}
    {cascade_html}
    {cta_html}

    <p style="color:#404040; font-size:11px; text-align:center; margin-top:24px;">
      Burn Log Tripwire System
    </p>
  </div>
</body>
</html>"""
    return html


def send_email(to, subject, html_body, ics_content, api_key):
    """Send email via Resend API with .ics attachment."""
    ics_b64 = base64.b64encode(ics_content.encode("utf-8")).decode("utf-8")

    payload = {
        "from": "Burn Log <onboarding@resend.dev>",
        "to": [to],
        "subject": subject,
        "html": html_body,
        "attachments": [
            {
                "filename": "reminder.ics",
                "content": ics_b64,
                "content_type": "text/calendar",
            }
        ],
    }

    resp = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )

    if resp.status_code not in (200, 201):
        print(f"Resend API error ({resp.status_code}): {resp.text}")
        sys.exit(1)

    print(f"Email sent: {resp.json().get('id', 'ok')}")


def upsert_scorecard(supa, scorecard, report_type):
    """Store scorecard in weekly_scorecards table. Returns the row id."""
    record = {**scorecard, "report_type": report_type}
    result = supa.table("weekly_scorecards") \
        .upsert([record], on_conflict="week_start,report_type") \
        .execute()
    rows = result.data or []
    scorecard_id = rows[0]["id"] if rows else None
    print(f"Scorecard stored for {scorecard['week_start']} ({report_type}) id={scorecard_id}")
    return scorecard_id


def create_response_token(supa, scorecard_id, week_start, report_type, ttl_days=10):
    """Insert (or reuse) a pending tripwire_responses row and return its token.

    Idempotent on (week_start, report_type): if an unsubmitted row exists for
    this week/type, return its existing token rather than minting a new one.
    Submitted responses are left alone; a fresh token is minted in that case,
    but in practice the script won't run twice for the same week.
    """
    existing = supa.table("tripwire_responses") \
        .select("response_token, submitted_at") \
        .eq("week_start", week_start) \
        .eq("report_type", report_type) \
        .limit(1) \
        .execute().data or []

    if existing and not existing[0].get("submitted_at"):
        return existing[0]["response_token"]

    token = secrets.token_urlsafe(24)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat()
    supa.table("tripwire_responses").insert({
        "scorecard_id": scorecard_id,
        "week_start": week_start,
        "report_type": report_type,
        "response_token": token,
        "token_expires_at": expires_at,
    }).execute()
    return token


def fetch_prior_response(supa, current_week_start, report_type):
    """Return the most recent submitted response for the given report_type
    strictly before current_week_start, or None."""
    result = supa.table("tripwire_responses") \
        .select("*") \
        .eq("report_type", report_type) \
        .lt("week_start", current_week_start) \
        .not_.is_("submitted_at", "null") \
        .order("week_start", desc=True) \
        .limit(1) \
        .execute()
    rows = result.data or []
    return rows[0] if rows else None


def fetch_same_week_response(supa, week_start, report_type):
    """Return this week's submitted response for report_type, or None.
    Used on Sunday to evaluate the Thursday commitment made earlier in the week."""
    result = supa.table("tripwire_responses") \
        .select("*") \
        .eq("week_start", week_start) \
        .eq("report_type", report_type) \
        .not_.is_("submitted_at", "null") \
        .limit(1) \
        .execute()
    rows = result.data or []
    return rows[0] if rows else None


def main():
    supa_url = get_env("SUPABASE_URL")
    supa_key = get_env("SUPABASE_KEY")
    resend_key = get_env("RESEND_API_KEY")
    report_type = get_env("REPORT_TYPE")
    recipient = os.environ.get("RECIPIENT_EMAIL", DEFAULT_EMAIL)
    app_base_url = os.environ.get("APP_BASE_URL", "").rstrip("/")

    if report_type not in ("thursday_check", "sunday_review"):
        print(f"Error: REPORT_TYPE must be 'thursday_check' or 'sunday_review', got '{report_type}'")
        sys.exit(1)

    print(f"Running {report_type} report...")

    supa = create_client(supa_url, supa_key)
    monday, end = get_week_bounds(report_type)
    print(f"Week: {monday} to {end}")

    food, burns, garmin = fetch_week_data(supa, monday, end)
    print(f"Data: {len(food)} food entries, {len(burns)} burn entries, {len(garmin)} garmin days")

    scorecard = compute_scorecard(food, burns, garmin, monday, end)
    print(f"Scorecard: cardio={scorecard['cardio_days']}, lifts={scorecard['lift_days']}, "
          f"drinks={scorecard['total_drinks']}, sleep={scorecard['avg_sleep']}, "
          f"logged={scorecard['days_logged']}, reds={scorecard['red_count']}")

    # Store scorecard first — we need its id to link the response row
    scorecard_id = upsert_scorecard(supa, scorecard, report_type)

    # Mint (or reuse) a response token and prior-response lookup for closure loop
    response_url = None
    if app_base_url:
        try:
            token = create_response_token(supa, scorecard_id, monday.isoformat(), report_type)
            response_url = f"{app_base_url}/tripwire.html?token={token}"
            print(f"Response URL: {response_url}")
        except Exception as e:
            print(f"Warning: could not create response token: {e}")
    else:
        print("APP_BASE_URL not set — skipping interactive response link")

    if report_type == "thursday_check":
        # Thursday shows last Sunday's lever as accountability continuity
        prior_sunday = fetch_prior_response(supa, monday.isoformat(), "sunday_review")
        if prior_sunday:
            print(f"Prior Sunday response found from week {prior_sunday['week_start']}")
        subject = "Weekend Plan \u2014 Exercise & Drinks"
        html = build_thursday_email(scorecard, food, burns, response_url, prior_sunday)
        # Calendar event: Thursday 6 PM Central
        now_ct = datetime.now(CENTRAL)
        event_dt = now_ct.replace(hour=18, minute=0, second=0, microsecond=0)
        ics = generate_ics("Weekend Plan \u2014 Exercise & Drinks", event_dt,
                           f"Mon-Thu: {scorecard['cardio_days']} cardio, "
                           f"{scorecard['lift_days']} lifts, "
                           f"{scorecard['total_drinks']} drinks. Plan your weekend.")
    else:
        # Sunday review
        cascade_count = check_cascade(supa, monday.isoformat())
        # Include current week in cascade if it also has 2+ reds
        if scorecard["red_count"] >= 2:
            cascade_level = cascade_count + 1
        else:
            cascade_level = 0

        scorecard["cascade_count"] = cascade_level
        # Persist cascade_count since upsert_scorecard ran before we computed it
        supa.table("weekly_scorecards") \
            .update({"cascade_count": cascade_level}) \
            .eq("week_start", monday.isoformat()) \
            .eq("report_type", report_type) \
            .execute()

        # Sunday evaluates this week's Thursday commitment + carries last Sunday's lever
        same_week_thursday = fetch_same_week_response(supa, monday.isoformat(), "thursday_check")
        prior_sunday = fetch_prior_response(supa, monday.isoformat(), "sunday_review")
        if same_week_thursday:
            print(f"Same-week Thursday response found")
        if prior_sunday:
            print(f"Prior Sunday response found from week {prior_sunday['week_start']}")
        subject = f"Weekly Scorecard \u2014 Burn Log"
        html = build_sunday_email(scorecard, cascade_level, response_url,
                                   same_week_thursday, prior_sunday)
        # Calendar event: Sunday 8 PM Central
        now_ct = datetime.now(CENTRAL)
        event_dt = now_ct.replace(hour=20, minute=0, second=0, microsecond=0)
        ics = generate_ics("Weekly Scorecard \u2014 Burn Log", event_dt,
                           f"Cardio: {scorecard['cardio_days']}, "
                           f"Lifts: {scorecard['lift_days']}, "
                           f"Drinks: {scorecard['total_drinks']}, "
                           f"Sleep: {scorecard['avg_sleep']}h, "
                           f"Logged: {scorecard['days_logged']}/7")

    # Send email
    send_email(recipient, subject, html, ics, resend_key)

    print("Done.")


if __name__ == "__main__":
    main()
