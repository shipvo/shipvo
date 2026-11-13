// The web and default version of the price label. The native version is Price.native.js.
import { Text } from "react-native";

export const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

export function Price({ amount }) {
  return <Text>Price: {money(amount)}</Text>;
}
