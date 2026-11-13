// The Android and iOS version of the price label. Metro bundles this file on phones and Price.js on the web,
// so a bug here is in code a web build never contains.
import { Text } from "react-native";

export const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

export function Price({ amount, buggy }) {
  // Seeded bug: the amount is shown without its thousands separator and currency.
  return <Text>Price: {buggy ? String(amount) : money(amount)}</Text>;
}
