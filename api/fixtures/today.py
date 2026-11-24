from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from mackolik_provider import collect_upcoming


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") != "/api/fixtures/today":
            self._send(404, {"error": "not_found"})
            return
        params = parse_qs(parsed.query)
        # The public FIRO endpoint intentionally exposes today's fixtures only.
        try:
            rows = collect_upcoming(days=1, workers=3)
            fixtures = []
            for row in rows:
                fixtures.append({
                    "match_id": str(row.get("MatchId", "")),
                    "date": str(row.get("Date", "")),
                    "home": str(row.get("HomeTeam", "")),
                    "away": str(row.get("AwayTeam", "")),
                    "league": str(row.get("League", "")),
                    "odds_home": row.get("AvgH"),
                    "odds_draw": row.get("AvgD"),
                    "odds_away": row.get("AvgA"),
                    "odds_captured_at": str(row.get("OddsCapturedAt", "")),
                    "source": "Mackolik",
                    "match_url": str(row.get("MatchURL", "")),
                })
            self._send(200, {
                "provider": "Mackolik",
                "count": len(fixtures),
                "fixtures": fixtures,
                "odds_timestamp_note": "OddsCapturedAt is the time FIRO's server retrieved the displayed prices; it is not proof that the prices were first published at that time.",
            })
        except Exception as exc:
            self._send(502, {"error": "provider_unavailable", "message": str(exc)})

    def do_OPTIONS(self):
        self._send(204, {})

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if status != 204:
            self.wfile.write(body)
