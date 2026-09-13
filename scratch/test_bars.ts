import { mapForecastToBars } from '../apps/web/src/lib/minex.ts';

const forecast = {
    "mine_id": "MH-NAGPUR-01",
    "forecast": {
        "p10": 64.8,
        "p50": 88.7,
        "p90": 112.7
    }
};

const history = {
    "mine_id": "MH-NAGPUR-01",
    "granularity": "day",
    "actuals": [
        { "actual": "69.7", "date": "2025-06-01" },
        { "actual": "102.8", "date": "2025-06-10" },
        { "actual": "98.7", "date": "2025-06-13" },
        { "actual": "111.6", "date": "2025-06-22" },
        { "actual": "236.5", "date": "2025-06-23" },
        { "actual": "106.4", "date": "2025-06-25" },
        { "actual": "112.9", "date": "2025-06-27" }
    ]
};

const merged = { ...history, forecast: forecast.forecast, history: history };
const bars = mapForecastToBars(merged);
console.log(JSON.stringify(bars, null, 2));
