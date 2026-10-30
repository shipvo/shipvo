import { useColorScheme } from "react-native";

export const LIGHT = {
  surface: "#F3F8FA", raised: "#FBFEFF", sunken: "#E7EEF1", text: "#181B1C", text2: "#525657", border: "#C9D2D6",
  onAccent: "#FFFFFF", success: "#278733", warning: "#9A6200", critical: "#B94642", info: "#1D5FA8",
  successSoft: "#E3F3E5", warningSoft: "#FBF0DC", criticalSoft: "#F9E4E3", infoSoft: "#E2EDF9",
};
export const DARK: typeof LIGHT = {
  surface: "#0A1113", raised: "#151C1F", sunken: "#0E1517", text: "#E1E9ED", text2: "#9BA7AC", border: "#2C3538",
  onAccent: "#FFFFFF", success: "#61BD67", warning: "#E0A84A", critical: "#F47B74", info: "#7FB0EA",
  successSoft: "#14281A", warningSoft: "#2B2112", criticalSoft: "#2E1716", infoSoft: "#13213A",
};
export type Tokens = typeof LIGHT & { accent: string };
export const useTokens = (accent: string): Tokens => ({ ...(useColorScheme() === "dark" ? DARK : LIGHT), accent });
export const fcfa = (n: number) => `${n.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
