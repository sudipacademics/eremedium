/**
 * Type declarations for two untyped dependencies used by the birthplace lookup.
 *
 * Written out rather than declared as `any`, so that a change in either package's shape surfaces at
 * compile time instead of as a wrong coordinate in somebody's chart.
 */

declare module 'all-the-cities' {
  /** One GeoNames populated place, as shipped in the package's binary index. */
  interface City {
    readonly cityId: number;
    readonly name: string;
    readonly altName: string;
    readonly country: string;
    readonly featureCode: string;
    readonly adminCode: string;
    readonly population: number;
    /** GeoJSON order: [longitude, latitude]. */
    readonly loc: { readonly type: 'Point'; readonly coordinates: readonly [number, number] };
  }

  const cities: readonly City[];
  export default cities;
}

declare module 'tz-lookup' {
  /** Resolves an IANA timezone name from coordinates, offline. Throws on out-of-range input. */
  export default function tzLookup(latitude: number, longitude: number): string;
}
