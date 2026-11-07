// Training apps for the Lumi action ranker. They are not in the benchmark: the benchmark's `account` app is held out.
// Same format as spec-app.mjs. No planted bugs are needed here, the labels are new screens and findings.
const T = (name) => ({ t: "text", name });
const back = { t: "button", name: "Back", back: true };

function library() {
  return {
    start: "home",
    screens: {
      home: () => [{ t: "heading", name: "Library" }, { t: "tab", name: "Books", go: "books" }, { t: "tab", name: "Authors", go: "authors" }, { t: "link", name: "Opening hours", go: "hours" }, { t: "button", name: "Settings", go: "settings" }],
      books: () => [{ t: "heading", name: "Books" }, { t: "searchbox", name: "Search books" }, { t: "button", name: "Moby Dick", go: "book" }, { t: "button", name: "Emma", go: "book" }, back],
      book: (st) => [{ t: "heading", name: "Book" }, T(`Loans: ${st.cart}`), { t: "button", name: "Borrow", go: "borrow" }, { t: "button", name: "Remove from list", act: (s) => { s.cart = 0; } }, back],
      borrow: () => [{ t: "heading", name: "Borrow" }, { t: "textbox", name: "Card number" }, { t: "button", name: "Confirm", submit: (st) => (/^\d{6}$/.test(st.values["Card number"] ?? "") ? { go: "ok" } : { text: "Enter a six digit card number" }) }, back],
      ok: () => [{ t: "heading", name: "Borrowed" }, { t: "button", name: "Home", go: "home" }],
      authors: () => [{ t: "heading", name: "Authors" }, { t: "button", name: "Melville", go: "about" }, back],
      about: () => [{ t: "heading", name: "Author" }, T("Born 1819"), back],
      hours: () => [{ t: "heading", name: "Hours" }, T("Nine to five"), back],
      settings: () => [{ t: "heading", name: "Settings" }, { t: "switch", name: "Notifications", act: () => {} }, { t: "button", name: "Log out", go: "home" }, back],
    },
  };
}

function tasks() {
  return {
    start: "list",
    screens: {
      list: (st) => [{ t: "heading", name: "Tasks" }, T(`${st.cart} open`), { t: "button", name: "New task", go: "add" }, { t: "button", name: "Water the plants", go: "task" }, { t: "menuitem", name: "Filter", go: "filter" }, { t: "button", name: "Profile", go: "profile" }],
      add: () => [{ t: "heading", name: "New task" }, { t: "textbox", name: "Title" }, { t: "textbox", name: "Due date" }, { t: "button", name: "Save", submit: (st) => ((st.values.Title ?? "").trim() && /\d/.test(st.values["Due date"] ?? "") ? { go: "list" } : { text: "Enter a title and a due date" }) }, back],
      task: () => [{ t: "heading", name: "Task" }, { t: "checkbox", name: "Done", act: () => {} }, { t: "button", name: "Delete", go: "list" }, { t: "button", name: "Notes", go: "notes" }, back],
      notes: () => [{ t: "heading", name: "Notes" }, { t: "textbox", name: "Note" }, back],
      filter: () => [{ t: "heading", name: "Filter" }, { t: "radio", name: "All", act: () => {} }, { t: "radio", name: "Done", act: () => {} }, back],
      profile: () => [{ t: "heading", name: "Profile" }, { t: "link", name: "Privacy", go: "privacy" }, { t: "button", name: "Sign out", go: "list" }, back],
      privacy: () => [{ t: "heading", name: "Privacy" }, T("We keep nothing"), back],
    },
  };
}

export const TRAIN_APPS = [
  { id: "library", build: library, bugs: [], bugFlags: {}, heldOut: false },
  { id: "tasks", build: tasks, bugs: [], bugFlags: {}, heldOut: false },
];
