# Spec gallery

Example specs for `shipvo.app/v0`. Copy one and change it. Each file passes the validator and the CEL check, renders on the Android and iOS skins, and runs its action in `packages/spec/test/gallery.test.ts`.

| Spec | Data sources | Action | Form | Chart | List |
| --- | --- | --- | --- | --- | --- |
| [Habit tracker](habit-tracker.json) | collection, computed total | `check_in` | habit, day, times | bar | recent check-ins |
| [Workout log](workout-log.json) | collection, computed volume | `log_set` | exercise, reps, weight | bar | sets |
| [Expense splitter](expense-splitter.json) | collection, computed total | `add_expense` | paid by, for what, amount | bar | expenses |
| [Trip checklist](trip-checklist.json) | collection, computed count | `add_item` | item, group, quantity | bar | packing list |
| [Flashcards](flashcards.json) | collection, computed count | `add_card` | deck, question, answer | bar | cards |

Specs with a board, a calendar or a map:

| Spec | Block | Data sources | Actions | Form |
| --- | --- | --- | --- | --- |
| [Reading board](reading-board.json) | `kanban` (To read, Reading, Done) | collection, computed pages | `add_book`, `move_book` | title, author, pages |
| [Meal planner](meal-planner.json) | `calendar` (week) | collection, computed count | `add_meal` | meal, day, note |
| [Favourite places](favourite-places.json) | `map` | collection, computed count | `add_place` | name, latitude, longitude |

Specs with a timeline or a drawing that moves:

| Spec | Block | Data sources | Actions | Form |
| --- | --- | --- | --- | --- |
| [Project timeline](project-timeline.json) | `timeline` (milestones by day) | collection, computed open count | `add_milestone`, `complete_milestone` | milestone, due, note |
| [Focus timer](focus-timer.json) | `vector` progress ring with `motion` | collection, computed minutes and percent | `start_session`, `log_session` | task, minutes |
