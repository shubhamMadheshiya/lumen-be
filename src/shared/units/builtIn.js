"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILT_IN_UNITS = void 0;
exports.getBuiltInUnit = getBuiltInUnit;
exports.toCanonicalValue = toCanonicalValue;
exports.BUILT_IN_UNITS = [
    // Volume / liquid
    { symbol: 'ml', name: 'Millilitre', dimension: 'volume', factorToBase: 1, baseUnit: 'ml', displayOrder: 1 },
    { symbol: 'L', name: 'Litre', dimension: 'volume', factorToBase: 1000, baseUnit: 'ml', displayOrder: 2 },
    { symbol: 'glass', name: 'Glass (250ml)', dimension: 'volume', factorToBase: 250, baseUnit: 'ml', displayOrder: 3 },
    { symbol: 'cup', name: 'Cup (240ml)', dimension: 'volume', factorToBase: 240, baseUnit: 'ml', displayOrder: 4 },
    { symbol: 'oz_fl', name: 'Fl. oz (US)', dimension: 'volume', factorToBase: 29.5735, baseUnit: 'ml', displayOrder: 5 },
    // Mass / food
    { symbol: 'g', name: 'Gram', dimension: 'mass', factorToBase: 1, baseUnit: 'g', displayOrder: 10 },
    { symbol: 'mg', name: 'Milligram', dimension: 'mass', factorToBase: 0.001, baseUnit: 'g', displayOrder: 11 },
    { symbol: 'kg', name: 'Kilogram', dimension: 'mass', factorToBase: 1000, baseUnit: 'g', displayOrder: 12 },
    { symbol: 'lb', name: 'Pound', dimension: 'mass', factorToBase: 453.592, baseUnit: 'g', displayOrder: 13 },
    { symbol: 'oz_wt', name: 'Ounce (weight)', dimension: 'mass', factorToBase: 28.3495, baseUnit: 'g', displayOrder: 14 },
    // Energy
    { symbol: 'kcal', name: 'Kilocalorie', dimension: 'energy', factorToBase: 1, baseUnit: 'kcal', displayOrder: 20 },
    { symbol: 'kJ', name: 'Kilojoule', dimension: 'energy', factorToBase: 0.239006, baseUnit: 'kcal', displayOrder: 21 },
    // Temperature
    { symbol: '°C', name: 'Celsius', dimension: 'temperature', factorToBase: 1, baseUnit: '°C', displayOrder: 30 },
    // °F is handled specially: °C = (°F - 32) × 5/9 — the server converts on ingest.
    { symbol: '°F', name: 'Fahrenheit', dimension: 'temperature', factorToBase: 0, baseUnit: '°C', displayOrder: 31 },
    // Time / duration
    { symbol: 'min', name: 'Minute', dimension: 'duration', factorToBase: 60, baseUnit: 's', displayOrder: 40 },
    { symbol: 'h', name: 'Hour', dimension: 'duration', factorToBase: 3600, baseUnit: 's', displayOrder: 41 },
    { symbol: 's', name: 'Second', dimension: 'duration', factorToBase: 1, baseUnit: 's', displayOrder: 42 },
    // Distance
    { symbol: 'km', name: 'Kilometre', dimension: 'distance', factorToBase: 1000, baseUnit: 'm', displayOrder: 50 },
    { symbol: 'm', name: 'Metre', dimension: 'distance', factorToBase: 1, baseUnit: 'm', displayOrder: 51 },
    { symbol: 'mi', name: 'Mile', dimension: 'distance', factorToBase: 1609.34, baseUnit: 'm', displayOrder: 52 },
    // Activity
    { symbol: 'steps', name: 'Steps', dimension: 'count', factorToBase: 1, baseUnit: 'steps', displayOrder: 60 },
    // Vitals
    { symbol: 'bpm', name: 'Beats per minute', dimension: 'rate', factorToBase: 1, baseUnit: 'bpm', displayOrder: 70 },
    { symbol: 'mmHg', name: 'mmHg', dimension: 'pressure', factorToBase: 1, baseUnit: 'mmHg', displayOrder: 71 },
    { symbol: 'mg/dL', name: 'mg/dL (blood glucose)', dimension: 'concentration', factorToBase: 1, baseUnit: 'mg/dL', displayOrder: 72 },
    { symbol: 'mmol/L', name: 'mmol/L (blood glucose)', dimension: 'concentration', factorToBase: 18.018, baseUnit: 'mg/dL', displayOrder: 73 },
    // Count / generic
    { symbol: 'count', name: 'Count', dimension: 'count', factorToBase: 1, baseUnit: 'count', displayOrder: 80 },
    { symbol: 'serving', name: 'Serving', dimension: 'count', factorToBase: 1, baseUnit: 'serving', displayOrder: 81 },
    { symbol: 'tablet', name: 'Tablet', dimension: 'count', factorToBase: 1, baseUnit: 'tablet', displayOrder: 82 },
    { symbol: 'drop', name: 'Drop', dimension: 'count', factorToBase: 1, baseUnit: 'drop', displayOrder: 83 },
    // Relative
    { symbol: '%', name: 'Percent', dimension: 'ratio', factorToBase: 1, baseUnit: '%', displayOrder: 90 },
];
function getBuiltInUnit(symbol) {
    return exports.BUILT_IN_UNITS.find(u => u.symbol === symbol);
}
/** Convert a value from the given unit to its base unit. Returns undefined for unknown units. */
function toCanonicalValue(value, unit) {
    if (unit === '°F')
        return (value - 32) * (5 / 9); // special case
    const u = getBuiltInUnit(unit);
    if (!u)
        return undefined;
    return value * u.factorToBase;
}
//# sourceMappingURL=builtIn.js.map