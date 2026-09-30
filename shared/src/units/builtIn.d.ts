/** Built-in unit table. Stored as constants; never written to the DB per user. */
export interface BuiltInUnit {
    symbol: string;
    name: string;
    dimension: string;
    factorToBase: number;
    baseUnit: string;
    displayOrder: number;
}
export declare const BUILT_IN_UNITS: BuiltInUnit[];
export declare function getBuiltInUnit(symbol: string): BuiltInUnit | undefined;
/** Convert a value from the given unit to its base unit. Returns undefined for unknown units. */
export declare function toCanonicalValue(value: number, unit: string): number | undefined;
