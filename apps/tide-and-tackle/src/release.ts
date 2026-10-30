// Content that changes with each over-the-air release. Edit this file, then push to main.
// RELEASE 4 IS A DELIBERATE CRASH to test the crash-loop guard: the device must revert to release 3 after 3 failed boots.
export const RELEASE = {
  headline: "This release crashes on purpose.",
  note: "If you can read this, the crash test failed.",
  accent: "#B94642",
};
throw new Error("PureNative crash-loop test: release 4 fails at startup on purpose");
