// Chart.js trend visualizations

const Charts = {
  instances: [],

  destroy() {
    for (const chart of this.instances) {
      chart.destroy();
    }
    this.instances = [];
  },

  async loadTrends(container) {
    container.innerHTML = '<p class="trends-loading">Loading trends...</p>';

    try {
      const today = todayString();
      const startDate = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
      const [entries, burns] = await Promise.all([
        getEntriesForDateRange(startDate, today),
        getBurnsForDateRange(startDate, today)
      ]);

      // Build 14 days of data
      const labels = [];
      const data = {
        calories: [], net_calories: [], fiber: [], saturated_fat: [],
        protein: [], sodium: [], added_sugar: [], vitamin_d: []
      };

      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const dayEntries = entries.filter(e => e.date === dateStr);
        const dayBurns = burns.filter(b => b.date === dateStr);
        const totals = calcTotals(dayEntries);
        const burned = dayBurns.reduce((s, b) => s + (b.calories || 0), 0);

        labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        data.calories.push(totals.calories);
        data.net_calories.push(totals.calories - burned);
        data.fiber.push(totals.fiber);
        data.saturated_fat.push(totals.saturated_fat);
        data.protein.push(totals.protein);
        data.sodium.push(totals.sodium);
        data.added_sugar.push(totals.added_sugar);
        data.vitamin_d.push(totals.vitamin_d);
      }

      this.destroy();

      container.innerHTML = `
        <div class="trends-charts">
          <div class="chart-wrap"><canvas id="chart-calories"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-protein"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-fiber"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-satfat"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-sodium"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-sugar"></canvas></div>
          <div class="chart-wrap"><canvas id="chart-vitd"></canvas></div>
        </div>
        <button id="export-csv" class="export-btn">Export CSV</button>
      `;

      const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            titleColor: '#e5e5e5',
            bodyColor: '#e5e5e5',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 8,
            titleFont: { family: "'DM Sans', sans-serif", size: 11 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 }
          }
        },
        scales: {
          x: {
            ticks: { color: '#555', font: { size: 9, family: "'JetBrains Mono', monospace" }, maxRotation: 45 },
            grid: { color: '#1a1a1a' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#555', font: { size: 10, family: "'JetBrains Mono', monospace" } },
            grid: { color: '#1a1a1a' }
          }
        }
      };

      this.createChart("chart-calories", "Net Calories", labels, data.net_calories,
        "#a3e635", NUTRIENT_TARGETS.calories.goal, chartDefaults);
      this.createChart("chart-protein", "Protein (g)", labels, data.protein,
        "#34d399", NUTRIENT_TARGETS.protein.goal, chartDefaults);
      this.createChart("chart-fiber", "Fiber (g)", labels, data.fiber,
        "#22d3ee", NUTRIENT_TARGETS.fiber.goal, chartDefaults);
      this.createChart("chart-satfat", "Sat Fat (g)", labels, data.saturated_fat,
        "#f97316", NUTRIENT_TARGETS.saturated_fat.goal, chartDefaults);
      this.createChart("chart-sodium", "Sodium (mg)", labels, data.sodium,
        "#a78bfa", NUTRIENT_TARGETS.sodium.goal, chartDefaults);
      this.createChart("chart-sugar", "Added Sugar (g)", labels, data.added_sugar,
        "#fb7185", NUTRIENT_TARGETS.added_sugar.goal, chartDefaults);
      this.createChart("chart-vitd", "Vitamin D (IU)", labels, data.vitamin_d,
        "#fbbf24", NUTRIENT_TARGETS.vitamin_d.goal, chartDefaults);

      // Bind export after render
      document.getElementById("export-csv")?.addEventListener("click", () => this.exportCSV());

    } catch (err) {
      console.error("Failed to load trends:", err);
      container.innerHTML = '<p class="trends-loading">Failed to load trends.</p>';
    }
  },

  createChart(canvasId, title, labels, data, color, goalValue, defaults) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data,
            backgroundColor: data.map(() => color + "55"),
            borderColor: color,
            borderWidth: 1,
            borderRadius: 3
          }
        ]
      },
      options: {
        ...defaults,
        plugins: {
          ...defaults.plugins,
          title: {
            display: true,
            text: title,
            color: '#888',
            font: { size: 12, family: "'DM Sans', sans-serif", weight: '500' },
            padding: { bottom: 8 }
          },
          annotation: {
            annotations: {
              goalLine: {
                type: 'line',
                yMin: goalValue,
                yMax: goalValue,
                borderColor: '#ffffff33',
                borderWidth: 1,
                borderDash: [4, 4],
                label: {
                  display: true,
                  content: `Goal: ${goalValue}`,
                  position: 'end',
                  backgroundColor: 'transparent',
                  color: '#555',
                  font: { size: 9, family: "'JetBrains Mono', monospace" }
                }
              }
            }
          }
        }
      }
    });

    this.instances.push(chart);
  },

  async exportCSV() {
    try {
      const entries = await getAllEntries();
      if (entries.length === 0) {
        alert("No entries to export.");
        return;
      }

      const headers = ["date", "time", "name", "portion", "calories", "fiber", "saturated_fat", "sodium", "protein", "added_sugar", "vitamin_d", "preset_key", "from_claude"];
      const rows = entries.map(e =>
        headers.map(h => {
          const val = e[h] ?? "";
          const str = String(val);
          return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(",")
      );

      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `burnlog-export-${todayString()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed: " + err.message);
    }
  }
};
