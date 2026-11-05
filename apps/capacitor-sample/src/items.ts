export interface Item {
  id: number;
  name: string;
  note: string;
}

export const ITEMS: Item[] = [
  { id: 1, name: "Harbour tide", note: "High at 06:42, low at 12:58." },
  { id: 2, name: "Spinner lure", note: "Works best at dawn." },
  { id: 3, name: "Pier permit", note: "Valid until the end of the season." },
];

export function findItem(id: number): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** Text for the release button. Without a release number, the app runs the build it shipped with. */
export function releaseLabel(release: number | null | undefined): string {
  return release == null ? "Release: embedded build" : `Release: ${release}`;
}
