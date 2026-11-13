// Bug Bench: one screen per seeded bug. Type "<case id>:buggy" or "<case id>:fixed" and open it.
// The runner in bench/ opens every case both ways on Shipvo Phone and counts the bugs that show up.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Btn, H, styles } from "./src/ui";
import { CASES } from "./src/cases";

export default function App() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(null);
  if (open) {
    const Case = CASES[open.id];
    return (
      <View style={styles.page}>
        <H>{open.id}</H>
        <Case buggy={open.buggy} />
      </View>
    );
  }
  const [id, variant] = text.trim().split(":");
  return (
    <View style={styles.page}>
      <H>Bug Bench</H>
      <TextInput accessibilityLabel="Case" value={text} onChangeText={setText} autoCapitalize="none" style={styles.input} />
      <Btn label="Open case" onPress={() => { if (CASES[id] && (variant === "buggy" || variant === "fixed")) setOpen({ id, buggy: variant === "buggy" }); else setText(""); }} />
      <Text>{Object.keys(CASES).length} cases</Text>
    </View>
  );
}
