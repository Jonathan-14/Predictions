
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = "https://api.football-data.org/v4";

const ALLOWED_LEAGUES = [
    "PL",  // Premier League
    "PD",  // La Liga
    "BL1", // Bundesliga
    "SA",  // Serie A
    "FL1", // Ligue 1
    "CL",  // UEFA Champions League (Free Tier)
    "WC",  // FIFA World Cup (Free Tier)
    "EC"   // UEFA European Championship (Free Tier)
];

app.use(express.json());

// Serve your existing website
app.use(express.static(__dirname, {
    dotfiles: "deny"
}));

// Reusable API request function
async function footballRequest(endpoint) {

    if (!process.env.FOOTBALL_DATA_TOKEN) {
        throw new Error("Missing football API token.");
    }

    const response = await fetch(
        `${API_URL}${endpoint}`,
        {
            headers: {
                "X-Auth-Token":
                    process.env.FOOTBALL_DATA_TOKEN
            }
        }
    );

    if (!response.ok) {
        const messages = {
            403: "This competition or endpoint is not included in your football-data.org plan (HTTP 403).",
            404: "The requested competition or resource was not found (HTTP 404).",
            429: "The football-data.org request limit was reached. Please wait a minute and try again (HTTP 429)."
        };
        const error = new Error(
            messages[response.status] || `Football API error: ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return response.json();
}

// Upcoming and recent league fixtures
app.get("/api/competitions/:code/matches", async (req, res) => {

    try {
        const code = req.params.code.toUpperCase();

        if (!ALLOWED_LEAGUES.includes(code)) {
            return res.status(400).json({
                error: `Unsupported competition code: ${code}.`,
                allowedCompetitions: ALLOWED_LEAGUES
            });
        }

        const { dateFrom, dateTo } = req.query;

        const validDate = value =>
            /^\d{4}-\d{2}-\d{2}$/.test(value || "");

        if (
            (dateFrom && !validDate(dateFrom)) ||
            (dateTo && !validDate(dateTo))
        ) {
            return res.status(400).json({
                error: "Dates must use YYYY-MM-DD."
            });
        }

        if (
            dateFrom && dateTo &&
            dateFrom > dateTo
        ) {
            return res.status(400).json({
                error: "Start date must be before end date."
            });
        }

        const params = new URLSearchParams();

        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);

        const query = params.toString();

        const data = await footballRequest(
            `/competitions/${code}/matches` +
            (query ? `?${query}` : "")
        );

        res.json(data);

    } catch (error) {
        console.error("FIXTURE ERROR:", error);
    
        res.status(error.status || 500).json({
            error: error.message || "Unable to retrieve fixtures.",
            status: error.status || 500
        });
    }
});

// Retrieve results for a batch of saved fixture IDs.
// football-data.org supports the ids filter, so one API request can
// check several predictions without making one request per match.
app.get("/api/matches/results", async (req, res) => {
    try {
        const rawIds = String(req.query.ids || "");
        const ids = [...new Set(rawIds.split(",").filter(Boolean))];

        if (ids.length === 0 || ids.length > 50 ||
            ids.some(id => !/^\d+$/.test(id))) {
            return res.status(400).json({
                error: "Provide between 1 and 50 numeric fixture IDs."
            });
        }

        const data = await footballRequest(
            `/matches?ids=${ids.join(",")}`
        );

        res.json({ matches: data.matches || [] });
    } catch (error) {
        console.error("MATCH RESULTS ERROR:", error);
        res.status(error.status || 500).json({
            error: error.message || "Unable to retrieve match results.",
            status: error.status || 500
        });
    }
});

// Retrieve a team's last five completed matches
app.get("/api/teams/:teamId/recent-stats", async (req, res) => {

    try {
        const teamId = req.params.teamId;

        if (!/^\d+$/.test(teamId)) {
            return res.status(400).json({
                error: "Invalid team ID."
            });
        }

        const data = await footballRequest(
            `/teams/${teamId}/matches?status=FINISHED&limit=5`
        );

        const matches = data.matches || [];

        const results = matches.filter(match =>
            match.score &&
            match.score.fullTime &&
            match.score.fullTime.home !== null &&
            match.score.fullTime.away !== null
        );

        if (results.length === 0) {
            return res.status(404).json({
                error: "No completed matches found."
            });
        }

        let goalsScored = 0;
        let goalsConceded = 0;
        let form = "";

        for (const match of results) {

            const isHome =
                String(match.homeTeam.id) === teamId;

            const scored = isHome
                ? match.score.fullTime.home
                : match.score.fullTime.away;

            const conceded = isHome
                ? match.score.fullTime.away
                : match.score.fullTime.home;

            goalsScored += scored;
            goalsConceded += conceded;

            if (scored > conceded) {
                form += "W";
            } else if (scored === conceded) {
                form += "D";
            } else {
                form += "L";
            }
        }

        const count = results.length;

        res.json({
            team: results[0].homeTeam.id === Number(teamId)
                ? results[0].homeTeam.name
                : results[0].awayTeam.name,

            matchesPlayed: count,

            averageGoalsScored:
                Number((goalsScored / count).toFixed(2)),

            averageGoalsConceded:
                Number((goalsConceded / count).toFixed(2)),

            recentForm: form,

            matches: results
        });

    } catch (error) {
        console.error(error.message);

        res.status(error.status || 500).json({
            error: "Unable to retrieve team statistics.",
            details: error.status
                ? `Football API returned ${error.status}.`
                : "Check the server configuration."
        });
    }
});


// Retrieve an expanded team profile using recent completed matches.
app.get("/api/teams/:teamId/profile", async (req, res) => {
    try {
        const teamId = req.params.teamId;
        const limit = Number(req.query.limit || 10);

        if (!/^\d+$/.test(teamId)) {
            return res.status(400).json({ error: "Invalid team ID." });
        }
        if (![5, 10, 15, 20].includes(limit)) {
            return res.status(400).json({ error: "Limit must be 5, 10, 15, or 20." });
        }

        const data = await footballRequest(
            `/teams/${teamId}/matches?status=FINISHED&limit=${limit}`
        );
        const matches = (data.matches || []).filter(match =>
            match.score?.fullTime?.home !== null &&
            match.score?.fullTime?.home !== undefined &&
            match.score?.fullTime?.away !== null &&
            match.score?.fullTime?.away !== undefined
        );

        if (!matches.length) {
            return res.status(404).json({ error: "No completed matches are available for this team." });
        }

        let wins = 0, draws = 0, losses = 0;
        let homeWins = 0, homeDraws = 0, homeLosses = 0;
        let awayWins = 0, awayDraws = 0, awayLosses = 0;
        let goalsFor = 0, goalsAgainst = 0;
        let recentForm = "";
        const venueStats = {
            home: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
            away: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
        };
        const recentMatches = matches.map(match => {
            const isHome = String(match.homeTeam.id) === teamId;
            const scored = isHome ? match.score.fullTime.home : match.score.fullTime.away;
            const conceded = isHome ? match.score.fullTime.away : match.score.fullTime.home;
            const result = scored > conceded ? "W" : scored === conceded ? "D" : "L";
            goalsFor += scored;
            goalsAgainst += conceded;
            if (result === "W") wins++;
            else if (result === "D") draws++;
            else losses++;
            const venue = isHome ? venueStats.home : venueStats.away;
            venue.played++;
            venue.goalsFor += scored;
            venue.goalsAgainst += conceded;
            if (result === "W") venue.wins++;
            else if (result === "D") venue.draws++;
            else venue.losses++;
            if (isHome) {
                if (result === "W") homeWins++;
                else if (result === "D") homeDraws++;
                else homeLosses++;
            } else {
                if (result === "W") awayWins++;
                else if (result === "D") awayDraws++;
                else awayLosses++;
            }
            recentForm += result;
            return {
                date: match.utcDate ? match.utcDate.slice(0, 10) : "Date unavailable",
                opponent: isHome ? match.awayTeam.name : match.homeTeam.name,
                venue: isHome ? "Home" : "Away",
                goalsFor: scored,
                goalsAgainst: conceded,
                result,
                competition: match.competition?.name || ""
            };
        });

        const count = matches.length;
        for (const venue of Object.values(venueStats)) {
            venue.averageGoalsScored = venue.played
                ? Number((venue.goalsFor / venue.played).toFixed(2)) : 0;
            venue.averageGoalsConceded = venue.played
                ? Number((venue.goalsAgainst / venue.played).toFixed(2)) : 0;
            venue.record = `${venue.wins}-${venue.draws}-${venue.losses}`;
        }
        const teamName = String(matches[0].homeTeam.id) === teamId
            ? matches[0].homeTeam.name : matches[0].awayTeam.name;

        res.json({
            team: teamName,
            matchesPlayed: count,
            wins, draws, losses,
            averageGoalsScored: Number((goalsFor / count).toFixed(2)),
            averageGoalsConceded: Number((goalsAgainst / count).toFixed(2)),
            recentForm,
            homeRecord: `${homeWins}-${homeDraws}-${homeLosses}`,
            awayRecord: `${awayWins}-${awayDraws}-${awayLosses}`,
            venueStats,
            recentMatches
        });
    } catch (error) {
        console.error("TEAM PROFILE ERROR:", error);
        res.status(error.status || 500).json({
            error: error.message || "Unable to retrieve team profile.",
            status: error.status || 500
        });
    }
});



// Retrieve historical meetings for the two teams in a selected fixture.
// football-data.org exposes this as the match /head2head subresource.
app.get("/api/matches/:matchId/head2head", async (req, res) => {
    try {
        const matchId = req.params.matchId;
        if (!/^\d+$/.test(matchId)) {
            return res.status(400).json({ error: "Invalid fixture ID." });
        }

        const data = await footballRequest(`/matches/${matchId}/head2head`);
        const matchList = Array.isArray(data.matches) ? data.matches :
            (Array.isArray(data.head2head?.matches) ? data.head2head.matches : []);
        const completed = matchList.filter(match =>
            match.status === "FINISHED" &&
            match.score?.fullTime?.home !== null &&
            match.score?.fullTime?.home !== undefined &&
            match.score?.fullTime?.away !== null &&
            match.score?.fullTime?.away !== undefined
        );

        res.json({
            match: data.match || null,
            head2head: data.head2head || data.aggregates || null,
            matches: completed
        });
    } catch (error) {
        console.error("HEAD-TO-HEAD ERROR:", error);
        res.status(error.status || 500).json({
            error: error.message || "Unable to retrieve head-to-head history.",
            status: error.status || 500
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Soccer Predictor running at http://localhost:${PORT}`);
    console.log(`Project folder: ${__dirname}`);
    console.log(`Enabled competitions: ${ALLOWED_LEAGUES.join(", ")}`);
    console.log("Fixture search range: selectable 14, 30, 60, or 90 days.");
});
