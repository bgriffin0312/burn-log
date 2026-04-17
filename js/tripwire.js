(async function () {
  const root = document.getElementById("root");

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    renderError("No token in URL. Open this page from the link in your Tripwire email.");
    return;
  }

  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    renderError(
      "Burn Log isn't configured in this browser yet. Open this link from a device " +
      "where you've already set up the app (same browser), or visit " +
      `<a href="index.html" style="color:#a3e635">the app</a> first to enter your Supabase credentials.`
    );
    return;
  }

  const supa = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  let response, scorecard;
  try {
    const rResp = await supa
      .from("tripwire_responses")
      .select("*")
      .eq("response_token", token)
      .limit(1)
      .maybeSingle();

    if (rResp.error) throw rResp.error;
    response = rResp.data;

    if (!response) {
      renderError("This link is invalid or has already expired.");
      return;
    }

    if (response.token_expires_at && new Date(response.token_expires_at) < new Date()) {
      renderError("This link expired. Wait for the next Tripwire email to respond.");
      return;
    }

    const sResp = await supa
      .from("weekly_scorecards")
      .select("*")
      .eq("id", response.scorecard_id)
      .limit(1)
      .maybeSingle();
    if (sResp.error) throw sResp.error;
    scorecard = sResp.data;
  } catch (err) {
    console.error(err);
    renderError("Couldn't load your scorecard. " + (err.message || ""));
    return;
  }

  if (response.submitted_at) {
    renderAlreadySubmitted(response, scorecard);
    return;
  }

  if (response.report_type === "thursday_check") {
    renderThursdayForm(supa, response, scorecard);
  } else {
    renderSundayForm(supa, response, scorecard);
  }

  function renderError(msg) {
    root.innerHTML = `
      <h1>Tripwire</h1>
      <p class="sub">Burn Log</p>
      <div class="error">${msg}</div>
      <footer>Burn Log Tripwire System</footer>
    `;
  }

  function renderAlreadySubmitted(response, scorecard) {
    const when = new Date(response.submitted_at).toLocaleString();
    const summary = summarizeSubmission(response);
    root.innerHTML = `
      <h1>Already Logged</h1>
      <p class="sub">Response submitted ${when}</p>
      <div class="success">
        Thanks — your ${response.report_type === "thursday_check" ? "weekend pre-commit" : "weekly reflection"} is in.
      </div>
      <div class="card">
        <h2>What you said</h2>
        ${summary}
      </div>
      <footer>Burn Log Tripwire System</footer>
    `;
  }

  function summarizeSubmission(r) {
    if (r.report_type === "thursday_check") {
      return `
        <div class="rating-row"><span class="label">Planned cardio</span><span class="value">${escapeHtml(valueOrDash(r.planned_cardio))}</span></div>
        <div class="rating-row"><span class="label">Planned lifts</span><span class="value">${escapeHtml(valueOrDash(r.planned_lifts))}</span></div>
        <div class="rating-row"><span class="label">Drink ceiling</span><span class="value">${escapeHtml(valueOrDash(r.drink_ceiling))}</span></div>
        ${r.notes ? `<div class="note">Notes: ${escapeHtml(r.notes)}</div>` : ""}
      `;
    }
    const causes = r.red_causes || {};
    const causeRows = Object.entries(causes)
      .map(([k, v]) => `<div class="rating-row"><span class="label">${escapeHtml(k)}</span><span class="value">${escapeHtml(v)}</span></div>`)
      .join("");
    return `
      ${causeRows}
      ${r.lever_next_week ? `<div class="rating-row"><span class="label">Lever next week</span><span class="value">${escapeHtml(r.lever_next_week)}</span></div>` : ""}
      ${r.notes ? `<div class="note">Notes: ${escapeHtml(r.notes)}</div>` : ""}
    `;
  }

  function renderThursdayForm(supa, response, scorecard) {
    root.innerHTML = `
      <h1>Weekend Pre-Commit</h1>
      <p class="sub">Week of ${scorecard.week_start}</p>

      <div class="card">
        <h2>Mon–Thu so far</h2>
        <div class="rating-row"><span class="label">Cardio sessions</span><span class="value">${scorecard.cardio_days ?? 0}</span></div>
        <div class="rating-row"><span class="label">Lift sessions</span><span class="value">${scorecard.lift_days ?? 0}</span></div>
        <div class="rating-row"><span class="label">Standard drinks</span><span class="value">${scorecard.total_drinks}</span></div>
      </div>

      <form id="form">
        <div class="card">
          <h2>Fri–Sun plan</h2>
          <label for="planned_cardio">Planned cardio sessions (running, cycling, swimming, etc.)</label>
          <input type="number" id="planned_cardio" name="planned_cardio" min="0" max="10" step="1" required>

          <label for="planned_lifts">Planned lifting sessions</label>
          <input type="number" id="planned_lifts" name="planned_lifts" min="0" max="10" step="1" required>

          <label for="ceiling">Weekend drink ceiling (standard drinks)</label>
          <input type="number" id="ceiling" name="drink_ceiling" min="0" max="30" step="1" required>

          <label for="notes">Notes (optional)</label>
          <textarea id="notes" name="notes" placeholder="Anything else you want future-you to know?"></textarea>
        </div>
        <button type="submit" id="submit">Lock it in</button>
      </form>
      <footer>Burn Log Tripwire System</footer>
    `;
    document.getElementById("form").addEventListener("submit", onSubmit);

    async function onSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById("submit");
      btn.disabled = true;
      btn.textContent = "Saving…";
      const data = {
        planned_cardio: parseInt(document.getElementById("planned_cardio").value, 10),
        planned_lifts: parseInt(document.getElementById("planned_lifts").value, 10),
        drink_ceiling: parseInt(document.getElementById("ceiling").value, 10),
        notes: document.getElementById("notes").value.trim() || null,
        submitted_at: new Date().toISOString(),
      };
      try {
        const { error } = await supa
          .from("tripwire_responses")
          .update(data)
          .eq("response_token", token);
        if (error) throw error;
        Object.assign(response, data);
        renderAlreadySubmitted(response, scorecard);
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = "Lock it in";
        alert("Couldn't save: " + (err.message || err));
      }
    }
  }

  function renderSundayForm(supa, response, scorecard) {
    const ratings = [
      ["cardio", "Cardio", `${scorecard.cardio_days ?? 0} sessions`, scorecard.cardio_rating],
      ["lifts", "Lifts", `${scorecard.lift_days ?? 0} sessions`, scorecard.lift_rating],
      ["alcohol", "Alcohol", `${scorecard.total_drinks} drinks`, scorecard.alcohol_rating],
      ["sleep", "Sleep", scorecard.avg_sleep ? `${scorecard.avg_sleep}h avg` : "No data", scorecard.sleep_rating],
      ["logging", "Logging", `${scorecard.days_logged}/7 days`, scorecard.logging_rating],
    ];

    const ratingsHtml = ratings.map(([key, label, val, rating]) => `
      <div class="rating-row">
        <span class="label">${label}</span>
        <span class="value">${val} <span class="pill ${rating}">${rating || "n/a"}</span></span>
      </div>
    `).join("");

    const redKeys = ratings.filter(([, , , r]) => r === "red").map(([k, label]) => [k, label]);

    const redFormHtml = redKeys.length === 0
      ? `<p class="note">No reds this week. Nice.</p>`
      : redKeys.map(([k, label]) => `
          <label for="cause_${k}">${label}: what happened?</label>
          <select id="cause_${k}" name="cause_${k}" required>
            <option value="">— choose —</option>
            <option value="illness">Illness</option>
            <option value="travel">Travel</option>
            <option value="social">Social event</option>
            <option value="work_stress">Work stress</option>
            <option value="low_motivation">Low motivation</option>
            <option value="schedule_creep">Schedule creep</option>
            <option value="other">Other</option>
          </select>
        `).join("");

    root.innerHTML = `
      <h1>Weekly Reflection</h1>
      <p class="sub">Week of ${scorecard.week_start} – ${scorecard.week_end}</p>

      <div class="card">
        <h2>This week's scorecard</h2>
        ${ratingsHtml}
      </div>

      <form id="form">
        ${redKeys.length ? `<div class="card"><h2>What drove the reds?</h2>${redFormHtml}</div>` : `<div class="card">${redFormHtml}</div>`}

        <div class="card">
          <h2>Lever for next week</h2>
          <label for="lever">Pick ONE thing you're protecting</label>
          <input type="text" id="lever" name="lever_next_week" maxlength="160" placeholder="e.g. No alcohol in the house" required>
          <p class="note">Short and specific. You'll see this at the top of next Sunday's email.</p>

          <label for="notes">Notes (optional)</label>
          <textarea id="notes" name="notes"></textarea>
        </div>

        <button type="submit" id="submit">Commit</button>
      </form>
      <footer>Burn Log Tripwire System</footer>
    `;
    document.getElementById("form").addEventListener("submit", onSubmit);

    async function onSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById("submit");
      btn.disabled = true;
      btn.textContent = "Saving…";

      const red_causes = {};
      for (const [k] of redKeys) {
        red_causes[k] = document.getElementById(`cause_${k}`).value;
      }

      const data = {
        red_causes: Object.keys(red_causes).length ? red_causes : null,
        lever_next_week: document.getElementById("lever").value.trim() || null,
        notes: document.getElementById("notes").value.trim() || null,
        submitted_at: new Date().toISOString(),
      };

      try {
        const { error } = await supa
          .from("tripwire_responses")
          .update(data)
          .eq("response_token", token);
        if (error) throw error;
        Object.assign(response, data);
        renderAlreadySubmitted(response, scorecard);
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = "Commit";
        alert("Couldn't save: " + (err.message || err));
      }
    }
  }

  function valueOrDash(v) {
    return v === null || v === undefined ? "—" : String(v);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
