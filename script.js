
const LEAGUE_AVERAGE = 1.35;
const MAX_GOALS = 24;

// Factorial
function factorial(n) {
    let result = 1;

    for (let i = 2; i <= n; i++) {
        result *= i;
    }

    return result;
}

// Poisson probability
function poisson(lambda, goals) {
    return (
        Math.exp(-lambda) *
        Math.pow(lambda, goals) /
        factorial(goals)
    );
}

// Recent form adjustment
function getFormMultiplier(form) {
    form = form.toUpperCase();

    if (!/^[WDL]{5}$/.test(form)) {
        throw new Error(
            "Enter exactly five results using W, D, or L."
        );
    }

    let points = 0;

    for (const result of form) {
        if (result === "W") points += 3;
        if (result === "D") points += 1;
    }

    const pointsPerGame = points / 5;

    return Math.max(
        0.85,
        Math.min(
            1.15,
            1 + (pointsPerGame - 1.5) * 0.08
        )
    );
}

// Calculate expected goals
function calculateXG(
    attack,
    opponentDefense,
    homeAdvantage,
    formMultiplier
) {
    const xG =
        (attack * opponentDefense / LEAGUE_AVERAGE) *
        homeAdvantage *
        formMultiplier;

    return Math.max(0, Math.min(8, xG));
}

// Format percentages
function percent(value, total) {
    return ((value / total) * 100).toFixed(1) + "%";
}

// Safely display user-entered team names
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

// The currently selected API fixture, if the user loaded one.
// Manual predictions will have no fixture ID.
let selectedFixture = null;
let latestPrediction = null;
let venueModelStats = null;

function beginButtonLoading(buttonId, loadingLabel) {
    const button = document.getElementById(buttonId);
    if (!button) return () => {};
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = loadingLabel;
    button.setAttribute("aria-busy", "true");
    return () => {
        button.disabled = false;
        button.textContent = originalLabel;
        button.removeAttribute("aria-busy");
    };
}

function closeAnalysisDropdowns() {
    ["teamProfilesDropdown", "venueComparisonDropdown", "headToHeadDropdown"].forEach(id => {
        const dropdown = document.getElementById(id);
        if (dropdown) dropdown.open = false;
    });
}

function openAnalysisDropdown(id) {
    const dropdown = document.getElementById(id);
    if (dropdown) dropdown.open = true;
}

function blendVenueAverage(overallAverage, venueStats) {
    if (!venueStats || !venueStats.played || !Number.isFinite(venueStats.averageGoalsScored)) {
        return overallAverage;
    }
    // Increase the venue-specific weight as its sample grows, capped at 65%.
    const venueWeight = Math.min(0.65, venueStats.played / 8 * 0.65);
    return overallAverage * (1 - venueWeight) + venueStats.averageGoalsScored * venueWeight;
}

// Main prediction function
function predictMatch() {
    const predictButton = document.getElementById("predictButton");
    if (predictButton) {
        predictButton.textContent = "Calculating prediction...";
        predictButton.disabled = true;
    }

    const home = document.getElementById("homeTeam").value.trim();
    const away = document.getElementById("awayTeam").value.trim();

    const homeScored = Number(
        document.getElementById("homeScored").value
    );

    const homeConceded = Number(
        document.getElementById("homeConceded").value
    );

    const awayScored = Number(
        document.getElementById("awayScored").value
    );

    const awayConceded = Number(
        document.getElementById("awayConceded").value
    );

    const homeForm = document.getElementById("homeForm").value;
    const awayForm = document.getElementById("awayForm").value;

    const stats = [
        homeScored,
        homeConceded,
        awayScored,
        awayConceded
    ];

    if (
        !home ||
        !away ||
        stats.some(value =>
            !Number.isFinite(value) ||
            value < 0 ||
            value > 8
        )
    ) {
        alert(
            "Enter both team names and valid statistics between 0 and 8."
        );
        if (predictButton) { predictButton.textContent = "Predict Match"; predictButton.disabled = false; }
        return;
    }

    if (home.toLowerCase() === away.toLowerCase()) {
        alert("Please select two different teams.");
        if (predictButton) { predictButton.textContent = "Predict Match"; predictButton.disabled = false; }
        return;
    }

    let homeMultiplier;
    let awayMultiplier;

    try {
        homeMultiplier = getFormMultiplier(homeForm);
        awayMultiplier = getFormMultiplier(awayForm);
    } catch (error) {
        alert(error.message);
        if (predictButton) { predictButton.textContent = "Predict Match"; predictButton.disabled = false; }
        return;
    }

    // Blend overall recent form with venue-specific performance when available.
    // A larger venue sample receives more weight, up to 65%.
    const modelHomeScored = venueModelStats
        ? blendVenueAverage(homeScored, venueModelStats.homeVenue)
        : homeScored;
    const modelAwayConceded = venueModelStats
        ? blendVenueAverage(awayConceded, venueModelStats.awayVenueDefense)
        : awayConceded;
    const modelAwayScored = venueModelStats
        ? blendVenueAverage(awayScored, venueModelStats.awayVenueAttack)
        : awayScored;
    const modelHomeConceded = venueModelStats
        ? blendVenueAverage(homeConceded, venueModelStats.homeVenueDefense)
        : homeConceded;

    const homeXG = calculateXG(
        modelHomeScored,
        modelAwayConceded,
        1.10,
        homeMultiplier
    );

    const awayXG = calculateXG(
        modelAwayScored,
        modelHomeConceded,
        0.90,
        awayMultiplier
    );

    // Generate all possible score combinations
    const scores = [];

    for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {

            const probability =
                poisson(homeXG, h) *
                poisson(awayXG, a);

            scores.push({
                homeGoals: h,
                awayGoals: a,
                totalGoals: h + a,
                probability
            });
        }
    }

    // Normalize probabilities
    const total = scores.reduce(
        (sum, score) => sum + score.probability,
        0
    );

    // Sort most likely scorelines
    const topScores = [...scores]
        .sort((a, b) =>
            b.probability - a.probability
        )
        .slice(0, 5);

    // Match outcome calculations
    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

    let over15 = 0;
    let over25 = 0;
    let over35 = 0;

    let bothScore = 0;

    let homeCleanSheet = 0;
    let awayCleanSheet = 0;

    scores.forEach(score => {

        const p = score.probability;

        if (score.homeGoals > score.awayGoals) {
            homeWin += p;
        } else if (score.homeGoals === score.awayGoals) {
            draw += p;
        } else {
            awayWin += p;
        }

        if (score.totalGoals >= 2) over15 += p;
        if (score.totalGoals >= 3) over25 += p;
        if (score.totalGoals >= 4) over35 += p;

        if (
            score.homeGoals > 0 &&
            score.awayGoals > 0
        ) {
            bothScore += p;
        }

        if (score.awayGoals === 0) {
            homeCleanSheet += p;
        }

        if (score.homeGoals === 0) {
            awayCleanSheet += p;
        }
    });

    const bestScore = topScores[0];

    // Keep the prediction as structured data so it can be graded later.
    latestPrediction = {
        predictedHomeGoals: bestScore.homeGoals,
        predictedAwayGoals: bestScore.awayGoals,
        homeXG: Number(homeXG.toFixed(3)),
        awayXG: Number(awayXG.toFixed(3)),
        probabilities: {
            homeWin: Number((homeWin / total).toFixed(6)),
            draw: Number((draw / total).toFixed(6)),
            awayWin: Number((awayWin / total).toFixed(6)),
            over25: Number((over25 / total).toFixed(6)),
            under25: Number(((total - over25) / total).toFixed(6)),
            bttsYes: Number((bothScore / total).toFixed(6)),
            bttsNo: Number(((total - bothScore) / total).toFixed(6))
        }
    };

    // Build top five scoreline HTML
    const scoreHTML = topScores.map((score, index) => `
        <div class="score-row">
            <span>#${index + 1}</span>

            <strong>
                ${score.homeGoals} - ${score.awayGoals}
            </strong>

            <span>
                ${percent(score.probability, total)}
            </span>
        </div>
    `).join("");

    // Display results
    document.getElementById("results").innerHTML = `
        <h2>⚽ Prediction Results</h2>

        <h3>
            ${escapeHTML(home)} vs ${escapeHTML(away)}
        </h3>

        <div class="score">
            ${bestScore.homeGoals} - ${bestScore.awayGoals}
        </div>

        <p>Most Likely Score</p>

        <div class="prediction-section">
            <h3>Expected Goals (xG)</h3>

            <div class="stats-row">
                <div>
                    <strong>${homeXG.toFixed(2)}</strong>
                    <p>${escapeHTML(home)}</p>
                </div>

                <div>
                    <strong>${awayXG.toFixed(2)}</strong>
                    <p>${escapeHTML(away)}</p>
                </div>
            </div>
        </div>

        <div class="prediction-section">
            <h3>Match Outcome</h3>

            <div class="probabilities">
                <div>
                    <h3>${percent(homeWin, total)}</h3>
                    <p>Home Win</p>
                </div>

                <div>
                    <h3>${percent(draw, total)}</h3>
                    <p>Draw</p>
                </div>

                <div>
                    <h3>${percent(awayWin, total)}</h3>
                    <p>Away Win</p>
                </div>
            </div>
        </div>

        <div class="prediction-section">
            <h3>Over / Under Goals</h3>

            <div class="market-row">
                <span>Over 1.5 Goals</span>
                <strong>${percent(over15, total)}</strong>
            </div>

            <div class="market-row">
                <span>Under 1.5 Goals</span>
                <strong>${percent(total - over15, total)}</strong>
            </div>

            <div class="market-row">
                <span>Over 2.5 Goals</span>
                <strong>${percent(over25, total)}</strong>
            </div>

            <div class="market-row">
                <span>Under 2.5 Goals</span>
                <strong>${percent(total - over25, total)}</strong>
            </div>

            <div class="market-row">
                <span>Over 3.5 Goals</span>
                <strong>${percent(over35, total)}</strong>
            </div>

            <div class="market-row">
                <span>Under 3.5 Goals</span>
                <strong>${percent(total - over35, total)}</strong>
            </div>
        </div>

        <div class="prediction-section">
            <h3>Both Teams To Score</h3>

            <div class="market-row">
                <span>BTTS - Yes</span>
                <strong>${percent(bothScore, total)}</strong>
            </div>

            <div class="market-row">
                <span>BTTS - No</span>
                <strong>${percent(total - bothScore, total)}</strong>
            </div>
        </div>

        <div class="prediction-section">
            <h3>Clean Sheet Probability</h3>

            <div class="market-row">
                <span>${escapeHTML(home)} Clean Sheet</span>
                <strong>${percent(homeCleanSheet, total)}</strong>
            </div>

            <div class="market-row">
                <span>${escapeHTML(away)} Clean Sheet</span>
                <strong>${percent(awayCleanSheet, total)}</strong>
            </div>
        </div>

        <div class="prediction-section">
            <h3>Top 5 Correct Scores</h3>

            ${scoreHTML}
        </div>

        <p class="profile-note">Model: Poisson score probabilities using recent goals, recent form, home advantage${venueModelStats ? " and venue-specific performance (sample-weighted)" : ""}.</p>
        <p class="disclaimer">
            Predictions are statistical estimates,
            not guaranteed match outcomes.
        </p>
    `;

    // Save only after a valid prediction has been generated.
    savePrediction();
    if (predictButton) {
        predictButton.textContent = "Predict Match";
        predictButton.disabled = false;
    }
}

const fixtureSelect = document.getElementById("fixtureSelect");
const apiStatus = document.getElementById("apiStatus");

fixtureSelect.addEventListener("change", () => {
    selectedFixture = null;
    venueModelStats = null;
    closeAnalysisDropdowns();
});

// Format a local date as YYYY-MM-DD
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// Load fixtures from selected league
async function loadFixtures() {
    const finishButton = beginButtonLoading("loadFixturesButton", "Loading fixtures...");
    const league = document.getElementById("leagueSelect").value;
    apiStatus.textContent = "Loading and organizing fixtures by match date...";
    fixtureSelect.innerHTML = '<option value="">Loading...</option>';
    closeAnalysisDropdowns();
    selectedFixture = null;
    venueModelStats = null;

    try {
        const today = new Date();
        const future = new Date();
        const rangeDays = Number(document.getElementById("fixtureRange")?.value || 14);
        future.setDate(today.getDate() + rangeDays);
        const dateFrom = formatLocalDate(today);
        const dateTo = formatLocalDate(future);
        const response = await fetch(`/api/competitions/${league}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Server error ${response.status}: ${data.error || "Unable to load fixtures."}`);
        }

        const matches = (data.matches || [])
            .filter(match => ["SCHEDULED", "TIMED"].includes(match.status))
            .sort((a, b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0));

        fixtureSelect.innerHTML = "";
        if (!matches.length) {
            fixtureSelect.innerHTML = '<option value="">No upcoming matches found</option>';
            apiStatus.textContent = "No fixtures available in this date range.";
            return;
        }

        const grouped = new Map();
        matches.forEach(match => {
            const date = match.utcDate ? new Date(match.utcDate) : null;
            const dayKey = date && !Number.isNaN(date.getTime())
                ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`
                : "date-unavailable";
            if (!grouped.has(dayKey)) grouped.set(dayKey, []);
            grouped.get(dayKey).push(match);
        });

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = `Select a match (${matches.length} available)`;
        placeholder.selected = true;
        placeholder.disabled = true;
        fixtureSelect.appendChild(placeholder);

        grouped.forEach((dayMatches, dayKey) => {
            const group = document.createElement("optgroup");
            const dayDate = dayMatches[0].utcDate ? new Date(dayMatches[0].utcDate) : null;
            const dayLabel = dayDate && !Number.isNaN(dayDate.getTime())
                ? dayDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })
                : "Date unavailable";
            group.label = `${dayLabel} · ${dayMatches.length} match${dayMatches.length === 1 ? "" : "es"}`;

            dayMatches.forEach(match => {
                const option = document.createElement("option");
                option.value = match.id;
                option.dataset.homeId = match.homeTeam.id;
                option.dataset.awayId = match.awayTeam.id;
                option.dataset.homeName = match.homeTeam.name;
                option.dataset.awayName = match.awayTeam.name;
                option.dataset.utcDate = match.utcDate || "";
                option.dataset.leagueCode = league;
                option.dataset.competitionName = data.competition?.name || league;
                const kickoff = match.utcDate ? new Date(match.utcDate) : null;
                const timeLabel = kickoff && !Number.isNaN(kickoff.getTime())
                    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Time TBC";
                option.textContent = `${timeLabel}  |  ${match.homeTeam.name} vs ${match.awayTeam.name}`;
                group.appendChild(option);
            });
            fixtureSelect.appendChild(group);
        });

        apiStatus.textContent = `${matches.length} upcoming matches loaded and grouped by date (next ${rangeDays} days). Kickoff times are shown in your local time.`;
    } catch (error) {
        fixtureSelect.innerHTML = '<option value="">Unable to load matches</option>';
        apiStatus.textContent = error.message;
    } finally {
        finishButton();
    }
}

// Load statistics for the selected match
async function loadSelectedTeamStats() {
    const finishButton = beginButtonLoading("loadStatsButton", "Loading statistics...");
    const option = fixtureSelect.selectedOptions[0];
    if (!option || !option.dataset.homeId) {
        apiStatus.textContent = "Please select a match first.";
        finishButton();
        return;
    }

    closeAnalysisDropdowns();
    venueModelStats = null;
    apiStatus.textContent = "Loading team statistics and venue-specific performance...";
    try {
        const homeId = option.dataset.homeId;
        const awayId = option.dataset.awayId;
        selectedFixture = {
            fixtureId: Number(option.value),
            leagueCode: option.dataset.leagueCode || "",
            competitionName: option.dataset.competitionName || "",
            utcDate: option.dataset.utcDate || null,
            homeTeamId: Number(homeId),
            awayTeamId: Number(awayId),
            homeTeamName: option.dataset.homeName || "",
            awayTeamName: option.dataset.awayName || ""
        };

        const [homeResponse, awayResponse] = await Promise.all([
            fetch(`/api/teams/${homeId}/recent-stats`),
            fetch(`/api/teams/${awayId}/recent-stats`)
        ]);
        const [home, away] = await Promise.all([homeResponse.json(), awayResponse.json()]);
        if (!homeResponse.ok || !awayResponse.ok) {
            throw new Error(home.error || away.error || "Unable to retrieve team statistics.");
        }

        document.getElementById("homeTeam").value = home.team;
        document.getElementById("awayTeam").value = away.team;
        document.getElementById("homeScored").value = home.averageGoalsScored;
        document.getElementById("homeConceded").value = home.averageGoalsConceded;
        document.getElementById("homeForm").value = home.recentForm;
        document.getElementById("awayScored").value = away.averageGoalsScored;
        document.getElementById("awayConceded").value = away.averageGoalsConceded;
        document.getElementById("awayForm").value = away.recentForm;

        // Optional enrichment: if the provider allows team profile access, use home/away samples in the model.
        // If unavailable, retain the original recent-statistics prediction without failing the workflow.
        const profileResponses = await Promise.allSettled([
            fetch(`/api/teams/${homeId}/profile?limit=10`),
            fetch(`/api/teams/${awayId}/profile?limit=10`)
        ]);
        if (profileResponses.every(item => item.status === "fulfilled" && item.value.ok)) {
            const [homeProfile, awayProfile] = await Promise.all(profileResponses.map(item => item.value.json()));
            const homeVenue = homeProfile.venueStats?.home;
            const awayVenue = awayProfile.venueStats?.away;
            if (homeVenue?.played || awayVenue?.played) {
                venueModelStats = {
                    homeVenue: homeVenue?.played ? { ...homeVenue, averageGoalsScored: homeVenue.averageGoalsScored } : null,
                    homeVenueDefense: homeVenue?.played ? { played: homeVenue.played, averageGoalsScored: homeVenue.averageGoalsConceded } : null,
                    awayVenueAttack: awayVenue?.played ? { ...awayVenue, averageGoalsScored: awayVenue.averageGoalsScored } : null,
                    awayVenueDefense: awayVenue?.played ? { played: awayVenue.played, averageGoalsScored: awayVenue.averageGoalsConceded } : null
                };
            }
        }

        apiStatus.textContent = venueModelStats
            ? "Team statistics and venue-specific data loaded. Generating an enhanced prediction..."
            : "Team statistics loaded. Venue-specific data was unavailable, so the standard model will be used.";
        predictMatch();
    } catch (error) {
        apiStatus.textContent = error.message;
    } finally {
        finishButton();
    }
}


// ======================================
// TEAM PROFILES & HISTORICAL PERFORMANCE
// ======================================

async function loadTeamProfiles() {
    const finishButton = beginButtonLoading("loadProfilesButton", "Loading profiles...");
    openAnalysisDropdown("teamProfilesDropdown");
    apiStatus.textContent = "Loading team profiles and recent match history...";
    const option = fixtureSelect.selectedOptions[0];
    const panel = document.getElementById("teamProfiles");

    if (!option || !option.dataset.homeId || !option.dataset.awayId) {
        panel.innerHTML = "<h2>📈 Team Profiles &amp; Historical Performance</h2><p>Please load and select a match first.</p>";
        apiStatus.textContent = "Please select a fixture first.";
        finishButton();
        return;
    }

    panel.innerHTML = "<h2>📈 Team Profiles &amp; Historical Performance</h2><p>Loading each team's last 10 completed matches...</p>";

    try {
        const homeId = option.dataset.homeId;
        const awayId = option.dataset.awayId;
        const [homeResponse, awayResponse] = await Promise.all([
            fetch(`/api/teams/${homeId}/profile?limit=10`),
            fetch(`/api/teams/${awayId}/profile?limit=10`)
        ]);
        const [home, away] = await Promise.all([
            homeResponse.json(), awayResponse.json()
        ]);

        if (!homeResponse.ok || !awayResponse.ok) {
            throw new Error(home.error || away.error || "Unable to load team profiles.");
        }

        const renderProfile = profile => {
            const rows = (profile.recentMatches || []).map(match => {
                const resultClass = match.result === "W" ? "result-win" :
                    match.result === "D" ? "result-draw" : "result-loss";
                const resultLabel = match.result === "W" ? "Win" :
                    match.result === "D" ? "Draw" : "Loss";
                return `<div class="profile-result">
                    <span>${escapeHTML(match.date)} · ${escapeHTML(match.opponent)} (${escapeHTML(match.venue)})</span>
                    <strong class="${resultClass}">${match.goalsFor}–${match.goalsAgainst} · ${resultLabel}</strong>
                </div>`;
            }).join("");

            return `<article class="team-profile-card">
                <h3>${escapeHTML(profile.team)}</h3>
                <div class="profile-metrics">
                    <div><strong>${profile.matchesPlayed}</strong><span>Matches</span></div>
                    <div><strong>${profile.wins}-${profile.draws}-${profile.losses}</strong><span>W-D-L</span></div>
                    <div><strong>${profile.averageGoalsScored}</strong><span>Goals scored / game</span></div>
                    <div><strong>${profile.averageGoalsConceded}</strong><span>Goals conceded / game</span></div>
                    <div><strong>${profile.homeRecord}</strong><span>Home W-D-L</span></div>
                    <div><strong>${profile.awayRecord}</strong><span>Away W-D-L</span></div>
                </div>
                <p><strong>Recent form:</strong> ${escapeHTML(profile.recentForm)}</p>
                <div class="profile-results">${rows || "<p>No recent matches available.</p>"}</div>
            </article>`;
        };

        apiStatus.textContent = "Team profiles and historical match history loaded.";
        panel.innerHTML = `
            <h2>📈 Team Profiles &amp; Historical Performance</h2>
            <div class="team-profile-grid">
                ${renderProfile(home)}
                ${renderProfile(away)}
            </div>
            <p class="profile-note">Based on each team's latest 10 completed matches available from football-data.org. These matches may include other competitions, not only the currently selected league.</p>
        `;
    } catch (error) {
        panel.innerHTML = `<h2>📈 Team Profiles &amp; Historical Performance</h2><p>${escapeHTML(error.message)}</p>`;
        apiStatus.textContent = error.message;
    } finally {
        finishButton();
    }
}

// ======================================
// HOME & AWAY PERFORMANCE COMPARISON
// ======================================

async function loadVenueComparison() {
    const finishButton = beginButtonLoading("loadVenueButton", "Comparing venues...");
    openAnalysisDropdown("venueComparisonDropdown");
    apiStatus.textContent = "Comparing home and away performance...";
    const option = fixtureSelect.selectedOptions[0];
    const panel = document.getElementById("venueComparison");

    if (!option || !option.dataset.homeId || !option.dataset.awayId) {
        panel.innerHTML = "<h2>🏟️ Home &amp; Away Performance Comparison</h2><p>Please load and select a fixture first.</p>";
        apiStatus.textContent = "Please select a fixture first.";
        finishButton();
        return;
    }

    panel.innerHTML = "<h2>🏟️ Home &amp; Away Performance Comparison</h2><p>Comparing each team's venue-specific results from its latest 10 completed matches...</p>";

    try {
        const [homeResponse, awayResponse] = await Promise.all([
            fetch(`/api/teams/${option.dataset.homeId}/profile?limit=10`),
            fetch(`/api/teams/${option.dataset.awayId}/profile?limit=10`)
        ]);
        const [home, away] = await Promise.all([homeResponse.json(), awayResponse.json()]);
        if (!homeResponse.ok || !awayResponse.ok) {
            throw new Error(home.error || away.error || "Unable to load venue-specific team statistics.");
        }

        const homeVenue = home.venueStats?.home;
        const awayVenue = away.venueStats?.away;
        const renderVenue = (teamName, venueLabel, stats) => {
            if (!stats || !stats.played) {
                return `<article class="venue-card"><h3>${escapeHTML(teamName)}</h3><p>No ${venueLabel.toLowerCase()} matches were found in the latest 10 completed matches.</p></article>`;
            }
            return `<article class="venue-card">
                <h3>${escapeHTML(teamName)} <span>(${venueLabel})</span></h3>
                <div class="venue-metrics">
                    <div><strong>${stats.played}</strong><span>Matches</span></div>
                    <div><strong>${stats.record}</strong><span>W-D-L</span></div>
                    <div><strong>${stats.averageGoalsScored}</strong><span>Goals scored / match</span></div>
                    <div><strong>${stats.averageGoalsConceded}</strong><span>Goals conceded / match</span></div>
                </div>
                <p class="venue-goals">Goals: ${stats.goalsFor} scored · ${stats.goalsAgainst} conceded</p>
            </article>`;
        };

        apiStatus.textContent = "Home and away performance comparison loaded.";
        panel.innerHTML = `
            <h2>🏟️ Home &amp; Away Performance Comparison</h2>
            <div class="venue-grid">
                ${renderVenue(home.team, "HOME", homeVenue)}
                ${renderVenue(away.team, "AWAY", awayVenue)}
            </div>
            <p class="profile-note">The home team's home record is compared with the away team's away record. Statistics use each team's latest 10 completed matches across competitions, so the venue-specific sample may be smaller than 10. These figures are for context and do not automatically change your prediction.</p>
        `;
    } catch (error) {
        panel.innerHTML = `<h2>🏟️ Home &amp; Away Performance Comparison</h2><p>${escapeHTML(error.message)}</p><p class="profile-note">Your existing prediction, team profiles, and head-to-head features remain available.</p>`;
        apiStatus.textContent = error.message;
    } finally {
        finishButton();
    }
}

// ======================================
// HEAD-TO-HEAD ANALYSIS
// ======================================

async function loadHeadToHead() {
    const finishButton = beginButtonLoading("loadHeadToHeadButton", "Loading head-to-head...");
    openAnalysisDropdown("headToHeadDropdown");
    apiStatus.textContent = "Loading previous head-to-head meetings...";
    const option = fixtureSelect.selectedOptions[0];
    const panel = document.getElementById("headToHead");

    if (!option || !option.dataset.homeId || !option.dataset.awayId || !option.value) {
        panel.innerHTML = "<h2>🤝 Head-to-Head Analysis</h2><p>Please load and select a fixture first.</p>";
        apiStatus.textContent = "Please select a fixture first.";
        finishButton();
        return;
    }

    panel.innerHTML = "<h2>🤝 Head-to-Head Analysis</h2><p>Loading previous meetings...</p>";

    try {
        const response = await fetch(`/api/matches/${encodeURIComponent(option.value)}/head2head`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Unable to load head-to-head history (HTTP ${response.status}).`);
        }

        const homeId = String(option.dataset.homeId);
        const awayId = String(option.dataset.awayId);
        const homeName = option.dataset.homeName || "Home team";
        const awayName = option.dataset.awayName || "Away team";
        const matches = (data.matches || []).filter(match =>
            match.score?.fullTime?.home !== null && match.score?.fullTime?.home !== undefined &&
            match.score?.fullTime?.away !== null && match.score?.fullTime?.away !== undefined
        );

        let homeWins = 0, draws = 0, awayWins = 0;
        let homeGoals = 0, awayGoals = 0;
        const rows = matches.map(match => {
            const homeScore = Number(match.score.fullTime.home);
            const awayScore = Number(match.score.fullTime.away);
            const homeTeamId = String(match.homeTeam?.id);
            const awayTeamId = String(match.awayTeam?.id);
            let homeSideScore, awaySideScore;

            if (homeTeamId === homeId && awayTeamId === awayId) {
                homeSideScore = homeScore;
                awaySideScore = awayScore;
            } else if (homeTeamId === awayId && awayTeamId === homeId) {
                homeSideScore = awayScore;
                awaySideScore = homeScore;
            } else {
                return "";
            }

            homeGoals += homeSideScore;
            awayGoals += awaySideScore;
            if (homeSideScore > awaySideScore) homeWins++;
            else if (homeSideScore < awaySideScore) awayWins++;
            else draws++;

            const date = match.utcDate ? new Date(match.utcDate).toLocaleDateString() : "Date unavailable";
            const venue = `${escapeHTML(match.homeTeam?.name || "") } ${homeScore}–${awayScore} ${escapeHTML(match.awayTeam?.name || "")}`;
            return `<div class="profile-result h2h-result"><span>${escapeHTML(date)} · ${venue}</span><strong>${homeSideScore}–${awaySideScore} (${escapeHTML(homeName)} perspective)</strong></div>`;
        }).filter(Boolean);

        const total = homeWins + draws + awayWins;
        if (!total) {
            apiStatus.textContent = "No previous completed head-to-head meetings were found.";
            panel.innerHTML = `<h2>🤝 Head-to-Head Analysis</h2><p>No previous completed meetings were returned for ${escapeHTML(homeName)} and ${escapeHTML(awayName)}. This can happen when the provider has limited historical coverage for a competition or team.</p>`;
            return;
        }

        apiStatus.textContent = "Head-to-head history loaded.";
        panel.innerHTML = `
            <h2>🤝 Head-to-Head Analysis</h2>
            <p class="profile-note">Previous completed meetings between the selected teams. Scores and records are shown from ${escapeHTML(homeName)}'s perspective.</p>
            <div class="h2h-summary">
                <div><strong>${homeWins}</strong><span>${escapeHTML(homeName)} wins</span></div>
                <div><strong>${draws}</strong><span>Draws</span></div>
                <div><strong>${awayWins}</strong><span>${escapeHTML(awayName)} wins</span></div>
                <div><strong>${homeGoals}–${awayGoals}</strong><span>Total goals</span></div>
                <div><strong>${(homeGoals / total).toFixed(2)}</strong><span>${escapeHTML(homeName)} goals / match</span></div>
                <div><strong>${(awayGoals / total).toFixed(2)}</strong><span>${escapeHTML(awayName)} goals / match</span></div>
            </div>
            <h3>Previous Meetings (${total})</h3>
            <div class="profile-results">${rows.join("")}</div>
            <p class="profile-note">Historical results are provided for context only. They are not currently used to alter the prediction model.</p>
        `;
    } catch (error) {
        panel.innerHTML = `<h2>🤝 Head-to-Head Analysis</h2><p>${escapeHTML(error.message)}</p><p class="profile-note">If this endpoint is restricted by your football-data.org plan, the existing prediction and team-profile features will continue to work.</p>`;
        apiStatus.textContent = error.message;
    } finally {
        finishButton();
    }
}

// ======================================
// PREDICTION HISTORY
// ======================================

const HISTORY_KEY = "soccerPredictionHistory";

// Retrieve saved predictions. Older text-only entries remain readable.
function getPredictionHistory() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(HISTORY_KEY) || "[]"
        );
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        console.error("Could not read prediction history:", error);
        return [];
    }
}

// Save the latest prediction with structured match and probability data.
function savePrediction() {
    const homeTeam =
        document.getElementById("homeTeam").value.trim();
    const awayTeam =
        document.getElementById("awayTeam").value.trim();

    if (!homeTeam || !awayTeam || !latestPrediction) return;

    // Only attach a fixture ID when the selected fixture still matches
    // the team names currently being predicted.
    const fixtureMatchesTeams = selectedFixture &&
        selectedFixture.homeTeamName.toLowerCase() === homeTeam.toLowerCase() &&
        selectedFixture.awayTeamName.toLowerCase() === awayTeam.toLowerCase();

    const fixture = fixtureMatchesTeams ? selectedFixture : null;
    const now = new Date();

    const prediction = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now.toISOString(),
        matchDate: fixture ? fixture.utcDate : null,
        fixtureId: fixture ? fixture.fixtureId : null,
        leagueCode: fixture ? fixture.leagueCode : null,
        competitionName: fixture ? fixture.competitionName : null,
        homeTeamId: fixture ? fixture.homeTeamId : null,
        awayTeamId: fixture ? fixture.awayTeamId : null,
        homeTeam,
        awayTeam,
        predictedHomeGoals: latestPrediction.predictedHomeGoals,
        predictedAwayGoals: latestPrediction.predictedAwayGoals,
        homeXG: latestPrediction.homeXG,
        awayXG: latestPrediction.awayXG,
        probabilities: { ...latestPrediction.probabilities },
        predictionSource: fixture ? "football-data.org" : "manual",
        // Retained for compatibility with the existing history display.
        predictionDetails: document.getElementById("results").innerText.trim()
    };

    const history = getPredictionHistory();
    history.unshift(prediction);

    // Keep the latest 100 predictions.
    localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(history.slice(0, 100))
    );

    displayPredictionHistory();
}

// Grade a saved prediction against a completed match.
function gradePrediction(prediction, match) {
    const actualHome = match.score?.fullTime?.home;
    const actualAway = match.score?.fullTime?.away;

    if (!Number.isInteger(actualHome) || !Number.isInteger(actualAway)) {
        return false;
    }

    const predictedHome = prediction.predictedHomeGoals;
    const predictedAway = prediction.predictedAwayGoals;
    if (!Number.isInteger(predictedHome) || !Number.isInteger(predictedAway)) {
        return false;
    }
    const probabilities = prediction.probabilities || {};

    const predictedOutcome = predictedHome > predictedAway
        ? "HOME"
        : predictedHome < predictedAway ? "AWAY" : "DRAW";
    const actualOutcome = actualHome > actualAway
        ? "HOME"
        : actualHome < actualAway ? "AWAY" : "DRAW";

    const predictedOver25 = Number(probabilities.over25) >= Number(probabilities.under25);
    const actualOver25 = actualHome + actualAway >= 3;
    const predictedBtts = Number(probabilities.bttsYes) >= Number(probabilities.bttsNo);
    const actualBtts = actualHome > 0 && actualAway > 0;

    prediction.actualResult = {
        homeGoals: actualHome,
        awayGoals: actualAway,
        status: match.status,
        checkedAt: new Date().toISOString()
    };
    prediction.grade = {
        exactScore: predictedHome === actualHome && predictedAway === actualAway,
        outcome: predictedOutcome === actualOutcome,
        overUnder25: predictedOver25 === actualOver25,
        btts: predictedBtts === actualBtts,
        actualOutcome,
        predictedOutcome,
        predictedOver25: predictedOver25 ? "OVER" : "UNDER",
        actualOver25: actualOver25 ? "OVER" : "UNDER",
        predictedBtts: predictedBtts ? "YES" : "NO",
        actualBtts: actualBtts ? "YES" : "NO"
    };

    return true;
}

function accuracyLabel(correct, total) {
    return total ? `${(correct / total * 100).toFixed(1)}%` : "—";
}

// Render accuracy bars for each prediction market.
function renderMarketAnalytics(graded) {
    const container = document.getElementById("marketAccuracyChart");
    if (!container) return;

    const markets = [
        ["Match outcome", "outcome"],
        ["Exact score", "exactScore"],
        ["Over / Under 2.5", "overUnder25"],
        ["Both teams to score", "btts"]
    ];

    if (!graded.length) {
        container.innerHTML = "<p>Complete some matches to see your market accuracy.</p>";
        return;
    }

    container.innerHTML = "";
    markets.forEach(([label, key]) => {
        const correct = graded.filter(item => item.grade[key]).length;
        const rate = correct / graded.length * 100;
        const row = document.createElement("div");
        row.className = "accuracy-row";
        const heading = document.createElement("div");
        heading.className = "accuracy-heading";
        const name = document.createElement("span");
        name.textContent = label;
        const value = document.createElement("strong");
        value.textContent = `${rate.toFixed(1)}% (${correct}/${graded.length})`;
        heading.append(name, value);
        const track = document.createElement("div");
        track.className = "accuracy-track";
        const fill = document.createElement("div");
        fill.className = "accuracy-fill";
        fill.style.width = `${rate}%`;
        track.appendChild(fill);
        row.append(heading, track);
        container.appendChild(row);
    });
}

// Calculate proper probability scores and reliability bins from completed matches.
// No automatic model adjustment is performed from this historical sample.
function renderCalibrationAnalytics(graded) {
    const summary = document.getElementById("calibrationSummary");
    const binsBody = document.getElementById("calibrationBins");
    if (!summary || !binsBody) return;

    const clampProbability = value => {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
    };
    const rows = {
        "1X2 outcome": [],
        "Over 2.5 goals": [],
        "BTTS — Yes": []
    };

    graded.forEach(item => {
        const p = item.probabilities || {};
        const home = clampProbability(p.homeWin);
        const draw = clampProbability(p.draw);
        const away = clampProbability(p.awayWin);
        const over = clampProbability(p.over25);
        const btts = clampProbability(p.bttsYes);
        const actual = item.actualResult || {};
        const hg = Number(actual.homeGoals);
        const ag = Number(actual.awayGoals);
        if (!Number.isInteger(hg) || !Number.isInteger(ag)) return;

        if (home !== null && draw !== null && away !== null) {
            const outcome = hg > ag ? "HOME" : hg < ag ? "AWAY" : "DRAW";
            const triplet = [[home, outcome === "HOME"], [draw, outcome === "DRAW"], [away, outcome === "AWAY"]];
            const score = triplet.reduce((sum, [prob, occurred]) => sum + Math.pow(prob - (occurred ? 1 : 0), 2), 0) / 3;
            rows["1X2 outcome"].push({ score, observations: triplet });
        }
        if (over !== null) rows["Over 2.5 goals"].push({ score: Math.pow(over - (hg + ag >= 3 ? 1 : 0), 2), observations: [[over, hg + ag >= 3]] });
        if (btts !== null) rows["BTTS — Yes"].push({ score: Math.pow(btts - (hg > 0 && ag > 0 ? 1 : 0), 2), observations: [[btts, hg > 0 && ag > 0]] });
    });

    const labels = Object.keys(rows);
    summary.innerHTML = "";
    binsBody.innerHTML = "";
    let anyData = false;

    labels.forEach(label => {
        const records = rows[label];
        const sample = records.length;
        const brier = sample ? records.reduce((sum, record) => sum + record.score, 0) / sample : null;
        const guidance = sample < 30 ? "Very small sample" : sample < 50 ? "Limited sample" : "More informative sample";
        const card = document.createElement("div");
        card.className = "calibration-card";
        const heading = document.createElement("strong");
        heading.textContent = label;
        const score = document.createElement("span");
        score.className = "calibration-score";
        score.textContent = brier === null ? "—" : brier.toFixed(3);
        const detail = document.createElement("small");
        detail.textContent = `${sample} completed matches · ${guidance}`;
        card.append(heading, score, detail);
        summary.appendChild(card);

        if (!sample) return;
        anyData = true;
        const buckets = Array.from({ length: 5 }, () => []);
        records.forEach(record => record.observations.forEach(([probability, occurred]) => {
            const index = Math.min(4, Math.floor(probability * 5));
            buckets[index].push({ probability, occurred });
        }));
        buckets.forEach((bucket, index) => {
            if (!bucket.length) return;
            const avgPredicted = bucket.reduce((sum, item) => sum + item.probability, 0) / bucket.length;
            const observed = bucket.filter(item => item.occurred).length / bucket.length;
            const tr = document.createElement("tr");
            [label, `${index * 20}–${(index + 1) * 20}%`, String(bucket.length), `${(avgPredicted * 100).toFixed(1)}%`, `${(observed * 100).toFixed(1)}%`].forEach(value => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });
            binsBody.appendChild(tr);
        });
    });

    if (!anyData) binsBody.innerHTML = '<tr><td colspan="5">No completed predictions with saved probabilities yet.</td></tr>';
}

// Summarize match-outcome accuracy separately for each competition.
function renderCompetitionAnalytics(graded) {
    const body = document.getElementById("competitionAccuracy");
    if (!body) return;
    body.innerHTML = "";
    const groups = new Map();
    graded.forEach(item => {
        const name = item.competitionName || "Manual / legacy";
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(item);
    });
    if (!groups.size) {
        body.innerHTML = '<tr><td colspan="4">No completed predictions yet.</td></tr>';
        return;
    }
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, items]) => {
        const correct = items.filter(item => item.grade.outcome).length;
        const row = document.createElement("tr");
        [name, String(items.length), `${correct}/${items.length}`, accuracyLabel(correct, items.length)]
            .forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
        body.appendChild(row);
    });
}

// Display saved predictions and calculate accuracy from completed fixtures.
function displayPredictionHistory() {
    const history = getPredictionHistory();
    const table = document.getElementById("predictionHistory");
    if (!table) return;

    const graded = history.filter(item => item.actualResult && item.grade);
    const outcomeCorrect = graded.filter(item => item.grade.outcome).length;
    const exactCorrect = graded.filter(item => item.grade.exactScore).length;

    document.getElementById("totalPredictions").textContent = history.length;
    document.getElementById("completedPredictions").textContent = graded.length;
    document.getElementById("outcomeAccuracy").textContent =
        accuracyLabel(outcomeCorrect, graded.length);
    document.getElementById("exactScoreAccuracy").textContent =
        accuracyLabel(exactCorrect, graded.length);

    const overUnderCorrect = graded.filter(item => item.grade.overUnder25).length;
    const bttsCorrect = graded.filter(item => item.grade.btts).length;
    document.getElementById("overUnderAccuracy").textContent =
        accuracyLabel(overUnderCorrect, graded.length);
    document.getElementById("bttsAccuracy").textContent =
        accuracyLabel(bttsCorrect, graded.length);

    renderMarketAnalytics(graded);
    renderCalibrationAnalytics(graded);
    renderCompetitionAnalytics(graded);

    table.innerHTML = "";
    if (history.length === 0) {
        table.innerHTML = `<tr><td colspan="6">No predictions saved yet.</td></tr>`;
        return;
    }

    history.forEach(prediction => {
        const row = document.createElement("tr");
        const dateCell = document.createElement("td");
        const dateValue = prediction.matchDate || prediction.createdAt || prediction.date;
        const parsedDate = dateValue ? new Date(dateValue) : null;
        dateCell.textContent = parsedDate && !Number.isNaN(parsedDate.getTime())
            ? parsedDate.toLocaleDateString() : "—";

        const matchCell = document.createElement("td");
        const leagueLabel = prediction.competitionName ? `${prediction.competitionName}: ` : "";
        matchCell.textContent = `${leagueLabel}${prediction.homeTeam} vs ${prediction.awayTeam}`;

        const predictionCell = document.createElement("td");
        predictionCell.textContent = Number.isInteger(prediction.predictedHomeGoals) &&
            Number.isInteger(prediction.predictedAwayGoals)
            ? `${prediction.predictedHomeGoals} - ${prediction.predictedAwayGoals}`
            : prediction.predictionDetails || "Older prediction";

        const actualCell = document.createElement("td");
        actualCell.textContent = prediction.actualResult
            ? `${prediction.actualResult.homeGoals} - ${prediction.actualResult.awayGoals}`
            : prediction.fixtureId ? "Pending" : "No fixture ID";

        const gradeCell = document.createElement("td");
        if (prediction.grade) {
            const g = prediction.grade;
            gradeCell.textContent = [
                `Outcome ${g.outcome ? "✓" : "✗"}`,
                `Exact ${g.exactScore ? "✓" : "✗"}`,
                `O/U ${g.overUnder25 ? "✓" : "✗"}`,
                `BTTS ${g.btts ? "✓" : "✗"}`
            ].join(" · ");
        } else if (prediction.fixtureId) {
            gradeCell.textContent = "Awaiting final score";
        } else {
            gradeCell.textContent = "Manual prediction";
        }

        const actionCell = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.onclick = () => deletePrediction(prediction.id);
        actionCell.appendChild(deleteButton);
        row.append(dateCell, matchCell, predictionCell, actualCell, gradeCell, actionCell);
        table.appendChild(row);
    });
}

// Check all saved, ungraded fixture predictions against the API.
async function checkCompletedResults() {
    const button = document.getElementById("checkResultsButton");
    const status = document.getElementById("resultsCheckStatus");
    const history = getPredictionHistory();
    const pendingIds = [...new Set(history
        .filter(item => item.fixtureId && !item.actualResult)
        .map(item => String(item.fixtureId)))];

    if (pendingIds.length === 0) {
        status.textContent = "There are no unchecked API-linked predictions.";
        return;
    }

    button.disabled = true;
    status.textContent = `Checking ${pendingIds.length} saved fixture${pendingIds.length === 1 ? "" : "s"}...`;

    try {
        let gradedCount = 0;
        // football-data.org supports an IDs filter; batches of 50 keep URLs manageable.
        for (let index = 0; index < pendingIds.length; index += 50) {
            const batch = pendingIds.slice(index, index + 50);
            const response = await fetch(
                `/api/matches/results?ids=${encodeURIComponent(batch.join(","))}`
            );
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || `Results request failed (${response.status}).`);
            }

            const matchById = new Map((data.matches || []).map(match => [String(match.id), match]));
            history.forEach(prediction => {
                if (!batch.includes(String(prediction.fixtureId)) || prediction.actualResult) return;
                const match = matchById.get(String(prediction.fixtureId));
                if (!match) return;

                // Only grade a completed match with an official full-time score.
                if (!["FINISHED", "AWARDED"].includes(match.status)) return;
                if (gradePrediction(prediction, match)) gradedCount++;
            });
        }

        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        displayPredictionHistory();
        status.textContent = gradedCount
            ? `Updated ${gradedCount} prediction${gradedCount === 1 ? "" : "s"} with completed results.`
            : "No new final scores were available yet. Unfinished matches remain pending.";
    } catch (error) {
        console.error("Could not check match results:", error);
        status.textContent = error.message || "Unable to check match results.";
    } finally {
        button.disabled = false;
        button.textContent = originalButtonLabel;
    }
}

// Delete a prediction
function deletePrediction(id) {
    const updatedHistory = getPredictionHistory()
        .filter(prediction => prediction.id !== id);

    localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(updatedHistory)
    );

    displayPredictionHistory();
}

// Load history when the page opens
document.addEventListener(
    "DOMContentLoaded",
    displayPredictionHistory
);
