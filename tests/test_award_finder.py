import io
import json
import os
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stdout
from unittest import mock

from award_finder import cli
from award_finder.alliance import mm_status
from award_finder.api import SeatsAeroClient
from award_finder.core import Filters, apply_filters, best_by_cell, offers_from_availability, parse_cabins, trips_from_response
from award_finder.render import render_calendar, render_html, render_trips


def av(id_, date, source, o="FRA", d="JFK", **cab):
    base = {"ID": id_, "Date": date, "Source": source, "Route": {"OriginAirport": o, "DestinationAirport": d, "Source": source}}
    for c in "YWJF":
        base.update({f"{c}Available": False, f"{c}MileageCost": "0", f"{c}RemainingSeats": 0, f"{c}Airlines": "", f"{c}Direct": False})
    for c, (miles, seats, airlines, direct) in cab.items():
        base.update({f"{c}Available": True, f"{c}MileageCost": str(miles), f"{c}RemainingSeats": seats, f"{c}Airlines": airlines, f"{c}Direct": direct})
    return base


DATA = [
    av("a1", "2027-03-02", "lufthansa", J=(106000, 2, "LH", True)),
    av("a2", "2027-03-02", "united", J=(80000, 4, "LH, UA", True), Y=(30000, 9, "UA", True)),
    av("a3", "2027-03-03", "aeroplan", J=(70000, 1, "AC", False)),
    av("a4", "2027-03-03", "turkish", J=(60000, 0, "TK", False)),
    av("a5", "2027-03-04", "aeroplan", J=(75000, 2, "EK", False)),
]

TRIPS = {
    "data": [
        {
            "Source": "united", "Cabin": "business", "MileageCost": 80000, "TotalTaxes": 5610, "TaxesCurrency": "USD",
            "RemainingSeats": 4, "Stops": 0, "TotalDuration": 525, "Carriers": "LH", "FlightNumbers": "LH400",
            "DepartsAt": "2027-03-02T10:05:00Z", "ArrivesAt": "2027-03-02T12:50:00Z",
            "AvailabilitySegments": [{"FlightNumber": "LH400", "OriginAirport": "FRA", "DestinationAirport": "JFK",
                                      "DepartsAt": "2027-03-02T10:05:00Z", "ArrivesAt": "2027-03-02T12:50:00Z",
                                      "AircraftName": "Boeing 747-8", "FareClass": "I", "Order": 0}],
        },
        {
            "Source": "united", "Cabin": "business", "MileageCost": 80000, "TotalTaxes": 5610, "Carriers": "LH, EK",
            "RemainingSeats": 2, "Stops": 1, "TotalDuration": 900, "AvailabilitySegments": [],
        },
    ],
    "booking_links": [{"label": "Book via United MileagePlus", "link": "https://united.example/x", "primary": True}],
}


class FakeFetch:
    def __init__(self, pages):
        self.pages = pages
        self.urls = []

    def __call__(self, req, timeout):
        self.urls.append(req.full_url)
        assert req.headers["Partner-authorization"] == "k"
        if "/trips/" in req.full_url:
            return json.dumps(TRIPS).encode()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
        skip = int(q.get("skip", ["0"])[0])
        idx = 0 if skip == 0 else 1
        return json.dumps(self.pages[idx]).encode()


class CoreTests(unittest.TestCase):
    def test_parse_cabins(self):
        self.assertEqual(parse_cabins("business,F,j"), ["J", "F"])
        self.assertEqual(parse_cabins(None), ["Y", "W", "J", "F"])
        with self.assertRaises(ValueError):
            parse_cabins("xyz")

    def test_mm_status(self):
        self.assertEqual(mm_status("lufthansa", ["LH"], True), "direct")
        self.assertEqual(mm_status("united", ["LH", "UA"], True), "likely")
        self.assertEqual(mm_status("turkish", ["TK"], True), "hint")
        self.assertEqual(mm_status("aeroplan", ["EK"], False), "no")
        self.assertEqual(mm_status("united", ["LH", "EK"], True), "no")
        self.assertEqual(mm_status("united", ["LH", "EK"], False), "likely")

    def test_offers_and_filters(self):
        offers = [o for a in DATA for o in offers_from_availability(a)]
        self.assertEqual(len(offers), 6)
        j = apply_filters(offers, Filters(cabins=["J"]))
        self.assertEqual(len(j), 5)
        self.assertEqual(len(apply_filters(offers, Filters(cabins=["J"], mm_only=True))), 4)
        self.assertEqual(len(apply_filters(offers, Filters(cabins=["J"], direct_only=True))), 2)
        self.assertEqual(len(apply_filters(offers, Filters(cabins=["J"], max_miles=75000))), 3)
        # seats=0 (unknown, turkish) must survive min_seats
        two = apply_filters(offers, Filters(cabins=["J"], min_seats=2))
        self.assertEqual({o.source for o in two}, {"lufthansa", "united", "turkish", "aeroplan"})
        self.assertEqual(len(two), 4)

    def test_calendar_prefers_mm_status(self):
        offers = [o for a in DATA for o in offers_from_availability(a)]
        cal = best_by_cell(offers)
        # 2.3.: LH (direct, 106k) beats United (likely, 80k)
        self.assertEqual(cal[("2027-03-02", "FRA", "JFK")]["J"].source, "lufthansa")
        # 3.3.: Aeroplan (likely, 70k) beats Turkish (hint, 60k)
        self.assertEqual(cal[("2027-03-03", "FRA", "JFK")]["J"].source, "aeroplan")
        text = render_calendar(offers, ["Y", "J"], color=False)
        self.assertIn("2027-03-02", text)
        self.assertIn("M&M", text)

    def test_trips(self):
        trips, links = trips_from_response(TRIPS)
        self.assertEqual(trips[0].mm, "likely")
        self.assertEqual(trips[0].taxes, 56.10)
        self.assertEqual(trips[1].mm, "no")
        offer = offers_from_availability(DATA[1])[0]
        out = render_trips(offer, trips, links, color=False)
        self.assertIn("LH400", out)
        self.assertIn("nicht M&M (EK)", out)
        self.assertIn("united.example", out)

    def test_html(self):
        offers = [o for a in DATA for o in offers_from_availability(a)]
        page = render_html(offers, ["J", "F"], "T<est>", "sub")
        self.assertIn("T&lt;est&gt;", page)
        self.assertIn('class="direct"', page)
        self.assertIn("prefers-color-scheme", page)


class ApiTests(unittest.TestCase):
    def test_pagination_and_dedupe(self):
        fake = FakeFetch([
            {"data": DATA[:3], "hasMore": True, "cursor": 123},
            {"data": DATA[2:], "hasMore": False, "cursor": 123},
        ])
        c = SeatsAeroClient("k", fetch=fake)
        res = c.cached_search("fra", "jfk,ewr", "2027-03-01", "2027-03-31", sources=["lufthansa", "united"])
        self.assertEqual(len(res), 5)
        self.assertEqual(c.calls, 2)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(fake.urls[0]).query)
        self.assertEqual(q["origin_airport"], ["FRA"])
        self.assertEqual(q["destination_airport"], ["JFK,EWR"])
        self.assertEqual(q["sources"], ["lufthansa,united"])
        q2 = urllib.parse.parse_qs(urllib.parse.urlparse(fake.urls[1]).query)
        self.assertEqual(q2["skip"], ["3"])
        self.assertEqual(q2["cursor"], ["123"])

    def test_missing_key(self):
        with self.assertRaises(Exception):
            SeatsAeroClient("")


class CliTests(unittest.TestCase):
    def _patch(self):
        fake = FakeFetch([{"data": DATA, "hasMore": False, "cursor": 1}])
        return mock.patch.object(cli, "_client", lambda args: SeatsAeroClient("k", fetch=fake))

    def test_search_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp, self._patch():
            html_path = os.path.join(tmp, "r.html")
            buf = io.StringIO()
            with redirect_stdout(buf), mock.patch("sys.stderr", io.StringIO()):
                rc = cli.main(["search", "FRA", "JFK", "--from", "2027-03-01", "--to", "2027-03-31",
                               "-c", "J", "--mm-only", "--details", "1", "--html", html_path])
            self.assertEqual(rc, 0)
            out = buf.getvalue()
            self.assertIn("FRA → JFK", out)
            self.assertIn("Flugdetails", out)
            self.assertTrue(os.path.exists(html_path))

    def test_watch_reports_only_new(self):
        with tempfile.TemporaryDirectory() as tmp, self._patch():
            cfg = os.path.join(tmp, "w.json")
            state = os.path.join(tmp, "s.json")
            with open(cfg, "w") as f:
                json.dump({"searches": [{"origin": "FRA", "destination": "JFK", "from": "2027-03-01",
                                         "to": "2027-03-31", "cabins": "J"}]}, f)
            with redirect_stdout(io.StringIO()), mock.patch("sys.stderr", io.StringIO()):
                self.assertEqual(cli.main(["watch", cfg, "--state", state]), 10)
                self.assertEqual(cli.main(["watch", cfg, "--state", state]), 0)


if __name__ == "__main__":
    unittest.main()
