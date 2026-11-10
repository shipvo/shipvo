# Spec gallery

Five small example specs for `shipvo.app/v0`. Copy one and change it. Each file passes the validator and the CEL check, renders on the Android and iOS skins, and runs its action in `packages/spec/test/gallery.test.ts`.

| Spec | Data sources | Action | Form | Chart | List |
| --- | --- | --- | --- | --- | --- |
| [Habit tracker](habit-tracker.json) | collection, computed total | `check_in` | habit, day, times | bar | recent check-ins |
| [Expense splitter](expense-splitter.json) | collection, computed total and share | `add_expense` | payer, what, amount | donut | expenses |
| [Trip checklist](trip-checklist.json) | collection, computed left and packed count | `add_item` | item, group | bar | still to pack |
| [Flashcards](flashcards.json) | collection, computed cards to learn | `add_card` | front, back | donut | cards to learn |
| [Workout log](workout-log.json) | collection, computed volume | `log_set` | exercise, reps, weight | bar | sets |
