# Spec gallery

Example specs for `shipvo.app/v0`. Copy one and change it. Each file passes the validator and the CEL check, renders on the Android and iOS skins, and runs its action in `packages/spec/test/gallery.test.ts`.

| Spec | Data sources | Action | Form | Chart | List |
| --- | --- | --- | --- | --- | --- |
| [Habit tracker](habit-tracker.json) | collection, computed total | `check_in` | habit, day, times | bar | recent check-ins |
| [Workout log](workout-log.json) | collection, computed volume | `log_set` | exercise, reps, weight | bar | sets |
| [Expense splitter](expense-splitter.json) | collection, computed total | `add_expense` | paid by, for what, amount | bar | expenses |
| [Trip checklist](trip-checklist.json) | collection, computed count | `add_item` | item, group, quantity | bar | packing list |
| [Flashcards](flashcards.json) | collection, computed count | `add_card` | deck, question, answer | bar | cards |
