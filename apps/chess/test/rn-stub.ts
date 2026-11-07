// Minimal react-native stand-in so the screen renders in Node.
import { createElement, type ReactNode } from "react";
const host = (name: string) => (props: Record<string, unknown> & { children?: ReactNode }) =>
  createElement(name, props);
export const View = host("View");
export const Text = host("Text");
export const Pressable = host("Pressable");
export const ScrollView = host("ScrollView");
export const StyleSheet = { create: <T,>(s: T) => s };
